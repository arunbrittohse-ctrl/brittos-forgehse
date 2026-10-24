/**
 * Minimal PostgreSQL client (wire protocol v3) — the ONLY database driver file.
 *
 * Why this exists: FORGEHSE was first built in an air-gapped environment where the
 * npm registry was unreachable, so the standard `pg` driver could not be installed.
 * Everything else in the API talks to the `Db` interface in ./db.ts, never to this file,
 * so replacing it with `pg` (node-postgres) is a one-file change. That replacement is
 * recommended before production; see docs/IMPLEMENTATION_REPORT.md.
 *
 * Supports: TCP + optional TLS (SSLRequest), trust / cleartext / MD5 / SCRAM-SHA-256 auth,
 * extended query protocol with text parameters (no SQL string interpolation anywhere),
 * simple query protocol (for multi-statement migration files), common type parsing,
 * connection pooling and pinned transactions.
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  ssl?: false | { rejectUnauthorized?: boolean; ca?: string };
  applicationName?: string;
  statementTimeoutMs?: number;
  connectTimeoutMs?: number;
}

export class PgError extends Error {
  code: string;
  detail?: string;
  constraint?: string;
  severity?: string;
  constructor(fields: Record<string, string>) {
    super(fields.M ?? 'PostgreSQL error');
    this.name = 'PgError';
    this.code = fields.C ?? 'XX000';
    this.detail = fields.D;
    this.constraint = fields.n;
    this.severity = fields.V ?? fields.S;
  }
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  command: string;
}

/* ------------------------------------------------------------------ type parsing */

const OID = {
  bool: 16, int8: 20, int2: 21, int4: 23, text: 25, oid: 26, json: 114, float4: 700, float8: 701,
  numeric: 1700, date: 1082, timestamp: 1114, timestamptz: 1184, uuid: 2950, jsonb: 3802,
  textArr: 1009, uuidArr: 2951, int4Arr: 1007, varcharArr: 1015,
} as const;

function parseArrayLiteral(s: string): (string | null)[] {
  // Handles one-dimensional arrays of simple/quoted elements.
  if (s === '{}') return [];
  const out: (string | null)[] = [];
  let i = 1; // skip '{'
  while (i < s.length - 1) {
    if (s[i] === '"') {
      let v = '';
      i++;
      while (s[i] !== '"') {
        if (s[i] === '\\') i++;
        v += s[i++];
      }
      i++; // closing quote
      out.push(v);
    } else {
      let j = i;
      while (j < s.length - 1 && s[j] !== ',') j++;
      const raw = s.slice(i, j);
      out.push(raw === 'NULL' ? null : raw);
      i = j;
    }
    if (s[i] === ',') i++;
  }
  return out;
}

function parseValue(oid: number, text: string): unknown {
  switch (oid) {
    case OID.bool: return text === 't';
    case OID.int2: case OID.int4: case OID.oid: return Number.parseInt(text, 10);
    case OID.int8: { const n = Number(text); return Number.isSafeInteger(n) ? n : text; }
    case OID.float4: case OID.float8: case OID.numeric: return Number(text);
    case OID.json: case OID.jsonb: return JSON.parse(text);
    case OID.timestamptz: case OID.timestamp: {
      if (text === 'infinity' || text === '-infinity') return text;
      let iso = text.replace(' ', 'T');
      if (oid === OID.timestamp) iso += 'Z';
      else iso = iso.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2}):?(\d{2}):(\d{2})$/, '$1:$2'); // +04 → +04:00
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? text : d.toISOString();
    }
    case OID.textArr: case OID.uuidArr: case OID.varcharArr: return parseArrayLiteral(text);
    case OID.int4Arr: return parseArrayLiteral(text).map((v) => (v === null ? null : Number(v)));
    default: return text; // text, varchar, uuid, date (YYYY-MM-DD), etc.
  }
}

/** Serialise a JS value to Postgres text format. Arrays → array literal; plain objects → JSON. */
export function serializeParam(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return '{' + v.map((x) => (x === null || x === undefined ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
  }
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  return JSON.stringify(v);
}

/* ------------------------------------------------------------------ framing helpers */

class Writer {
  private parts: Buffer[] = [];
  int32(n: number) { const b = Buffer.alloc(4); b.writeInt32BE(n); this.parts.push(b); return this; }
  int16(n: number) { const b = Buffer.alloc(2); b.writeInt16BE(n); this.parts.push(b); return this; }
  cstr(s: string) { this.parts.push(Buffer.from(s, 'utf8'), Buffer.from([0])); return this; }
  bytes(b: Buffer) { this.parts.push(b); return this; }
  msg(type: string | null): Buffer {
    const body = Buffer.concat(this.parts);
    const len = Buffer.alloc(4);
    len.writeInt32BE(body.length + 4);
    return type ? Buffer.concat([Buffer.from(type), len, body]) : Buffer.concat([len, body]);
  }
}

function readFields(buf: Buffer): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < buf.length && buf[i] !== 0) {
    const code = String.fromCharCode(buf[i]!);
    const end = buf.indexOf(0, i + 1);
    fields[code] = buf.toString('utf8', i + 1, end);
    i = end + 1;
  }
  return fields;
}

/* ------------------------------------------------------------------ SCRAM-SHA-256 */

function hmac(key: Buffer, data: string | Buffer) { return crypto.createHmac('sha256', key).update(data).digest(); }
function sha256(data: Buffer) { return crypto.createHash('sha256').update(data).digest(); }
function xor(a: Buffer, b: Buffer) { const o = Buffer.alloc(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i]! ^ b[i]!; return o; }

/* ------------------------------------------------------------------ connection */

interface Pending {
  resolve: (r: QueryResult<any>) => void;
  reject: (e: Error) => void;
  rows: Record<string, unknown>[];
  fields: { name: string; oid: number }[];
  command: string;
  error?: PgError;
}

export class PgConnection {
  private socket!: net.Socket | tls.TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private onAuthMessage?: (type: string, body: Buffer) => void;
  broken = false;

  constructor(private cfg: PgConfig) {}

  async connect(): Promise<void> {
    const timeout = this.cfg.connectTimeoutMs ?? 10_000;
    let sock: net.Socket | tls.TLSSocket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: this.cfg.host, port: this.cfg.port });
      const t = setTimeout(() => { s.destroy(); reject(new Error('Database connect timeout')); }, timeout);
      s.once('connect', () => { clearTimeout(t); resolve(s); });
      s.once('error', (e) => { clearTimeout(t); reject(e); });
    });

    if (this.cfg.ssl) {
      const sslCfg = this.cfg.ssl;
      // SSLRequest: length 8, code 80877103
      sock.write(new Writer().int32(80877103).msg(null));
      const answer: string = await new Promise((resolve, reject) => {
        sock.once('data', (d) => resolve(String.fromCharCode(d[0]!)));
        sock.once('error', reject);
      });
      if (answer !== 'S') throw new Error('Server refused TLS; refusing to continue without it');
      sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const s = tls.connect({ socket: sock as net.Socket, servername: this.cfg.host, rejectUnauthorized: sslCfg.rejectUnauthorized ?? true, ca: sslCfg.ca });
        s.once('secureConnect', () => resolve(s));
        s.once('error', reject);
      });
    }

    this.socket = sock;
    sock.on('data', (d: Buffer) => this.onData(d));
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('Database connection closed')));

    await this.startup();
  }

  private fail(e: Error) {
    this.broken = true;
    const q = this.queue.splice(0);
    for (const p of q) p.reject(e);
    this.onAuthMessage?.('!', Buffer.from(e.message));
  }

  private startup(): Promise<void> {
    return new Promise((resolve, reject) => {
      const params: [string, string][] = [
        ['user', this.cfg.user],
        ['database', this.cfg.database],
        ['application_name', this.cfg.applicationName ?? 'forgehse-api'],
        ['client_encoding', 'UTF8'],
        ['DateStyle', 'ISO'],
        ['TimeZone', 'UTC'],
      ];
      if (this.cfg.statementTimeoutMs) params.push(['options', `-c statement_timeout=${this.cfg.statementTimeoutMs}`]);
      const w = new Writer().int32(196608);
      for (const [k, v] of params) w.cstr(k).cstr(v);
      w.bytes(Buffer.from([0]));

      let scram: { nonce: string; clientFirstBare: string; serverSignature?: Buffer } | null = null;
      this.onAuthMessage = (type, body) => {
        try {
          if (type === '!') return reject(new Error(body.toString()));
          if (type === 'E') return reject(new PgError(readFields(body)));
          if (type === 'Z') { this.onAuthMessage = undefined; return resolve(); }
          if (type !== 'R') return; // ParameterStatus, BackendKeyData, Notice — ignore
          const code = body.readInt32BE(0);
          const pw = this.cfg.password ?? '';
          if (code === 0) return; // AuthenticationOk
          if (code === 3) { this.socket.write(new Writer().cstr(pw).msg('p')); return; }
          if (code === 5) {
            const salt = body.subarray(4, 8);
            const inner = crypto.createHash('md5').update(pw + this.cfg.user).digest('hex');
            const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
            this.socket.write(new Writer().cstr('md5' + outer).msg('p'));
            return;
          }
          if (code === 10) {
            const mechs = body.subarray(4).toString().split('\0');
            if (!mechs.includes('SCRAM-SHA-256')) throw new Error('Unsupported SASL mechanism');
            const nonce = crypto.randomBytes(18).toString('base64');
            const clientFirstBare = `n=*,r=${nonce}`;
            scram = { nonce, clientFirstBare };
            const first = Buffer.from('n,,' + clientFirstBare);
            this.socket.write(new Writer().cstr('SCRAM-SHA-256').int32(first.length).bytes(first).msg('p'));
            return;
          }
          if (code === 11 && scram) {
            const serverFirst = body.subarray(4).toString();
            const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
            if (!attrs.r?.startsWith(scram.nonce)) throw new Error('SCRAM nonce mismatch');
            const salted = crypto.pbkdf2Sync(pw.normalize('NFKC'), Buffer.from(attrs.s!, 'base64'), Number(attrs.i), 32, 'sha256');
            const clientKey = hmac(salted, 'Client Key');
            const storedKey = sha256(clientKey);
            const clientFinalNoProof = `c=biws,r=${attrs.r}`;
            const authMessage = `${scram.clientFirstBare},${serverFirst},${clientFinalNoProof}`;
            const proof = xor(clientKey, hmac(storedKey, authMessage)).toString('base64');
            scram.serverSignature = hmac(hmac(salted, 'Server Key'), authMessage);
            this.socket.write(new Writer().bytes(Buffer.from(`${clientFinalNoProof},p=${proof}`)).msg('p'));
            return;
          }
          if (code === 12 && scram) {
            const v = body.subarray(4).toString().split(',').find((p) => p.startsWith('v='));
            if (!v || !crypto.timingSafeEqual(Buffer.from(v.slice(2), 'base64'), scram.serverSignature!)) throw new Error('SCRAM server signature mismatch');
            return;
          }
          throw new Error(`Unsupported authentication method ${code}`);
        } catch (e) {
          reject(e as Error);
          this.socket.destroy();
        }
      };
      this.socket.write(w.msg(null));
    });
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]!);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      if (this.onAuthMessage) { this.onAuthMessage(type, body); continue; }
      this.handle(type, body);
    }
  }

  private handle(type: string, body: Buffer) {
    const cur = this.queue[0];
    switch (type) {
      case 'T': { // RowDescription
        if (!cur) return;
        const n = body.readInt16BE(0);
        let i = 2;
        cur.fields = [];
        for (let f = 0; f < n; f++) {
          const end = body.indexOf(0, i);
          const name = body.toString('utf8', i, end);
          i = end + 1;
          const oid = body.readInt32BE(i + 6);
          i += 18;
          cur.fields.push({ name, oid });
        }
        return;
      }
      case 'D': { // DataRow
        if (!cur) return;
        const n = body.readInt16BE(0);
        let i = 2;
        const row: Record<string, unknown> = {};
        for (let c = 0; c < n; c++) {
          const len = body.readInt32BE(i);
          i += 4;
          const field = cur.fields[c]!;
          if (len === -1) row[field.name] = null;
          else {
            const raw = body.toString('utf8', i, i + len);
            try { row[field.name] = parseValue(field.oid, raw); } catch { row[field.name] = raw; }
            i += len;
          }
        }
        cur.rows.push(row);
        return;
      }
      case 'C': if (cur) cur.command = body.toString('utf8', 0, body.length - 1); return;
      case 'E': if (cur) cur.error = new PgError(readFields(body)); return;
      case 'Z': { // ReadyForQuery — end of one request
        const p = this.queue.shift();
        if (!p) return;
        if (p.error) p.reject(p.error);
        else {
          const m = /(\d+)$/.exec(p.command);
          p.resolve({ rows: p.rows, rowCount: m ? Number(m[1]) : p.rows.length, command: p.command.split(' ')[0] ?? '' });
        }
        return;
      }
      default: return; // '1','2','n','N','S','K','I','s' etc.
    }
  }

  private enqueue<T>(payload: Buffer): Promise<QueryResult<T>> {
    if (this.broken) return Promise.reject(new Error('Database connection is broken'));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, rows: [], fields: [], command: '' });
      this.socket.write(payload);
    });
  }

  /** Parameterised query via the extended protocol. */
  query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const parse = new Writer().cstr('').cstr(sql).int16(0).msg('P');
    const bind = new Writer().cstr('').cstr('').int16(0).int16(params.length);
    for (const p of params) {
      const s = serializeParam(p);
      if (s === null) bind.int32(-1);
      else { const b = Buffer.from(s, 'utf8'); bind.int32(b.length).bytes(b); }
    }
    bind.int16(0);
    const describe = new Writer().bytes(Buffer.from('P')).cstr('').msg('D');
    const execute = new Writer().cstr('').int32(0).msg('E');
    const sync = new Writer().msg('S');
    return this.enqueue<T>(Buffer.concat([parse, bind.msg('B'), describe, execute, sync]));
  }

  /** Simple query protocol — multi-statement SQL, no parameters. Used for migrations only. */
  simple(sql: string): Promise<QueryResult> {
    return this.enqueue(new Writer().cstr(sql).msg('Q'));
  }

  async close(): Promise<void> {
    if (this.broken) return;
    this.broken = true;
    try { this.socket.end(new Writer().msg('X')); } catch { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ pool */

export class PgPool {
  private idle: PgConnection[] = [];
  private total = 0;
  private waiters: ((c: PgConnection) => void)[] = [];
  private ended = false;

  constructor(private cfg: PgConfig, private max = 10) {}

  async acquire(): Promise<PgConnection> {
    if (this.ended) throw new Error('Pool has been closed');
    while (this.idle.length) {
      const c = this.idle.pop()!;
      if (!c.broken) return c;
      this.total--;
    }
    if (this.total < this.max) {
      this.total++;
      const c = new PgConnection(this.cfg);
      try { await c.connect(); } catch (e) { this.total--; throw e; }
      return c;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(c: PgConnection) {
    if (c.broken) {
      this.total--;
      const waiter = this.waiters.shift();
      if (waiter) {
        // Replace the broken connection for whoever is waiting, so they don't hang forever.
        this.total++;
        const fresh = new PgConnection(this.cfg);
        fresh.connect().then(() => waiter(fresh), () => { this.total--; this.waiters.unshift(waiter); });
      }
      return;
    }
    const w = this.waiters.shift();
    if (w) w(c);
    else this.idle.push(c);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const c = await this.acquire();
    try { return await c.query<T>(sql, params); } finally { this.release(c); }
  }

  async end() {
    this.ended = true;
    await Promise.all(this.idle.map((c) => c.close()));
    this.idle = [];
  }
}
