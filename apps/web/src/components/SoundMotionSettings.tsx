/** Sound & motion preferences (per browser). Sound is off by default and is always optional feedback. */
import { useState } from 'react';
import { sound, DEFAULT_SOUND_PREFS, type SoundCategory, type SoundPrefs, type SoundProfile } from '../lib/sound';
import { setUserReducedMotion, userReducedMotion } from '../lib/motion';
import { Icon } from './ui';

const CATS: { id: SoundCategory; label: string; hint: string }[] = [
  { id: 'click', label: 'Interface clicks', hint: 'Buttons and links' },
  { id: 'selection', label: 'Selections', hint: 'Choosing a mode, filter or option' },
  { id: 'transition', label: 'Transitions', hint: 'Drawers and panels opening' },
  { id: 'content', label: 'Content ready', hint: 'An AI answer or a generated draft has arrived' },
  { id: 'success', label: 'Success', hint: 'Only after the server confirms a save' },
  { id: 'error', label: 'Errors', hint: 'Only when an operation actually failed' },
  { id: 'notification', label: 'Notifications', hint: 'Relevant notifications' },
];

function Switch({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <span className="switch"><input id={id} type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} /><span /></span>;
}

export function SoundMotionSettings() {
  const [p, setP] = useState<SoundPrefs>(sound.prefs);
  const [reduce, setReduce] = useState(userReducedMotion());
  const update = (next: SoundPrefs) => { setP(next); sound.savePreferences(next); };
  return (
    <section className="panel panel-body stack" aria-labelledby="sm-title">
      <h2 id="sm-title">Sound &amp; motion</h2>
      <p className="small muted">Sound is optional feedback and is never the only way FORGEHSE tells you something. It does not replace site alarms or emergency warning systems.</p>
      <div>
        <div className="setting-row"><div className="txt"><b>Interface sound</b><span>Master switch — off by default</span></div><Switch id="snd-master" label="Interface sound" checked={p.master} onChange={(v) => { update({ ...p, master: v }); if (v) { sound.unlock(); sound.play('selection', { preview: true }); } }} /></div>
        {p.master && (
          <>
            <div className="setting-row"><div className="txt"><b>Profile</b><span>Overall loudness character</span></div>
              <div className="segmented" role="group" aria-label="Sound profile">{(['quiet', 'balanced', 'enhanced'] as SoundProfile[]).map((x) => <button key={x} type="button" aria-pressed={p.profile === x} onClick={() => update({ ...p, profile: x })}>{x[0]!.toUpperCase() + x.slice(1)}</button>)}</div></div>
            <div className="setting-row"><div className="txt"><b>Volume</b><span>{Math.round(p.volume * 100)}%</span></div>
              <input type="range" min={0} max={100} value={Math.round(p.volume * 100)} aria-label="Volume" onChange={(e) => update({ ...p, volume: Number(e.target.value) / 100 })} style={{ width: 160 }} /></div>
            {CATS.map((c) => (
              <div className="setting-row" key={c.id}><div className="txt"><b>{c.label}</b><span>{c.hint}</span></div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { sound.unlock(); sound.play(c.id, { preview: true }); }} aria-label={`Preview ${c.label}`}><Icon name="volume" size={15} /></button>
                <Switch id={`snd-${c.id}`} label={c.label} checked={p.categories[c.id]} onChange={(v) => update({ ...p, categories: { ...p.categories, [c.id]: v } })} /></div>
            ))}
            <div className="row"><button type="button" className="btn btn-sm" onClick={() => update(structuredClone({ ...DEFAULT_SOUND_PREFS, master: true }))}>Reset sound preferences</button></div>
          </>
        )}
        <div className="setting-row"><div className="txt"><b>Reduce motion</b><span>Turns off 3D tilt, light effects, transitions and count-up numbers. Your device setting is always respected too.</span></div>
          <Switch id="reduce-motion" label="Reduce motion" checked={reduce} onChange={(v) => { setReduce(v); setUserReducedMotion(v); }} /></div>
      </div>
    </section>
  );
}
