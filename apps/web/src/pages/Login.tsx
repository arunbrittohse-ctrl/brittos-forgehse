import { useState, type FormEvent } from 'react';
import { Brand, TAGLINE } from '../components/brand';
import { Field } from '../components/ui';
import { LightField } from '../components/fx';
import { api, ApiError } from '../lib/api';
import { navigate, useLocation, Link } from '../lib/router';
import { useAuth } from '../lib/auth';

export function Login() {
  const { reload } = useAuth();
  const { search } = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api<{ mustChangePassword: boolean }>('/auth/login', { body: { email, password, client: 'web' } });
      await reload();
      const next = search.get('next');
      navigate(r.mustChangePassword ? '/app/account?required=1' : next && next.startsWith('/app') ? next : '/app', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-side has-lightfield">
        <LightField />
        <Link to="/" aria-label="Home"><Brand /></Link>
        <div>
          <h1 style={{ color: '#fff', fontSize: '2.2rem', letterSpacing: '-0.03em', maxWidth: '14ch' }}>Site safety, one record at a time.</h1>
          <p className="tag" style={{ marginTop: 14 }}>{TAGLINE}</p>
        </div>
        <p className="small" style={{ color: '#8f9bb8' }}>Access is limited to authorised users. Activity is logged.</p>
      </aside>
      <main className="auth-main">
        <form className="auth-card stack" onSubmit={submit} noValidate>
          <div>
            <h1>Sign in</h1>
            <p className="muted" style={{ marginTop: 6 }}>Use the work email your administrator registered.</p>
          </div>
          {error && <div className="notice error" role="alert">{error}</div>}
          <Field label="Work email" htmlFor="email">
            <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="small muted">Forgotten your password? Ask your organisation administrator to reset it.</p>
        </form>
      </main>
    </div>
  );
}
