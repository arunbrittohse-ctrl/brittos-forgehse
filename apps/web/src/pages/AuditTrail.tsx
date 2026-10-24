import { useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Loading, ErrorNotice, Pagination, Empty } from '../components/ui';

interface AuditRow { id: number; action: string; entityType: string; summary: string; changes: unknown; ip: string | null; createdAt: string; actorName: string | null; actorEmail: string | null }

const ENTITY_TYPES = [['', 'Everything'], ['observation', 'Observations'], ['user', 'Users & sign-ins'], ['project', 'Projects'], ['site', 'Sites'], ['observation_register', 'Exports']];

export function AuditTrail() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading, reload } = useAsync(() => api<{ items: AuditRow[]; total: number; page: number; pageSize: number }>('/audit', { query: { page, entityType } }), [page, entityType]);
  return (
    <>
      <PageHead title="Audit trail" sub="An append-only record of sign-ins, changes, approvals, permission changes and exports. Entries cannot be edited or deleted." actions={
        <><label className="sr-only" htmlFor="a-type">Show</label>
          <select id="a-type" className="select" style={{ width: 'auto' }} value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            {ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></>} />
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <section className="panel">
          {data.items.length === 0 ? <Empty title="No entries" /> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>From</th></tr></thead>
              <tbody>{data.items.map((a) => (
                <tr key={a.id}>
                  <td className="num small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.createdAt)}</td>
                  <td className="small">{a.actorName ?? <span className="muted">Unknown user</span>}</td>
                  <td className="small"><code>{a.action}</code></td>
                  <td className="small wrap">{a.summary}
                    {a.changes != null && <div><button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>{open === a.id ? 'Hide changes' : 'Show changes'}</button>
                      {open === a.id && <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, background: 'var(--surface-2)', padding: 8, borderRadius: 4 }}>{JSON.stringify(a.changes, null, 2)}</pre>}</div>}
                  </td>
                  <td className="small muted num">{a.ip}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </section>
      )}
    </>
  );
}
