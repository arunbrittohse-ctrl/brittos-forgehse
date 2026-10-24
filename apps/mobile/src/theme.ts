import { StyleSheet } from 'react-native';

export const C = {
  // Brand palette shared with the web app (v0.2): Midnight Navy, Electric Blue, Teal, Platinum, Slate.
  midnight: '#0B1F3B', navy: '#0B1F3B', electric: '#2563EB', teal: '#0F766E', platinum: '#C7D2FE',
  ink: '#0B1F3B', muted: '#5B6B82', line: '#E2E8F0', bg: '#F5F7FB', white: '#FFFFFF',
  low: '#0E8A7E', medium: '#A86206', high: '#C2410C', critical: '#B42318',
};
export const BAND_COLOR: Record<string, string> = { low: C.low, medium: C.medium, high: C.high, critical: C.critical };

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16 },
  h1: { fontSize: 24, fontWeight: '600', color: C.ink, letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '600', color: C.ink },
  body: { fontSize: 15, color: C.ink, lineHeight: 21 },
  muted: { fontSize: 13, color: C.muted },
  label: { fontSize: 13, fontWeight: '500', color: C.muted, marginBottom: 6, marginTop: 14 },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#C4CCD8', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.white, fontSize: 15, color: C.ink },
  card: { backgroundColor: C.white, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10 },
  btn: { minHeight: 48, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: C.electric },
  btnText: { color: C.white, fontWeight: '600', fontSize: 15 },
  btnSecondary: { backgroundColor: C.white, borderWidth: 1, borderColor: '#C4CCD8' },
  btnSecondaryText: { color: C.ink, fontWeight: '500', fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#C4CCD8', marginRight: 8, marginBottom: 8, backgroundColor: C.white },
  chipOn: { backgroundColor: C.navy, borderColor: C.navy },
  error: { backgroundColor: '#FDE4E2', color: C.ink, padding: 12, borderRadius: 6, marginTop: 12 },
});
