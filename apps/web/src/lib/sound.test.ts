import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioService, DEFAULT_SOUND_PREFS } from './sound';

class FakeParam { setValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeOsc { type = 'sine'; frequency = new FakeParam(); onended: (() => void) | null = null; stopped = false; static made = 0;
  constructor() { FakeOsc.made++; } connect(n: unknown) { return n; } start() {} stop() { this.stopped = true; } }
class FakeGain { gain = new FakeParam(); connect(n: unknown) { return n; } disconnect() {} }
class FakeCtx { currentTime = 0; state = 'running'; destination = {}; static made = 0;
  constructor() { FakeCtx.made++; } createOscillator() { return new FakeOsc(); } createGain() { return new FakeGain(); } resume() { return Promise.resolve(); } }

function svc(opts: { stored?: string | null; now?: () => number; ctx?: unknown } = {}) {
  let store = opts.stored ?? null;
  const s = new AudioService({ AudioContextImpl: (opts.ctx === undefined ? FakeCtx : opts.ctx) as never, now: opts.now ?? (() => 0), load: () => store, save: (v) => { store = v; } });
  return { s, stored: () => store };
}

describe('AudioService', () => {
  it('is off by default and plays nothing', () => {
    const before = FakeOsc.made;
    const { s } = svc();
    assert.equal(s.prefs.master, false);
    assert.equal(s.playSuccess(), false);
    assert.equal(FakeOsc.made, before);
  });
  it('plays only enabled categories once the master switch is on, and reuses one AudioContext', () => {
    const { s } = svc();
    const ctxBefore = FakeCtx.made;
    s.setMasterEnabled(true);
    assert.equal(s.playSuccess(), true);
    assert.equal(s.playClick(), false, 'click sounds are off by default');
    let t = 1000;
    const s2 = svc({ now: () => (t += 1000) }).s;
    s2.setMasterEnabled(true);
    s2.playSuccess(); s2.playError(); s2.playContent();
    assert.ok(FakeCtx.made - ctxBefore <= 2, 'one context per service, not per sound');
  });
  it('throttles rapid repeats of the same cue', () => {
    let t = 0;
    const { s } = svc({ now: () => t });
    s.setMasterEnabled(true);
    assert.equal(s.playSelection(), true);
    t = 30; assert.equal(s.playSelection(), false);
    t = 500; assert.equal(s.playSelection(), true);
  });
  it('preview plays even with master off (settings screen only)', () => {
    const { s } = svc();
    assert.equal(s.play('success', { preview: true }), true);
  });
  it('never throws when audio is unavailable or blocked', () => {
    const none = svc({ ctx: null }).s;
    none.setMasterEnabled(true);
    assert.equal(none.playSuccess(), false);
    const boom = svc({ ctx: class { constructor() { throw new Error('blocked'); } } }).s;
    boom.setMasterEnabled(true);
    assert.doesNotThrow(() => boom.playError());
    assert.equal(boom.playError(), false);
  });
  it('persists preferences and sanitises bad stored values', () => {
    const { s, stored } = svc();
    s.setVolume(2);
    assert.equal(s.prefs.volume, 1);
    s.savePreferences({ ...s.prefs, master: true, profile: 'quiet' });
    const again = svc({ stored: stored() }).s;
    assert.equal(again.prefs.master, true);
    assert.equal(again.prefs.profile, 'quiet');
    const bad = svc({ stored: '{"volume":"loud","profile":"party","master":"yes"}' }).s;
    assert.equal(bad.prefs.volume, DEFAULT_SOUND_PREFS.volume);
    assert.equal(bad.prefs.profile, 'balanced');
    assert.equal(bad.prefs.master, false);
    assert.equal(svc({ stored: 'not json' }).s.prefs.master, false);
  });
  it('muting stops sounds that are still playing', () => {
    let t = 0;
    const { s } = svc({ now: () => (t += 1000) });
    s.setMasterEnabled(true);
    s.playNotification();
    const active = (s as unknown as { active: Set<FakeOsc> }).active;
    const oscs = [...active];
    assert.ok(oscs.length > 0);
    s.setMasterEnabled(false);
    assert.ok(oscs.every((o) => o.stopped));
  });
});
