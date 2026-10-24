/**
 * Voice: dictation through the browser's speech recognition (Chrome, Edge, Safari) and optional
 * read-aloud through speech synthesis. Feature-detected; where unsupported the UI says so instead
 * of failing. Audio is processed by the browser/OS speech service, not by FORGEHSE.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const VOICE_LANGS = [
  { code: 'en-GB', label: 'English (UK)' }, { code: 'en-US', label: 'English (US)' }, { code: 'en-IN', label: 'English (India)' },
  { code: 'ar-AE', label: 'العربية (الإمارات)' }, { code: 'hi-IN', label: 'हिन्दी' }, { code: 'ur-PK', label: 'اردو' }, { code: 'ta-IN', label: 'தமிழ்' },
];

export function useDictation(onText: (finalText: string, interim: string) => void, lang = 'en-GB') {
  const supported = typeof window !== 'undefined' && !!ctor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [level, setLevel] = useState<number[]>([0.2, 0.2, 0.2, 0.2, 0.2]);
  const rec = useRef<Recognition | null>(null);
  const meter = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stopMeter = () => {
    const m = meter.current; meter.current = null;
    if (!m) return;
    cancelAnimationFrame(m.raf); m.stream.getTracks().forEach((t) => t.stop()); void m.ctx.close().catch(() => undefined);
    setLevel([0.2, 0.2, 0.2, 0.2, 0.2]);
  };

  const stop = useCallback(() => { rec.current?.stop(); stopMeter(); }, []);

  const start = useCallback(async () => {
    const C = ctor();
    if (!C) { setError('Voice input is not supported in this browser. Try Chrome, Edge or Safari.'); return; }
    setError('');
    const r = new C();
    r.lang = lang; r.continuous = true; r.interimResults = true;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0].transcript + ' ';
        else interim += res[0].transcript;
      }
      cb.current(finalText.trim(), interim);
    };
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was denied.' : e.error === 'no-speech' ? 'No speech detected.' : 'Voice input stopped.');
    };
    r.onend = () => { setListening(false); stopMeter(); rec.current = null; };
    rec.current = r;
    try { r.start(); setListening(true); } catch { setError('Voice input could not start.'); return; }
    // Live level meter (visual feedback only; audio is not recorded or uploaded by FORGEHSE).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(data);
        setLevel([2, 5, 8, 11, 14].map((b) => Math.max(0.15, Math.min(1, (data[b] ?? 0) / 200))));
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };
      meter.current = { stream, ctx, raf: requestAnimationFrame(tick) };
    } catch { /* meter is optional */ }
  }, [lang]);

  useEffect(() => () => { rec.current?.abort(); stopMeter(); }, []);
  return { supported, listening, error, level, start, stop };
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Read text aloud (Markdown stripped). Returns a stop function. */
export function speak(text: string, lang = 'en-GB'): () => void {
  if (!canSpeak()) return () => undefined;
  window.speechSynthesis.cancel();
  const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[#*_`>|]/g, '').replace(/\[(OBS-[^\]]+)\]/g, '$1').replace(/\n{2,}/g, '. ');
  const u = new SpeechSynthesisUtterance(plain.slice(0, 4000));
  u.lang = lang; u.rate = 1.03;
  window.speechSynthesis.speak(u);
  return () => window.speechSynthesis.cancel();
}
