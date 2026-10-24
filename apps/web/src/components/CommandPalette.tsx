/** ⌘K / Ctrl+K command palette: jump anywhere, start an AI request or a Studio draft from one line. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { withViewTransition } from '../lib/motion';
import { sound } from '../lib/sound';
import { Icon } from './ui';
import type { Permission } from '@forgehse/shared';

interface Cmd { id: string; group: string; label: string; icon: string; hint?: string; ai?: boolean; perm?: Permission; run: (q: string) => void }

const go = (to: string) => withViewTransition(() => navigate(to));

export function CommandPalette({ open, onClose, onToggleTheme }: { open: boolean; onClose: () => void; onToggleTheme: () => void }) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const ask = (mode: string, prefix = '') => (query: string) => go(`/app/studio?mode=${mode}&q=${encodeURIComponent(prefix + query)}&send=1`);
    const base: Cmd[] = [
      { id: 'dash', group: 'Go to', label: 'Command centre', icon: 'dashboard', perm: 'dashboard.view', run: () => go('/app') },
      { id: 'studio', group: 'Go to', label: 'AI Studio', icon: 'spark', perm: 'ai.use', run: () => go('/app/studio') },
      { id: 'lib', group: 'Go to', label: 'Studio library', icon: 'library', run: () => go('/app/studio/library') },
      { id: 'obs', group: 'Go to', label: 'Observations', icon: 'eye', perm: 'observation.view', run: () => go('/app/observations') },
      { id: 'report', group: 'Go to', label: 'Report an observation', icon: 'plus', perm: 'observation.create', run: () => go('/app/report') },
      { id: 'audit', group: 'Go to', label: 'Audit trail', icon: 'shield', perm: 'audit.view', run: () => go('/app/audit') },
      { id: 'account', group: 'Go to', label: 'Account, sound & motion', icon: 'user', run: () => go('/app/account') },
      { id: 'theme', group: 'Settings', label: 'Toggle light / dark theme', icon: 'moon', run: () => onToggleTheme() },
    ];
    return base.filter((c) => !c.perm || can(c.perm));
  }, [can, onToggleTheme]);

  const aiCmds = useMemo<Cmd[]>(() => {
    if (!q.trim() || !can('ai.use')) return [];
    const t = q.trim();
    const mk = (id: string, label: string, icon: string, mode: string): Cmd => ({ id, group: 'AI Studio', label, icon, ai: true, hint: 'Enter', run: () => go(`/app/studio?mode=${mode}&q=${encodeURIComponent(t)}&send=1`) });
    return [
      mk('ai-ask', `Ask AI: “${t}”`, 'spark', 'ask'),
      mk('ai-check', `Create a checklist: “${t}”`, 'checklist', 'checklist'),
      mk('ai-doc', `Create an HSE document: “${t}”`, 'doc', 'document'),
      mk('ai-poster', `Design a poster: “${t}”`, 'image', 'poster'),
      mk('ai-flow', `Draw a flowchart: “${t}”`, 'flow', 'flowchart'),
    ];
  }, [q, can]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const nav = t ? commands.filter((c) => c.label.toLowerCase().includes(t)) : commands;
    return [...aiCmds.slice(0, 1), ...nav, ...aiCmds.slice(1)];
  }, [q, commands, aiCmds]);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => { setSel(0); }, [q]);

  if (!open) return null;
  const run = (c: Cmd | undefined) => { if (!c) return; sound.playSelection(); onClose(); c.run(q); };
  let lastGroup = '';
  return (
    <div className="cmdk-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-input">
          <Icon name="search" />
          <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, or type a request for AI…" aria-label="Command" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={filtered[sel] ? `cmd-${filtered[sel]!.id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(filtered[sel]); }
              else if (e.key === 'Escape') onClose();
            }} />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox">
          {filtered.length === 0 && <div className="cmdk-group">No matches</div>}
          {filtered.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="cmdk-group" key={`g-${c.group}-${i}`}>{c.group}</div> : null;
            lastGroup = c.group;
            return [head, (
              <div key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === sel} className={`cmdk-item ${c.ai ? 'ai' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
                <span className="ico"><Icon name={c.icon} size={16} /></span>{c.label}{c.hint && i === sel && <span className="hint">{c.hint}</span>}
              </div>
            )];
          })}
        </div>
        <div className="cmdk-foot"><span><span className="kbd">↑</span> <span className="kbd">↓</span> to move</span><span><span className="kbd">Enter</span> to open</span><span><span className="kbd">Ctrl</span> <span className="kbd">K</span> anytime</span></div>
      </div>
    </div>
  );
}
