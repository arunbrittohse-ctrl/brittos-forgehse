import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Brand } from './brand';
import { Icon } from './ui';
import { HseIcon } from './graphics';
import type { PosterIcon } from '@forgehse/shared';
import { CommandPalette } from './CommandPalette';
import { Link, useLocation } from '../lib/router';
import { useAuth } from '../lib/auth';
import { readPref, writePref } from '../lib/hooks';
import { sound } from '../lib/sound';

export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#071426' : '#0B1F3B');
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState(readPref('theme', 'light'));
  const [muted, setMuted] = useState(!sound.prefs.master);
  const toggleTheme = useCallback(() => { setTheme((cur) => { const t = cur === 'light' ? 'dark' : 'light'; writePref('theme', t); applyTheme(t); return t; }); }, []);
  const toggleSound = () => { const on = muted; sound.setMasterEnabled(on); setMuted(!on); if (on) { sound.unlock(); sound.play('selection', { preview: true }); } };
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setOpen(false); }, [path]);

  const item = (to: string, icon: string, label: string, exact = false, hse?: PosterIcon) => {
    const active = exact ? path === to : path === to || path.startsWith(to + '/');
    return <Link to={to} aria-current={active ? 'page' : undefined}>{hse ? <HseIcon name={hse} size={18} strokeWidth={4} /> : <Icon name={icon} />}{label}</Link>;
  };
  const primaryRole = me?.assignments[0]?.roleLabel ?? '';
  const studioActive = path === '/app/studio' || (path.startsWith('/app/studio/') && !path.startsWith('/app/studio/library') && !path.startsWith('/app/studio/items'));

  return (
    <div className="shell">
      <a href="#main" className="sr-only">Skip to content</a>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`rail ${open ? 'open' : ''}`} aria-label="Main navigation">
        <Link to="/app" className="brand-link" aria-label="Command centre"><Brand /></Link>
        <nav className="nav">
          {can('ai.use') && <Link to="/app/studio" className="nav-ai" aria-current={studioActive ? 'page' : undefined}><Icon name="spark" />AI Studio<span className="kbd">{isMac ? '⌘' : 'Ctrl'} K</span></Link>}
          {can('ai.use') && item('/app/studio/hse-documents', 'doc', 'HSE Document Studio')}
          <div className="nav-group">Overview</div>
          {can('dashboard.view') && item('/app', 'dashboard', 'Command centre', true)}
          <div className="nav-group">HSE operations</div>
          {can('observation.view') && item('/app/observations', 'eye', 'Observations', false, 'eye')}
          {can('observation.create') && item('/app/report', 'plus', 'Report observation', false, 'warning')}
          {item('/app/risk-assessments', 'shield', 'Risk assessments')}
          {item('/app/permits', 'checklist', 'Permits to Work')}
          {item('/app/inspections-audits', 'checklist', 'Inspections & audits')}
          {item('/app/incidents', 'alert', 'Incidents & near misses')}
          {item('/app/actions', 'checklist', 'HSE actions')}
          {item('/app/training', 'library', 'Training & competency')}
          {item('/app/contractors', 'users', 'Contractors')}
          {item('/app/environmental-health', 'globe', 'Environmental & health')}
          {item('/app/emergency', 'alert', 'Emergency readiness')}
          {item('/app/documents', 'doc', 'Controlled documents')}
          <div className="nav-group">Insights</div>
          {item('/app/analytics', 'chart', 'Analytics & reports')}
          {item('/app/studio/library', 'library', 'Studio library')}
          {can('ai.use') && item('/app/assistant', 'review', 'Classic assistant')}
          {(can('project.manage') || can('user.manage') || can('audit.view') || can('ai.usage.view')) && <div className="nav-group">Administration</div>}
          {can('project.manage') && item('/app/admin/projects', 'folder', 'Projects & sites')}
          {can('user.manage') && item('/app/admin/users', 'users', 'Users & roles', false, 'people')}
          {can('audit.view') && item('/app/audit', 'shield', 'Audit trail', false, 'shield_check')}
          {item('/app/settings', 'user', 'Administration & settings')}
          {can('ai.usage.view') && item('/app/ai-usage', 'chart', 'AI usage')}
        </nav>
        <div className="rail-foot">
          <div className="who">{me?.user.fullName}</div>
          <div style={{ opacity: 0.75 }}>{primaryRole}</div>
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            <Link to="/app/account" className="btn btn-sm btn-ghost" style={{ color: 'inherit' }}><Icon name="user" />Account</Link>
            <button className="btn btn-sm btn-ghost" style={{ color: 'inherit' }} onClick={() => void logout()}><Icon name="logout" />Sign out</button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
          <strong style={{ fontWeight: 600 }} className="org-name">{me?.organization.name}</strong>
          <span className="spacer" />
          <button className="search-trigger" onClick={() => setPalette(true)} aria-label="Search or ask AI">
            <Icon name="search" size={16} /><span className="label-text">Search, or ask AI anything…</span><span className="spacer" /><span className="kbd">{isMac ? '⌘' : 'Ctrl'} K</span>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleSound} aria-pressed={!muted} aria-label={muted ? 'Turn interface sounds on' : 'Mute interface sounds'} title={muted ? 'Sounds off' : 'Sounds on'}>
            <Icon name={muted ? 'mute' : 'volume'} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>
        </header>
        <main id="main" className={`page ${studioActive ? 'page-full' : ''}`} key={path}>{children}</main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onToggleTheme={toggleTheme} />
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      <span className="spacer" />
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
