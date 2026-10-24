import { useState } from 'react';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Loading, ErrorNotice, Empty, Dialog, Field, useToast, Icon } from '../components/ui';

interface Project { id: string; code: string; name: string; client: string; location: string; startDate: string | null; status: string; sites: { id: string; code: string; name: string; active: boolean }[] }

export function AdminProjects() {
  const toast = useToast();
  const { reload: reloadMe } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api<{ items: Project[] }>('/admin/projects'), []);
  const [dlg, setDlg] = useState<{ kind: 'project' } | { kind: 'site'; project: Project } | null>(null);
  const done = (msg: string) => { setDlg(null); toast(msg); reload(); void reloadMe(); };

  const toggleSite = async (siteId: string, active: boolean) => {
    try { await api(`/admin/sites/${siteId}`, { method: 'PATCH', body: { active } }); toast(active ? 'Site reactivated' : 'Site deactivated'); reload(); void reloadMe(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update the site', 'error'); }
  };
  const setStatus = async (p: Project, status: string) => {
    try { await api(`/admin/projects/${p.id}`, { method: 'PATCH', body: { status } }); toast(`${p.code} is now ${status.replace('_', ' ')}`); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update the project', 'error'); }
  };

  return (
    <>
      <PageHead title="Projects & sites" sub="Every record belongs to a project and a site. Roles can be limited to either." actions={<button className="btn btn-primary" onClick={() => setDlg({ kind: 'project' })}><Icon name="plus" />Add project</button>} />
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data?.items.length === 0 && <div className="panel"><Empty title="No projects yet" action={<button className="btn btn-primary" onClick={() => setDlg({ kind: 'project' })}>Add the first project</button>}>Create a project, then add its sites, then give people roles on them.</Empty></div>}
      <div className="stack">
        {data?.items.map((p) => (
          <section key={p.id} className="panel">
            <div className="panel-head" style={{ flexWrap: 'wrap' }}>
              <div><h2>{p.name} <span className="muted" style={{ fontWeight: 500 }}>({p.code})</span></h2>
                <p className="small muted">{[p.client, p.location, p.startDate && `started ${fmtDate(p.startDate)}`].filter(Boolean).join(', ') || 'No client or location recorded'}</p></div>
              <span className="spacer" />
              <label className="sr-only" htmlFor={`st-${p.id}`}>Status</label>
              <select id={`st-${p.id}`} className="select" style={{ width: 'auto' }} value={p.status} onChange={(e) => void setStatus(p, e.target.value)}>
                <option value="active">Active</option><option value="on_hold">On hold</option><option value="closed">Closed</option>
              </select>
              <button className="btn btn-sm" onClick={() => setDlg({ kind: 'site', project: p })}><Icon name="plus" />Add site</button>
            </div>
            {p.sites.length === 0 ? <div className="panel-body muted small">No sites yet. Observations need a site.</div> : (
              <table className="data"><thead><tr><th>Code</th><th>Site</th><th>Status</th><th /></tr></thead>
                <tbody>{p.sites.map((s) => (
                  <tr key={s.id}><td className="num">{s.code}</td><td>{s.name}</td><td>{s.active ? 'Active' : <span className="muted">Inactive</span>}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={() => void toggleSite(s.id, !s.active)}>{s.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>
                ))}</tbody></table>
            )}
          </section>
        ))}
      </div>
      {dlg?.kind === 'project' && <ProjectDialog onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'site' && <SiteDialog project={dlg.project} onClose={() => setDlg(null)} onDone={done} />}
    </>
  );
}

function ProjectDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ code: '', name: '', client: '', location: '', startDate: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const save = async () => {
    try { await api('/admin/projects', { body: { ...f, startDate: f.startDate || undefined } }); onDone(`${f.code} created`); }
    catch (e) { setErrs(fieldErrors(e)); setErr(e instanceof ApiError ? e.message : 'Could not create the project'); }
  };
  return (
    <Dialog title="Add project" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!f.code || !f.name}>Create project</button></>}>
      {err && <div className="notice error">{err}</div>}
      <div className="grid-2">
        <Field label="Code" htmlFor="p-code" hint="Used in reference numbers, e.g. MRT-01" error={errs.code}><input id="p-code" className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} /></Field>
        <Field label="Start date" htmlFor="p-start"><input id="p-start" className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
      </div>
      <Field label="Project name" htmlFor="p-name" error={errs.name}><input id="p-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid-2">
        <Field label="Client" htmlFor="p-client"><input id="p-client" className="input" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></Field>
        <Field label="Location" htmlFor="p-loc"><input id="p-loc" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

function SiteDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    try { await api('/admin/sites', { body: { projectId: project.id, code, name } }); onDone(`Site ${code} added to ${project.code}`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not add the site'); }
  };
  return (
    <Dialog title={`Add site to ${project.code}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!code || name.length < 2}>Add site</button></>}>
      {err && <div className="notice error">{err}</div>}
      <Field label="Site code" htmlFor="s-code" hint="e.g. PODIUM, CH-1"><input id="s-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} /></Field>
      <Field label="Site name" htmlFor="s-name"><input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Dialog>
  );
}
