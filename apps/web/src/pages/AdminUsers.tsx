import { useState } from 'react';
import { ROLES, ROLE_LABELS, ORG_WIDE_ROLES, PASSWORD_RULES, type Role } from '@forgehse/shared';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Loading, ErrorNotice, Dialog, Field, useToast, Icon } from '../components/ui';

interface Assignment { role: Role; projectId: string | null; siteId: string | null }
interface UserRow { id: string; email: string; fullName: string; jobTitle: string; active: boolean; locked: boolean; lastLoginAt: string | null; assignments: Assignment[] }
interface Project { id: string; code: string; name: string; sites: { id: string; code: string; name: string }[] }

export function AdminUsers() {
  const toast = useToast();
  const { me } = useAuth();
  const users = useAsync(() => api<{ items: UserRow[] }>('/admin/users'), []);
  const projects = useAsync(() => api<{ items: Project[] }>('/admin/projects').catch(() => ({ items: [] as Project[] })), []);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);

  const scopeLabel = (a: Assignment) => {
    if (!a.projectId) return 'Whole organisation';
    const p = projects.data?.items.find((x) => x.id === a.projectId);
    const s = p?.sites.find((x) => x.id === a.siteId);
    return s ? `${p?.code}, ${s.name}` : p ? `${p.name} (${p.code})` : 'Project';
  };

  return (
    <>
      <PageHead title="Users & roles" sub="Roles decide what someone can do; the project and site decide where. Permissions are checked on the server for every request."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" />Add user</button>} />
      {users.error && <ErrorNotice error={users.error} retry={users.reload} />}
      {users.loading && !users.data && <Loading />}
      {users.data && (
        <section className="panel"><div className="table-wrap"><table className="data">
          <thead><tr><th>Name</th><th>Roles and scope</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{users.data.items.map((u) => (
            <tr key={u.id}>
              <td><strong style={{ fontWeight: 500 }}>{u.fullName}</strong><div className="small muted">{u.email}{u.jobTitle ? `, ${u.jobTitle}` : ''}</div></td>
              <td>{u.assignments.map((a, i) => <div key={i} className="small">{ROLE_LABELS[a.role]} <span className="muted">in {scopeLabel(a)}</span></div>)}</td>
              <td className="small num">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="muted">Never</span>}</td>
              <td>{!u.active ? <span className="badge s-cancelled">Deactivated</span> : u.locked ? <span className="badge s-overdue">Locked</span> : <span className="badge s-closed">Active</span>}</td>
              <td style={{ textAlign: 'right' }}>{u.id !== me?.user.id && <button className="btn btn-sm" onClick={() => setEditing(u)}>Edit</button>}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
      {editing && <UserDialog user={editing === 'new' ? null : editing} projects={projects.data?.items ?? []} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); toast(m); users.reload(); }} />}
    </>
  );
}

function UserDialog({ user, projects, onClose, onDone }: { user: UserRow | null; projects: Project[]; onClose: () => void; onDone: (m: string) => void }) {
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(user?.active ?? true);
  const [assignments, setAssignments] = useState<Assignment[]>(user?.assignments ?? [{ role: 'hse_officer', projectId: projects[0]?.id ?? null, siteId: null }]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<Assignment>) => setAssignments((list) => list.map((a, j) => {
    if (j !== i) return a;
    const next = { ...a, ...patch };
    if (ORG_WIDE_ROLES.has(next.role)) { next.projectId = null; next.siteId = null; }
    if (patch.projectId !== undefined) next.siteId = null;
    return next;
  }));

  const save = async () => {
    setBusy(true); setErr(''); setErrs({});
    try {
      if (user) await api(`/admin/users/${user.id}`, { method: 'PATCH', body: { fullName, jobTitle, active, assignments } });
      else await api('/admin/users', { body: { email, fullName, jobTitle, initialPassword: password, assignments } });
      onDone(user ? 'User updated' : `${fullName} added. They will be asked to set a new password at first sign-in.`);
    } catch (e) { setErrs(fieldErrors(e)); setErr(e instanceof ApiError ? e.message : 'Could not save the user'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={user ? `Edit ${user.fullName}` : 'Add user'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy || !fullName || assignments.length === 0 || (!user && (!email || !password))}>{user ? 'Save changes' : 'Add user'}</button></>}>
      {err && <div className="notice error">{err}</div>}
      <div className="grid-2">
        <Field label="Full name" htmlFor="u-name" error={errs.fullName}><input id="u-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Job title" htmlFor="u-title"><input id="u-title" className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></Field>
      </div>
      {!user && (
        <div className="grid-2">
          <Field label="Work email" htmlFor="u-email" error={errs.email}><input id="u-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Temporary password" htmlFor="u-pw" hint={PASSWORD_RULES} error={errs.initialPassword}><input id="u-pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </div>
      )}
      <div className="field">
        <span className="label">Roles</span>
        {assignments.map((a, i) => {
          const p = projects.find((x) => x.id === a.projectId);
          return (
            <div key={i} className="row" style={{ alignItems: 'stretch' }}>
              <select aria-label="Role" className="select" style={{ flex: '1 1 180px' }} value={a.role} onChange={(e) => update(i, { role: e.target.value as Role })}>
                {ROLES.filter((r) => r !== 'super_admin').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              {!ORG_WIDE_ROLES.has(a.role) && (<>
                <select aria-label="Project" className="select" style={{ flex: '1 1 140px' }} value={a.projectId ?? ''} onChange={(e) => update(i, { projectId: e.target.value || null })}>
                  {projects.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
                </select>
                <select aria-label="Site" className="select" style={{ flex: '1 1 140px' }} value={a.siteId ?? ''} onChange={(e) => update(i, { siteId: e.target.value || null })}>
                  <option value="">All sites</option>
                  {p?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </>)}
              <button className="btn btn-ghost btn-sm" aria-label="Remove role" onClick={() => setAssignments((l) => l.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          );
        })}
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAssignments((l) => [...l, { role: 'viewer', projectId: projects[0]?.id ?? null, siteId: null }])}><Icon name="plus" />Add role</button>
        {errs.assignments && <span className="error">{errs.assignments}</span>}
      </div>
      {user && <label className="row small"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Account active (deactivating signs the user out everywhere)</label>}
    </Dialog>
  );
}
