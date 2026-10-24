let tz = 'Asia/Dubai';
export function setTimezone(z: string) { tz = z; }

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00Z') : new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : tz });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
}
export function todayISO(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));
  return parts;
}
/** Value for <input type="datetime-local"> in the organisation time zone. */
export function nowLocalInput(): string {
  const d = new Date();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
/** Convert a datetime-local value (organisation time zone) to an ISO string with offset. */
export function localInputToISO(v: string): string {
  const asUtc = new Date(v + ':00Z');
  const offset = tzOffsetMinutes(asUtc);
  return new Date(asUtc.getTime() - offset * 60_000).toISOString();
}
function tzOffsetMinutes(at: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(p);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}
export function plural(n: number, one: string, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }
export function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
export function compact(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
