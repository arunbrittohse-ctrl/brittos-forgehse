/**
 * Database value conventions shared by every query, independent of the driver:
 * how PostgreSQL text values become JS values, and how JS parameters are sent.
 * Kept identical to the original in-house client so no caller sees a behaviour change.
 */

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

export function parseValue(oid: number, text: string): unknown {
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

