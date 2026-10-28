import { useState } from 'react';
import { OBSERVATION_TYPE_LABELS, STATUS_LABELS, type Transition, type ObservationStatus, type RiskBand, type ObservationType } from '@forgehse/shared';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link } from '../lib/router';
import { fmtDate, fmtDateTime, todayISO } from '../lib/format';
import { RecordFiles } from './Library';
import { PageHead } from '../components/AppShell';
import { Loading, ErrorNotice, RiskChip, StatusBadge, Dialog, Field, useToast, Icon } from '../components/ui';

interface Detail {
  observation: {
    id: string; refNo: string; projectId: string; siteId: string; projectCode: string; projectName: string; siteName: string;
    type: ObservationType; hazardCategory: string; location: string; activity: string; description: string; immediateAction: string;
    likelihood: number; severity: number; riskScore: number; riskBand: RiskBand; observedAt: string; reportedByName: string;
    status: ObservationStatus; overdue: boolean; assigneeId: string | null; assigneeName: string | null; dueDate: string | null;
    correctiveAction: string; actionTaken: string; preventiveAction: string; actionSubmittedAt: string | null;
    closedByName: string | null; closedAt: string | null; version: number;
  };
  events: { id: number; event: string; fromStatus: string | null; toStatus: string | null; comment: string; createdAt: string; actorName: string }[];
  attachments: { id: string; filename: string; contentType: string; sizeBytes: number; createdAt: string; uploadedByName: string }[];
  can: { transitions: Transition[]; edit: boolean; attach: boolean };
}

const ACTION_LABEL: Record<Transition, string> = {
  assign: 'Assign corrective action', submit_action: 'Submit action taken', verify_close: 'Verify and close',
  reject_action: 'Return to owner', reopen: 'Reopen', cancel: 'Cancel observation',
};
const EVENT_LABEL: Record<string, string> = {
  created: 'Reported', edited: 'Details edited', assign: 'Assigned', submit_action: 'Action submitted', verify_close: 'Verified and closed',
  reject_action: 'Returned to owner', reopen: 'Reopened', cancel: 'Cancelled', attachment_added: 'Attachment added',
};

type CapaItem = { action: string; controlLevel: string; responsibleRole: string; verificationEvidence: string };

export function ObservationDetail({ id }: { id: string }) {
  const { can: hasPerm } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<Detail>(`/observations/${id}`), [id]);
  const [dialog, setDialog] = useState<Transition | null>(null);
  const [uploading, setUploading] = useState(false);
  const [capa, setCapa] = useState<{ correctiveActions: CapaItem[]; preventiveActions: CapaItem[]; likelyRootCauses: string[]; cautions: string[] } | null>(null);
  const [capaBusy, setCapaBusy] = useState(false);
  const [capaError, setCapaError] = useState('');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice error={error} retry={reload} />;
  if (!data) return null;
  const o = data.observation;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try { await api(`/observations/${id}/attachments?filename=${encodeURIComponent(file.name)}`, { method: 'POST', file }); }
      catch (e) { toast(e instanceof ApiError ? `${file.name}: ${e.message}` : `${file.name} could not be uploaded`, 'error'); }
    }
    setUploading(false);
    reload();
  };

  const suggestCapa = async () => {
    setCapaBusy(true); setCapaError('');
    try { setCapa((await api<{ suggestions: NonNullable<typeof capa> }>('/ai/assist', { body: { task: 'suggest_capa', observationId: id, input: 'Suggest corrective and preventive actions for this observation.' } })).suggestions); }
    catch (e) { setCapaError(e instanceof ApiError ? e.message : 'The assistant is unavailable.'); }
    finally { setCapaBusy(false); }
  };

  return (
    <>
      <PageHead
        title={o.refNo}
        sub={<>{o.projectName} ({o.projectCode}), {o.siteName}</>}
        actions={<>
          <StatusBadge status={o.status} overdue={o.overdue} />
          {data.can.edit && <Link to={`/app/observations/${id}/edit`} className="btn btn-sm">Edit details</Link>}
        </>}
      />
      <div className="detail-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2>{o.hazardCategory}</h2><span className="spacer" /><RiskChip band={o.riskBand} score={o.riskScore} /></div>
            <div className="panel-body">
              <p className="prose-block lead-text">{o.description}</p>
              <dl className="facts">
                <dt>Type</dt><dd>{OBSERVATION_TYPE_LABELS[o.type]}</dd>
                <dt>Location</dt><dd>{o.location}</dd>
                {o.activity && <><dt>Activity</dt><dd>{o.activity}</dd></>}
                <dt>Observed</dt><dd>{fmtDateTime(o.observedAt)}</dd>
                <dt>Reported by</dt><dd>{o.reportedByName}</dd>
                <dt>Risk rating</dt><dd>Likelihood {o.likelihood} × severity {o.severity} = {o.riskScore}</dd>
                <dt>Immediate action</dt><dd>{o.immediateAction || <span className="muted">None recorded</span>}</dd>
              </dl>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Corrective action</h2></div>
            <div className="panel-body">
              {o.status === 'open' && !o.assigneeId ? <p className="muted">Not assigned yet.</p> : (
                <dl className="facts">
                  <dt>Owner</dt><dd>{o.assigneeName ?? '—'}</dd>
                  <dt>Due</dt><dd className="num" style={{ color: o.overdue ? 'var(--critical)' : undefined }}>{fmtDate(o.dueDate)}{o.overdue && ' (overdue)'}</dd>
                  <dt>Required action</dt><dd className="prose-block">{o.correctiveAction || '—'}</dd>
                  {o.actionTaken && <><dt>Action taken</dt><dd className="prose-block">{o.actionTaken}</dd></>}
                  {o.preventiveAction && <><dt>Preventive action</dt><dd className="prose-block">{o.preventiveAction}</dd></>}
                  {o.closedAt && <><dt>Verified by</dt><dd>{o.closedByName}, {fmtDateTime(o.closedAt)}</dd></>}
                </dl>
              )}
              {data.can.transitions.length > 0 && (
                <div className="row" style={{ marginTop: 18 }}>
                  {data.can.transitions.map((t) => (
                    <button key={t} className={`btn ${t === 'verify_close' || t === 'submit_action' || (t === 'assign' && o.status === 'open') ? 'btn-primary' : t === 'cancel' ? 'btn-danger' : ''}`} onClick={() => setDialog(t)}>
                      {t === 'assign' && o.status === 'assigned' ? 'Reassign' : t === 'verify_close' && o.status === 'open' ? 'Close on the spot' : ACTION_LABEL[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Evidence</h2><span className="spacer" />
              {data.can.attach && (
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  <Icon name="upload" />{uploading ? 'Uploading…' : 'Add photos'}
                  <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" onChange={(e) => void upload(e.target.files)} disabled={uploading} />
                </label>
              )}
            </div>
            <div className="panel-body">
              {data.attachments.length === 0 ? <p className="muted">No photos or documents attached.</p> : (
                <div className="thumbs">
                  {data.attachments.map((a) => (
                    <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noopener" title={`${a.filename}, uploaded by ${a.uploadedByName}`}>
                      {a.contentType.startsWith('image/') && a.contentType !== 'image/heic' ? <img src={`/api/attachments/${a.id}`} alt={a.filename} loading="lazy" /> : <span className="file">{a.filename}</span>}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="stack">
          {hasPerm('ai.use') && !['closed', 'cancelled'].includes(o.status) && o.type !== 'positive' && (
            <section className="ai-draft stack">
              <div><span className="ai-tag"><Icon name="spark" size={14} /> HSE assistant</span><h2 style={{ marginTop: 4 }}>Corrective action ideas</h2></div>
              {!capa && <p className="small muted">Suggestions follow the hierarchy of controls. Use them as a starting point; the assigned HSE engineer decides.</p>}
              {capaError && <div className="notice error">{capaError}</div>}
              {capa && (
                <div className="stack small">
                  {[['Correct this instance', capa.correctiveActions], ['Prevent recurrence', capa.preventiveActions]].map(([title, list]) => (
                    <div key={title as string}><strong>{title as string}</strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{(list as CapaItem[]).map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c.action} <span className="muted">({c.controlLevel}{c.responsibleRole ? `, ${c.responsibleRole}` : ''})</span>{c.verificationEvidence && <div className="muted">Evidence: {c.verificationEvidence}</div>}</li>)}</ul>
                    </div>
                  ))}
                  {capa.cautions.length > 0 && <div className="notice warn">{capa.cautions.join(' ')}</div>}
                  <p className="muted">AI-generated suggestions. Not saved to the record.</p>
                </div>
              )}
              <button className="btn btn-dark" onClick={suggestCapa} disabled={capaBusy}>{capaBusy ? 'Thinking…' : capa ? 'Suggest again' : 'Suggest actions'}</button>
            </section>
          )}
          <section className="panel">
            <div className="panel-head"><h2>History</h2></div>
            <div className="panel-body">
              <ol className="timeline">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <div><strong style={{ fontWeight: 500 }}>{EVENT_LABEL[e.event] ?? e.event}</strong>{e.toStatus && e.fromStatus && ['reject_action', 'reopen'].includes(e.event) && <span className="muted">, now {STATUS_LABELS[e.toStatus as ObservationStatus].toLowerCase()}</span>}</div>
                    <div className="muted">{e.actorName}, {fmtDateTime(e.createdAt)}</div>
                    {e.comment && <div style={{ marginTop: 2 }}>"{e.comment}"</div>}
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <RecordFiles recordType="observation" recordId={o.id} projectId={o.projectId} siteId={o.siteId} />
        </div>
      </div>
      {dialog && <TransitionDialog transition={dialog} o={o} onClose={() => setDialog(null)} onDone={(msg) => { setDialog(null); toast(msg); reload(); }} />}
    </>
  );
}

function TransitionDialog({ transition, o, onClose, onDone }: { transition: Transition; o: Detail['observation']; onClose: () => void; onDone: (msg: string) => void }) {
  const assignees = useAsync(() => (transition === 'assign' ? api<{ items: { id: string; fullName: string; jobTitle: string }[] }>(`/projects/${o.projectId}/assignees`, { query: { siteId: o.siteId } }) : Promise.resolve({ items: [] })), [transition]);
  const [assigneeId, setAssigneeId] = useState(o.assigneeId ?? '');
  const [dueDate, setDueDate] = useState(o.dueDate ?? todayISO(7));
  const [correctiveAction, setCorrectiveAction] = useState(o.correctiveAction);
  const [actionTaken, setActionTaken] = useState('');
  const [preventiveAction, setPreventiveAction] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const needsComment = ['reject_action', 'reopen', 'cancel'].includes(transition);

  const confirm = async () => {
    setBusy(true); setErr('');
    const base = { transition, version: o.version, comment: comment || undefined };
    const body = transition === 'assign' ? { ...base, assigneeId, dueDate, correctiveAction }
      : transition === 'submit_action' ? { ...base, actionTaken, preventiveAction: preventiveAction || undefined } : base;
    try {
      await api(`/observations/${o.id}/transitions`, { body });
      const done: Record<Transition, string> = { assign: 'Corrective action assigned', submit_action: 'Action submitted for verification', verify_close: 'Verified and closed', reject_action: 'Returned to owner', reopen: 'Reopened', cancel: 'Observation cancelled' };
      onDone(done[transition]);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === 'conflict' && /changed by someone/.test(e.message) ? 'Someone else updated this observation. Close this dialog to reload it.' : e.message) : 'Could not complete the action.');
    } finally { setBusy(false); }
  };

  const valid = transition === 'assign' ? !!assigneeId && !!dueDate && dueDate >= todayISO()
    : transition === 'submit_action' ? actionTaken.trim().length >= 5
    : needsComment ? comment.trim().length >= 3 : true;
  const title = transition === 'verify_close' && o.status === 'open' ? 'Close on the spot' : ACTION_LABEL[transition];

  return (
    <Dialog title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><button className={`btn ${transition === 'cancel' ? 'btn-danger' : 'btn-primary'}`} onClick={confirm} disabled={!valid || busy}>{busy ? 'Saving…' : title}</button></>}>
      {err && <div className="notice error" role="alert">{err}</div>}
      {transition === 'assign' && (<>
        <Field label="Owner" htmlFor="t-assignee" hint="People with a role on this project and site">
          {assignees.loading ? <Loading label="Loading people" /> : (
            <select id="t-assignee" className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Select a person</option>
              {assignees.data?.items.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.jobTitle ? `, ${u.jobTitle}` : ''}</option>)}
            </select>
          )}
        </Field>
        <Field label="Due date" htmlFor="t-due"><input id="t-due" type="date" className="input" min={todayISO()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <Field label="Required corrective action" htmlFor="t-ca" hint="Specific, assignable and verifiable">
          <textarea id="t-ca" className="textarea" value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} maxLength={2000} />
        </Field>
      </>)}
      {transition === 'submit_action' && (<>
        {o.correctiveAction && <div className="notice"><strong>Required:</strong> {o.correctiveAction}</div>}
        <Field label="What was done?" htmlFor="t-done"><textarea id="t-done" className="textarea" value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} maxLength={4000} /></Field>
        <Field label="Preventive action (optional)" htmlFor="t-prev" hint="What will stop this happening again?"><textarea id="t-prev" className="textarea" style={{ minHeight: 64 }} value={preventiveAction} onChange={(e) => setPreventiveAction(e.target.value)} maxLength={2000} /></Field>
        <p className="small muted">Add photo evidence from the Evidence section so the verifier can check it.</p>
      </>)}
      {transition === 'verify_close' && <p>{o.status === 'open' ? `Close ${o.refNo} because the immediate action fully controlled the hazard: "${o.immediateAction}".` : `Confirm you have checked on site that the action taken resolves ${o.refNo}.`}</p>}
      <Field label={needsComment ? 'Reason (required)' : 'Comment (optional)'} htmlFor="t-comment">
        <textarea id="t-comment" className="textarea" style={{ minHeight: 64 }} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
      </Field>
    </Dialog>
  );
}
