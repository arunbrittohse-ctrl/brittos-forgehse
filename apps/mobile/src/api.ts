import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { SendError, isPermanentStatus, type Transport, type QueuedPhoto } from './offline/queue';

/**
 * API client for the field app. The session token lives in the Android Keystore via
 * expo-secure-store (never in AsyncStorage). No API keys of any kind are in the app.
 */
/** Build-time default; the user can change it on the sign-in screen (stored on the device). */
export const DEFAULT_SERVER: string = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? '';
const TOKEN_KEY = 'fhse.session';
const SERVER_KEY = 'fhse.server';
let server = DEFAULT_SERVER;
export const currentServer = () => server;

/** Accepts "forgehse.example.com" or "https://forgehse.example.com/"; returns "https://forgehse.example.com". */
export function normaliseServer(input: string): string {
  let v = input.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
}
export async function loadServer() { server = (await SecureStore.getItemAsync(SERVER_KEY)) || DEFAULT_SERVER; return server; }
export async function saveServer(v: string) { server = normaliseServer(v); await SecureStore.setItemAsync(SERVER_KEY, server); return server; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

let token: string | null = null;
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: () => void) { onSessionExpired = fn; }

export async function loadToken() { token = await SecureStore.getItemAsync(TOKEN_KEY); return token; }
export async function saveToken(t: string) { token = t; await SecureStore.setItemAsync(TOKEN_KEY, t, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
export async function clearToken() { token = null; await SecureStore.deleteItemAsync(TOKEN_KEY); }

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    if (!server) throw new ApiError(0, 'no_server', 'Enter your FORGEHSE server address first.');
    res = await fetch(`${server}/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ac.signal,
    });
  } catch {
    throw new ApiError(0, 'network', 'No connection to the server.');
  } finally { clearTimeout(timer); }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) { await clearToken(); onSessionExpired?.(); }
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Transport used by the offline queue. Maps HTTP results to retryable vs permanent failures. */
export const queueTransport: Transport = {
  async createObservation(payload) {
    try {
      const r = await api<{ id: string; refNo: string }>('/observations', { body: payload });
      return { ok: true, id: r.id, refNo: r.refNo };
    } catch (e) {
      if (e instanceof ApiError) throw new SendError(e.message, isPermanentStatus(e.status));
      throw new SendError((e as Error).message, false);
    }
  },
  async uploadPhoto(observationId: string, photo: QueuedPhoto) {
    const url = `${server}/api/observations/${observationId}/attachments?filename=${encodeURIComponent(photo.name)}`;
    const r = await FileSystem.uploadAsync(url, photo.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': photo.mimeType, Authorization: `Bearer ${token ?? ''}` },
    });
    if (r.status >= 200 && r.status < 300) {
      await FileSystem.deleteAsync(photo.uri, { idempotent: true }); // local copy no longer needed
      return;
    }
    let msg = `Photo upload failed (${r.status})`;
    try { msg = JSON.parse(r.body).error.message ?? msg; } catch { /* keep default */ }
    throw new SendError(msg, isPermanentStatus(r.status));
  },
};
