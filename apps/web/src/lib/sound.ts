/**
 * FORGEHSE interface sound: supplementary feedback only, OFF by default, never autoplayed.
 * Tones are synthesised with the Web Audio API (no audio files, no licensing questions).
 * One shared AudioContext is created lazily on the first user gesture. Every call is wrapped so
 * an audio failure can never block a save or a workflow. Sound never replaces visible feedback.
 */
import { readPref, writePref } from './hooks';

export type SoundCategory = 'click' | 'selection' | 'transition' | 'content' | 'success' | 'error' | 'notification';
export type SoundProfile = 'quiet' | 'balanced' | 'enhanced';

export interface SoundPrefs {
  master: boolean;
  volume: number; // 0..1
  profile: SoundProfile;
  categories: Record<SoundCategory, boolean>;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  master: false,
  volume: 0.5,
  profile: 'balanced',
  categories: { click: false, selection: true, transition: false, content: true, success: true, error: true, notification: true },
};

const PROFILE_GAIN: Record<SoundProfile, number> = { quiet: 0.35, balanced: 0.6, enhanced: 0.9 };
const THROTTLE_MS: Record<SoundCategory, number> = { click: 60, selection: 90, transition: 160, content: 400, success: 300, error: 300, notification: 1500 };

type Tone = { f: number; to?: number; d: number; at?: number; type?: OscillatorType; g?: number };
const VOICES: Record<SoundCategory, Tone[]> = {
  click: [{ f: 1800, to: 1200, d: 0.03, type: 'triangle', g: 0.5 }],
  selection: [{ f: 880, to: 1320, d: 0.06, type: 'sine', g: 0.6 }],
  transition: [{ f: 420, to: 620, d: 0.12, type: 'sine', g: 0.35 }],
  content: [{ f: 660, d: 0.07, type: 'sine', g: 0.4 }, { f: 990, d: 0.09, at: 0.06, type: 'sine', g: 0.35 }],
  success: [{ f: 784, d: 0.08, type: 'sine', g: 0.55 }, { f: 1175, d: 0.14, at: 0.07, type: 'sine', g: 0.5 }],
  error: [{ f: 330, to: 247, d: 0.16, type: 'triangle', g: 0.6 }],
  notification: [{ f: 988, d: 0.08, type: 'sine', g: 0.5 }, { f: 1319, d: 0.08, at: 0.1, type: 'sine', g: 0.45 }, { f: 1568, d: 0.16, at: 0.2, type: 'sine', g: 0.4 }],
};

type Ctor = typeof AudioContext;

export class AudioService {
  private ctx: AudioContext | null = null;
  private last = new Map<SoundCategory, number>();
  private active = new Set<OscillatorNode>();
  prefs: SoundPrefs;

  constructor(private env: { AudioContextImpl?: Ctor | null; now?: () => number; load?: () => string | null; save?: (v: string) => void } = {}) {
    this.prefs = this.loadPreferences();
  }

  loadPreferences(): SoundPrefs {
    try {
      const raw = this.env.load ? this.env.load() : readPref('sound', '');
      if (!raw) return structuredClone(DEFAULT_SOUND_PREFS);
      const p = JSON.parse(raw) as Partial<SoundPrefs>;
      return {
        master: p.master === true,
        volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : DEFAULT_SOUND_PREFS.volume,
        profile: p.profile && p.profile in PROFILE_GAIN ? p.profile : 'balanced',
        categories: { ...DEFAULT_SOUND_PREFS.categories, ...(p.categories ?? {}) },
      };
    } catch { return structuredClone(DEFAULT_SOUND_PREFS); }
  }

  savePreferences(next: SoundPrefs = this.prefs) {
    this.prefs = next;
    const v = JSON.stringify(next);
    try { if (this.env.save) this.env.save(v); else writePref('sound', v); } catch { /* storage unavailable */ }
    if (!next.master) this.stopAll();
  }

  setMasterEnabled(on: boolean) { this.savePreferences({ ...this.prefs, master: on }); }
  setVolume(v: number) { this.savePreferences({ ...this.prefs, volume: Math.min(1, Math.max(0, v)) }); }
  resetPreferences() { this.savePreferences(structuredClone(DEFAULT_SOUND_PREFS)); }

  /** Must be called from a user gesture handler before the first sound can play. */
  unlock() {
    if (this.ctx) { void this.ctx.resume?.().catch(() => undefined); return; }
    const Impl = this.env.AudioContextImpl !== undefined ? this.env.AudioContextImpl : (typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ?? null) : null);
    if (!Impl) return;
    try { this.ctx = new Impl(); } catch { this.ctx = null; }
  }

  /** Returns true when a sound was actually scheduled. */
  play(cat: SoundCategory, opts: { preview?: boolean } = {}): boolean {
    try {
      if (!opts.preview && (!this.prefs.master || !this.prefs.categories[cat])) return false;
      const now = (this.env.now ?? Date.now)();
      if (now - (this.last.get(cat) ?? -Infinity) < THROTTLE_MS[cat]) return false;
      this.last.set(cat, now);
      if (!this.ctx) this.unlock();
      const ctx = this.ctx;
      if (!ctx) return false;
      if (ctx.state === 'suspended') void ctx.resume?.().catch(() => undefined);
      const master = this.prefs.volume * PROFILE_GAIN[this.prefs.profile] * 0.25;
      const t0 = ctx.currentTime + 0.005;
      for (const v of VOICES[cat]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = v.type ?? 'sine';
        const s = t0 + (v.at ?? 0);
        osc.frequency.setValueAtTime(v.f, s);
        if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, s + v.d);
        gain.gain.setValueAtTime(0.0001, s);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, master * (v.g ?? 0.5)), s + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, s + v.d);
        osc.connect(gain).connect(ctx.destination);
        osc.start(s); osc.stop(s + v.d + 0.02);
        this.active.add(osc);
        osc.onended = () => { this.active.delete(osc); try { gain.disconnect(); } catch { /* noop */ } };
      }
      return true;
    } catch { return false; }
  }

  playClick() { return this.play('click'); }
  playSelection() { return this.play('selection'); }
  playTransition() { return this.play('transition'); }
  playContent() { return this.play('content'); }
  playSuccess() { return this.play('success'); }
  playError() { return this.play('error'); }
  playNotification() { return this.play('notification'); }

  stopAll() {
    for (const o of this.active) { try { o.stop(); } catch { /* already stopped */ } }
    this.active.clear();
  }
}

export const sound = new AudioService();
if (typeof window !== 'undefined') {
  const unlock = () => { if (sound.prefs.master) sound.unlock(); };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}
