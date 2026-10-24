import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (memory-hard, built into Node).
 * Stored format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
 * Parameters are embedded so they can be raised later; `needsRehash` flags old hashes on login.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

function scrypt(pw: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pw.normalize('NFKC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 128 * PARAMS.N * PARAMS.r * 2 });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const N = Number(n), R = Number(r);
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, { N, r: R, p: Number(p), maxmem: 128 * N * R * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split('$');
  return Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

/** A valid hash of a random password, used to equalise timing when the account does not exist. */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(16).toString('hex')));
}
