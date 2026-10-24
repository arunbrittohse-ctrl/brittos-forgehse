import { useMemo, useState, type FormEvent } from 'react';
import { STUDIO_KINDS, STUDIO_KIND_LABELS, type StudioKind } from '@forgehse/shared';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link, navigate } from '../lib/router';
import { fmtDate, fmtDateTime } from '../lib/format';
import { sound } from '../lib/sound';
import { PageHead } from '../components/AppShell';
import { Dialog, Empty, ErrorNotice, Field, Icon, Loading, useToast } from '../components/ui';
import { Tilt, Reveal } from '../components/fx';
import { StudioPreview, StatusPill, ExportButtons, KIND_ICON, svgFor, svgDataUrl, type StudioItem } from '../components/studio-preview';

export function StudioLibrary() {
  const [kind, setKind] = useState<StudioKind | ''>('');
  const [status, setStatus] = useState<'' | 'draft' | 'reviewed'>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useAsync(() => api<{ items: StudioItem[]; total: number }>('/studio/items', { query: { kind, status, q: query } }), [kind, status, query]);
  const { me } = useAuth();
  return (
    <>
      <PageHead title="Studio library" sub="Checklists, HSE documents, posters, flowcharts and reviews generated in AI Studio. Drafts must be reviewed before use."
        actions={<Link className="btn btn-primary" to="/app/studio"><Icon name="spark" />Create with AI</Link>} />
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="row" role="group" aria-label="Type" style={{ gap: 6 }}>
          <button className="chip-btn" aria-pressed={kind === ''} onClick={() => setKind('')}>All</button>
          {STUDIO_KINDS.map((k) => <button key={k} className="chip-btn" aria-pressed={kind === k} onClick={() => setKind(k)}><Icon name={KIND_ICON[k]} size={14} />{STUDIO_KIND_LABELS[k]}</button>)}
        </div>
        <span className="spacer" />
        <select className="select" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Any status</option><option value="draft">Drafts</option><option value="reviewed">Reviewed</option>
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q); }} className="row" style={{ gap: 6 }}>
          <input className="input" style={{ width: 220 }} placeholder="Search titles and briefs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </form>
      </div>
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <div className="panel"><Empty title="Nothing here yet" action={<Link className="btn btn-primary" to="/app/studio">Open AI Studio</Link>}>Ask AI Studio for a checklist, toolbox talk, poster or flowchart and it will appear here.</Empty></div>}
      {data && data.items.length > 0 && (
        <div className="lib-grid">
          {data.items.map((it, i) => (
            <Reveal key={it.id} delay={Math.min(i, 8) * 40}>
              <Tilt className="lib-card" style={{ height: '100%' }}>
                <Link to={`/app/studio/items/${it.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div className="lib-thumb">{it.kind === 'poster' || it.kind === 'flowchart' ? <img src={svgDataUrl(svgFor(it, me?.organization.name))} alt="" /> : <span className="ico"><Icon name={KIND_ICON[it.kind]} size={26} /></span>}</div>
                  <div className="info">
                    <span className="small muted">{STUDIO_KIND_LABELS[it.kind]}{it.project ? ` · ${it.project.split(' — ')[0]}` : ''}</span>
                    <span className="t">{it.title}</span>
                    <div className="row" style={{ gap: 8 }}><StatusPill status={it.status} /><span className="small muted">{fmtDate(it.updatedAt)}</span></div>
                  </div>
                </Link>
              </Tilt>
            </Reveal>
          ))}
        </div>
      )}
    </>
  );
}

export function StudioItemPage({ id }: { id: string }) {
  const { me } = useAuth();
  const toast = useToast();
  const { data: item, error, loading, reload } = useAsync(() => api<StudioItem>(`/studio/items/${id}`), [id]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const org = me?.organization.name;
  const age = useMemo(() => (item ? fmtDateTime(item.updatedAt) : ''), [item]);

  if (error) return <ErrorNotice error={error} retry={reload} />;
  if (loading && !item) return <Loading />;
  if (!item) return null;

  const review = async (decision: 'reviewed' | 'draft') => {
    setBusy(true);
    try {
      await api(`/studio/items/${item.id}/review`, { body: { decision, note, version: item.version } });
      toast(decision === 'reviewed' ? 'Marked as reviewed' : 'Returned to draft');
      if (decision === 'reviewed') sound.playSuccess();
      setReviewOpen(false); setNote(''); reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update', 'error'); sound.playError(); }
    finally { setBusy(false); }
  };
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    try { await api(`/studio/items/${item.id}`, { method: 'PATCH', body: { title, version: item.version } }); setRenaming(false); reload(); toast('Renamed'); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Could not rename', 'error'); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this item from the library?')) return;
    await api(`/studio/items/${item.id}`, { method: 'DELETE' });
    toast('Deleted'); navigate('/app/studio/library');
  };

  return (
    <>
      <PageHead
        title={item.title}
        sub={<><StatusPill status={item.status} /> <span style={{ marginLeft: 8 }}>{STUDIO_KIND_LABELS[item.kind]} · by {item.createdBy.name} · updated {age}</span></>}
        actions={<>
          <ExportButtons item={item} org={org} />
          {item.permissions.edit && <button className="btn btn-sm" onClick={() => { setTitle(item.title); setRenaming(true); }}><Icon name="edit" size={15} />Rename</button>}
          {item.permissions.review && (item.status === 'draft'
            ? <button className="btn btn-sm btn-primary" onClick={() => setReviewOpen(true)}><Icon name="check" size={15} />Mark reviewed</button>
            : <button className="btn btn-sm" onClick={() => void review('draft')} disabled={busy}>Return to draft</button>)}
        </>}
      />
      <div className="detail-grid">
        <div className="print-area"><StudioPreview item={item} org={org} /></div>
        <aside className="stack">
          <section className="panel panel-body stack">
            <h3>Review status</h3>
            {item.status === 'reviewed'
              ? <p className="small">Reviewed by <b>{item.reviewedBy?.name}</b> on {fmtDateTime(item.reviewedAt)}.{item.reviewNote && <><br /><span className="muted">“{item.reviewNote}”</span></>}</p>
              : <p className="small">This is an <b>AI-generated draft</b>. A competent person must check it against the project's procedures, the site conditions and the applicable requirements before it is issued or displayed. Exports are marked DRAFT until then.</p>}
            {!item.permissions.review && item.status === 'draft' && <p className="small muted">Reviewing needs the HSE engineer or HSE manager role.</p>}
          </section>
          <section className="panel panel-body stack">
            <h3>Brief</h3>
            <p className="small prose-block">{item.brief}</p>
            <Link className="btn btn-sm" to={`/app/studio?mode=${item.kind === 'review' ? 'ask' : item.kind}&q=${encodeURIComponent(item.brief)}`}><Icon name="refresh" size={15} />Generate a new version</Link>
          </section>
          {item.permissions.edit && <button className="btn btn-sm btn-danger" onClick={() => void remove()}><Icon name="trash" size={15} />Delete</button>}
        </aside>
      </div>
      {reviewOpen && (
        <Dialog title="Mark as reviewed" onClose={() => setReviewOpen(false)} footer={<><button className="btn" onClick={() => setReviewOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void review('reviewed')}>Confirm review</button></>}>
          <p className="small">Confirm you have checked this {STUDIO_KIND_LABELS[item.kind].toLowerCase()} for accuracy and suitability for its intended use. Your name and the time are recorded in the audit trail and on exports.</p>
          <Field label="Review note (optional)" htmlFor="rev-note"><textarea id="rev-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Checked against site procedure and the lifting plan" /></Field>
        </Dialog>
      )}
      {renaming && (
        <Dialog title="Rename" onClose={() => setRenaming(false)}>
          <form onSubmit={rename} className="stack">
            <Field label="Title" htmlFor="ren"><input id="ren" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
            <p className="small muted">{item.status === 'reviewed' ? 'Renaming returns the item to draft so it can be re-reviewed.' : ''}</p>
            <div className="row"><span className="spacer" /><button className="btn btn-primary" disabled={!title.trim()}>Save</button></div>
          </form>
        </Dialog>
      )}
    </>
  );
}
