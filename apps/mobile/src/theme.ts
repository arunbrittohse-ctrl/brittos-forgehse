import { StyleSheet } from 'react-native';

export const C = {
  // Same tokens as the web app — see DESIGN.md. Every text pair meets WCAG AA (4.5:1).
  midnight: '#0B1F3B', navy: '#0B1F3B', electric: '#2563EB', teal: '#0F766E', platinum: '#C7D2FE',
  ink: '#0B1F3B', muted: '#5B6B82', line: '#E2E8F0', fieldBorder: '#7B8AA0', bg: '#F5F7FB', white: '#FFFFFF',
  low: '#0F766E', medium: '#92400E', high: '#C2410C', critical: '#B91C1C',
};
/** Type and spacing scale shared with the web (DESIGN.md). */
export const FS = { xs: 12, sm: 14, base: 16, md: 18, lg: 20, xl: 26 } as const;
export const SP = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;
export const BAND_COLOR: Record<string, string> = { low: C.low, medium: C.medium, high: C.high, critical: C.critical };

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16 },
  h1: { fontSize: 24, fontWeight: '600', color: C.ink, letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '600', color: C.ink },
  body: { fontSize: 16, color: C.ink, lineHeight: 24 },
  muted: { fontSize: 14, color: C.muted },
  label: { fontSize: 14, fontWeight: '500', color: C.muted, marginBottom: 6, marginTop: 14 },
  input: { minHeight: 46, borderWidth: 1, borderColor: C.fieldBorder, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.white, fontSize: 16, color: C.ink },
  card: { backgroundColor: C.white, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10 },
  btn: { minHeight: 48, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: C.electric },
  btnText: { color: C.white, fontWeight: '600', fontSize: 15 },
  btnSecondary: { backgroundColor: C.white, borderWidth: 1, borderColor: C.fieldBorder },
  btnSecondaryText: { color: C.ink, fontWeight: '500', fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.fieldBorder, marginRight: 8, marginBottom: 8, backgroundColor: C.white },
  chipOn: { backgroundColor: C.navy, borderColor: C.navy },
  error: { backgroundColor: '#FDE4E2', color: C.ink, padding: 12, borderRadius: 6, marginTop: 12 },
});
