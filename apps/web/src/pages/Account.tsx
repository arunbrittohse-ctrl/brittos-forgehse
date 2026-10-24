import { useState, type FormEvent } from 'react';
import { PASSWORD_RULES } from '@forgehse/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate, useLocation } from '../lib/router';
import { PageHead } from '../components/AppShell';
import { Field, useToast } from '../components/ui';
import { SoundMotionSettings } from '../components/SoundMotionSettings';

export function Account() {
  const { me, reload } = useAuth();
  const { search } = useLocation();
  const toast = useToast();
  const required = search.get('required') === '1' || me?.user.mustChangePassword;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setErr('The new passwords do not match.'); return; }
    setBusy(true); setErr('');
    try {
      await api('/auth/password', { body: { currentPassword: current, newPassword: next } });
      await reload();
      toast('Password changed. Other devices have been signed out.');
      setCurrent(''); setNext(''); setConfirm('');
      if (required) navigate('/app', { replace: true });
    } catch (e2) { setErr(e2 instanceof ApiError ? (Array.isArray(e2.details) ? (e2.details as { message: string }[])[0]?.message ?? e2.message : e2.message) : 'Could not change the password.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="Your account" />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="panel panel-body stack" onSubmit={submit}>
          <h2>Change password</h2>
          {required && <div className="notice warn">Set a new password before you continue. Your administrator gave you a temporary one.</div>}
          {err && <div className="notice error" role="alert">{err}</div>}
          <Field label="Current password" htmlFor="cur"><input id="cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="New password" htmlFor="new" hint={PASSWORD_RULES}><input id="new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Confirm new password" htmlFor="conf"><input id="conf" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <button className="btn btn-primary" disabled={busy || !current || !next}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
        <section className="panel panel-body stack">
          <h2>Your access</h2>
          <p className="small">{me?.user.fullName}, {me?.user.email}</p>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            {me?.assignments.map((a, i) => {
              const p = me.projects.find((x) => x.id === a.projectId);
              const s = p?.sites.find((x) => x.id === a.siteId);
              return <li key={i}>{a.roleLabel} in {a.projectId ? (s ? `${p?.code}, ${s.name}` : `${p?.name ?? 'a project'}`) : me.organization.name}</li>;
            })}
          </ul>
          <p className="small muted">To change your roles, contact your organisation administrator.</p>
        </section>
        <SoundMotionSettings />
      </div>
    </>
  );
}
