import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { calculateRisk, OBSERVATION_TYPES, OBSERVATION_TYPE_LABELS, type ObservationType, type RiskMatrixConfig } from '@forgehse/shared';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { navigate, Link, useLocation } from '../lib/router';
import { nowLocalInput, localInputToISO } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Field, Loading, ErrorNotice, RiskChip, useToast, Icon } from '../components/ui';

interface Meta { hazardCategories: string[]; riskMatrix: RiskMatrixConfig; timezone: string }

interface FormState {
  projectId: string; siteId: string; type: ObservationType; hazardCategory: string; location: string; activity: string;
  description: string; immediateAction: string; likelihood: number; severity: number; observedAt: string;
}

function isoToLocalInput(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export function ObservationForm({ id }: { id?: string }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const meta = useAsync(() => api<Meta>('/observations/meta'), []);
  const existing = useAsync(() => (id ? api<{ observation: FormState & { version: number; refNo: string; observedAt: string } }>(`/observations/${id}`) : Promise.resolve(null)), [id]);
  const projects = me?.projects ?? [];
  const [f, setF] = useState<FormState>({
    projectId: projects.length === 1 ? projects[0]!.id : '', siteId: projects.length === 1 && projects[0]!.sites.length === 1 ? projects[0]!.sites[0]!.id : '',
    type: 'unsafe_condition', hazardCategory: '', location: '', activity: '', description: '', immediateAction: '', likelihood: 3, severity: 3, observedAt: nowLocalInput(),
  });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<{ missingInformation: string[]; ratingRationale: string; suggestedCorrectiveAction: string } | null>(null);

  // Prefill from AI Studio ("report what I saw"): notes arrive in the URL and the draft runs once.
  const { search } = useLocation();
  const prefill = id ? null : search.get('notes');
  const autoRan = useRef(false);
  useEffect(() => { if (prefill) setNotes(prefill.slice(0, 4000)); }, [prefill]);
  useEffect(() => {
    if (prefill && !autoRan.current && notes === prefill.slice(0, 4000) && notes.trim().length >= 10) { autoRan.current = true; void draftWithAi(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  useEffect(() => {
    const o = existing.data?.observation;
    if (o && meta.data) setF({ ...o, observedAt: isoToLocalInput(o.observedAt, meta.data.timezone) });
  }, [existing.data, meta.data]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const project = projects.find((p) => p.id === f.projectId);
  const matrix = meta.data?.riskMatrix;
  const risk = useMemo(() => { try { return matrix ? calculateRisk(f.likelihood, f.severity, matrix) : null; } catch { return null; } }, [f.likelihood, f.severity, matrix]);

  const draftWithAi = async () => {
    setAiBusy(true); setFormError('');
    try {
      const r = await api<{ draft: FormState & { ratingRationale: string; suggestedCorrectiveAction: string; missingInformation: string[] } }>('/ai/assist', { body: { task: 'draft_observation', projectId: f.projectId || undefined, input: notes } });
      const d = r.draft;
      setF((s) => ({ ...s, type: d.type, hazardCategory: d.hazardCategory, location: d.location || s.location, activity: d.activity || s.activity, description: d.description, immediateAction: d.immediateAction || s.immediateAction, likelihood: d.likelihood, severity: d.severity }));
      setAiResult({ missingInformation: d.missingInformation, ratingRationale: d.ratingRationale, suggestedCorrectiveAction: d.suggestedCorrectiveAction });
      toast('Draft filled in. Check every field before submitting.');
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'The assistant could not produce a draft.');
    } finally { setAiBusy(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setFormError('');
    const body = { ...f, observedAt: localInputToISO(f.observedAt) };
    try {
      let obsId = id;
      if (id) {
        const { projectId: _p, siteId: _s, ...patch } = body;
        await api(`/observations/${id}`, { method: 'PATCH', body: { ...patch, version: existing.data!.observation.version } });
      } else {
        const created = await api<{ id: string; refNo: string }>('/observations', { body: { ...body, clientRef: crypto.randomUUID() } });
        obsId = created.id;
        toast(`${created.refNo} reported`);
      }
      let failed = 0;
      for (const file of files) {
        try { await api(`/observations/${obsId}/attachments?filename=${encodeURIComponent(file.name)}`, { method: 'POST', file }); }
        catch { failed++; }
      }
      if (failed) toast(`${failed} photo${failed > 1 ? 's' : ''} could not be uploaded. Add them from the observation page.`, 'error');
      if (id) toast('Changes saved');
      navigate(`/app/observations/${obsId}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(err instanceof ApiError ? err.message : 'Could not save the observation.');
    } finally { setBusy(false); }
  };

  if (meta.loading || existing.loading) return <Loading />;
  if (meta.error || existing.error) return <ErrorNotice error={meta.error ?? existing.error} />;
  if (!id && !can('observation.create')) return <ErrorNotice error={new ApiError(403, 'forbidden', 'Your role does not allow reporting observations.')} />;
  const size = matrix?.size ?? 5;

  return (
    <>
      <PageHead title={id ? `Edit ${existing.data?.observation.refNo}` : 'Report an observation'} sub="Describe what you saw as factually as you can. The risk rating is calculated from your likelihood and severity choices." />
      <div className="detail-grid">
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-body stack">
            {formError && <div className="notice error" role="alert">{formError}</div>}
            {!id && (
              <div className="grid-2">
                <Field label="Project" htmlFor="projectId" error={errors.projectId}>
                  <select id="projectId" className="select" required value={f.projectId} onChange={(e) => { const p = projects.find((x) => x.id === e.target.value); setF((s) => ({ ...s, projectId: e.target.value, siteId: p?.sites.length === 1 ? p.sites[0]!.id : '' })); }}>
                    <option value="">Select a project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                  </select>
                </Field>
                <Field label="Site" htmlFor="siteId" error={errors.siteId}>
                  <select id="siteId" className="select" required value={f.siteId} onChange={(e) => set('siteId', e.target.value)} disabled={!project}>
                    <option value="">{project ? 'Select a site' : 'Choose a project first'}</option>
                    {project?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </div>
            )}
            <div className="field">
              <span className="label" id="type-label">Type</span>
              <div className="segmented" role="group" aria-labelledby="type-label">
                {OBSERVATION_TYPES.map((t) => <button type="button" key={t} aria-pressed={f.type === t} onClick={() => set('type', t)}>{OBSERVATION_TYPE_LABELS[t]}</button>)}
              </div>
            </div>
            <div className="grid-2">
              <Field label="Hazard category" htmlFor="hazardCategory" error={errors.hazardCategory}>
                <select id="hazardCategory" className="select" value={f.hazardCategory} onChange={(e) => set('hazardCategory', e.target.value)}>
                  <option value="">Select a category</option>
                  {meta.data!.hazardCategories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Observed at" htmlFor="observedAt" hint={`Local time, ${meta.data!.timezone}`} error={errors.observedAt}>
                <input id="observedAt" className="input" type="datetime-local" value={f.observedAt} max={nowLocalInput()} onChange={(e) => set('observedAt', e.target.value)} />
              </Field>
            </div>
            <div className="grid-2">
              <Field label="Exact location" htmlFor="location" hint="Level, grid line, chainage or area" error={errors.location}>
                <input id="location" className="input" value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={200} />
              </Field>
              <Field label="Activity under way" htmlFor="activity" error={errors.activity}>
                <input id="activity" className="input" value={f.activity} onChange={(e) => set('activity', e.target.value)} maxLength={200} />
              </Field>
            </div>
            <Field label="What did you see?" htmlFor="description" hint="Describe the act or condition, how many people were exposed. Refer to roles, not names." error={errors.description}>
              <textarea id="description" className="textarea" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} aria-invalid={!!errors.description} />
            </Field>
            <Field label="Immediate action taken" htmlFor="immediateAction" hint="Leave blank if nothing has been done yet" error={errors.immediateAction}>
              <textarea id="immediateAction" className="textarea" style={{ minHeight: 64 }} value={f.immediateAction} onChange={(e) => set('immediateAction', e.target.value)} maxLength={2000} />
            </Field>
            <div className="grid-3" style={{ alignItems: 'end' }}>
              <Field label="Likelihood" htmlFor="likelihood">
                <select id="likelihood" className="select" value={f.likelihood} onChange={(e) => set('likelihood', Number(e.target.value))}>
                  {Array.from({ length: size }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}{matrix?.likelihoodLabels?.[n - 1] ? ` ${matrix.likelihoodLabels[n - 1]}` : ''}</option>)}
                </select>
              </Field>
              <Field label="Severity" htmlFor="severity">
                <select id="severity" className="select" value={f.severity} onChange={(e) => set('severity', Number(e.target.value))}>
                  {Array.from({ length: size }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}{matrix?.severityLabels?.[n - 1] ? ` ${matrix.severityLabels[n - 1]}` : ''}</option>)}
                </select>
              </Field>
              <div className="field"><span className="label">Risk rating</span><div style={{ minHeight: 40, display: 'flex', alignItems: 'center' }}>{risk && <RiskChip band={risk.band} score={risk.score} />}</div></div>
            </div>
            {(!id || can('observation.create')) && (
              <Field label="Photos or documents" htmlFor="files" hint="JPEG, PNG, WebP, HEIC or PDF, up to 15 MB each">
                <input id="files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
              </Field>
            )}
          </div>
          <div className="dialog-foot">
            <Link to={id ? `/app/observations/${id}` : '/app/observations'} className="btn">Cancel</Link>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Submit observation'}</button>
          </div>
        </form>

        {!id && can('ai.use') && (
          <aside className="ai-draft stack" aria-label="Draft with the HSE assistant">
            <div><span className="ai-tag"><Icon name="spark" size={14} /> HSE assistant</span><h2 style={{ marginTop: 4 }}>Draft from rough notes</h2></div>
            <p className="small muted">Paste or type what you noted on site. The assistant fills in the form for you to check. Nothing is submitted until you press Submit.</p>
            <textarea className="textarea" aria-label="Site notes" placeholder="e.g. L14 east side no edge protection approx 6m, formwork crew working near, told foreman to stop" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button className="btn btn-dark" type="button" onClick={draftWithAi} disabled={aiBusy || notes.trim().length < 10}>{aiBusy ? 'Drafting…' : 'Fill in the form'}</button>
            {aiResult && (
              <div className="stack small">
                {aiResult.ratingRationale && <p><strong>Why this rating:</strong> {aiResult.ratingRationale}</p>}
                {aiResult.suggestedCorrectiveAction && <p><strong>Suggested corrective action:</strong> {aiResult.suggestedCorrectiveAction}</p>}
                {aiResult.missingInformation.length > 0 && <div><strong>Add if you can:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{aiResult.missingInformation.map((m) => <li key={m}>{m}</li>)}</ul></div>}
                <p className="muted">AI-generated draft. You are responsible for checking it against what you saw.</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </>
  );
}
