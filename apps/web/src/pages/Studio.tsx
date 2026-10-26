/**
 * FORGEHSE AI Studio — a fast, streaming HSE co-pilot with voice input, grounded in the user's own
 * records (with citations), that can generate checklists, documents, posters and flowcharts and
 * review uploaded documents. Every generated item is a draft until a competent person reviews it.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { STUDIO_KIND_LABELS, DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, type DocumentType, type StudioKind } from '@forgehse/shared';
import { api, ApiError } from '../lib/api';
import { useAsync, readPref, writePref } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link, navigate, useLocation } from '../lib/router';
import { streamChat, type ChatAction, type Citation } from '../lib/stream';
import { useDictation, speak, canSpeak, VOICE_LANGS } from '../lib/voice';
import { sound } from '../lib/sound';
import { Icon, useToast } from '../components/ui';
import { Markdown } from '../components/markdown';
import { LightField } from '../components/fx';
import { StudioPreview, StatusPill, ExportButtons, KIND_ICON, type StudioItem } from '../components/studio-preview';

type Mode = 'ask' | StudioKind;
interface ToolState { id: string; name: string; status: 'running' | 'done' | 'error'; summary?: string }
interface Job { key: string; kind: StudioKind; brief: string; documentType?: DocumentType; status: 'running' | 'done' | 'error'; item?: StudioItem; error?: string }
interface Msg {
  key: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; actions: ChatAction[];
  tools: ToolState[]; jobs: string[]; streaming?: boolean; error?: string; observationNotes?: string[];
}

const MODES: { id: Mode; label: string; icon: string; placeholder: string }[] = [
  { id: 'ask', label: 'Ask', icon: 'spark', placeholder: 'Ask anything about HSE or your site data… (Shift+Enter for a new line)' },
  { id: 'checklist', label: 'Checklist', icon: 'checklist', placeholder: 'Describe the checklist, e.g. "Pre-use inspection for a 25 t mobile crane on site 3"' },
  { id: 'document', label: 'Document', icon: 'doc', placeholder: 'Describe the document, e.g. "Toolbox talk on heat stress for 40 steel fixers, simple English"' },
  { id: 'poster', label: 'Poster', icon: 'image', placeholder: 'Describe the poster, e.g. "Harness and lanyard use when working at height"' },
  { id: 'flowchart', label: 'Flowchart', icon: 'flow', placeholder: 'Describe the process, e.g. "Hot work permit issue and close-out"' },
  { id: 'review', label: 'Review a document', icon: 'review', placeholder: 'Attach a PDF or Word file, then say what to focus on (optional)' },
];

const STARTERS: { icon: string; title: string; text: string; mode: Mode }[] = [
  { icon: 'chart', title: 'This month at a glance', text: 'Summarise our HSE observations for the last 30 days: trends, top hazards and what needs attention.', mode: 'ask' },
  { icon: 'alert', title: 'High-risk items still open', text: 'Which high or critical observations are still open, and which are overdue?', mode: 'ask' },
  { icon: 'doc', title: 'Toolbox talk', text: 'Toolbox talk on heat stress for 40 steel fixers working outdoors in summer, simple English, with discussion questions.', mode: 'document' },
  { icon: 'checklist', title: 'Inspection checklist', text: 'Pre-use inspection checklist for a mobile elevating work platform (MEWP).', mode: 'checklist' },
  { icon: 'image', title: 'Safety poster', text: 'Poster reminding workers to inspect and connect their harness when working at height.', mode: 'poster' },
  { icon: 'flow', title: 'Process flowchart', text: 'Flowchart for confined space entry: permit, gas test, standby person, rescue plan, close-out.', mode: 'flowchart' },
];

let keySeq = 0;
const nk = () => `k${++keySeq}`;

export function Studio() {
  const { me, can } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const status = useAsync(() => api<{ configured: boolean; model: string; provider?: { id: string; label: string; deterministic: boolean } }>('/ai/status'), []);
  const [convTick, setConvTick] = useState(0);
  const convs = useAsync(() => api<{ items: { id: string; title: string; updatedAt: string }[] }>('/ai/conversations'), [convTick]);
  const [convId, setConvId] = useState<string | undefined>(search.get('c') ?? undefined);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [canvas, setCanvas] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>((search.get('mode') as Mode) || 'ask');
  const [docType, setDocType] = useState<DocumentType>('toolbox_talk');
  const [input, setInput] = useState(search.get('q') ?? '');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState(readPref('voiceLang', 'en-GB'));
  const [speaking, setSpeaking] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const baseText = useRef('');
  const autoSent = useRef(false);

  const configured = status.data?.configured !== false;
  const org = me?.organization.name;

  // Voice dictation appends to whatever was typed before the mic was opened.
  const dict = useDictation((final, interim) => setInput((baseText.current ? baseText.current + ' ' : '') + [final, interim].filter(Boolean).join(' ')), lang);
  const toggleMic = () => {
    if (dict.listening) { dict.stop(); return; }
    baseText.current = input.trim();
    void dict.start();
  };

  // Load an existing conversation.
  useEffect(() => {
    if (!convId) { setMsgs([]); return; }
    if (msgs.some((m) => m.streaming)) return;
    let live = true;
    api<{ messages: { id: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; actions: ChatAction[] }[] }>(`/ai/conversations/${convId}`)
      .then((r) => { if (live) setMsgs(r.messages.map((m) => ({ key: nk(), role: m.role, content: m.content, citations: m.citations ?? [], actions: m.actions ?? [], tools: [], jobs: [] }))); })
      .catch(() => { if (live) { setConvId(undefined); toast('That conversation is no longer available', 'error'); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // Keep the newest content in view while streaming (unless the user scrolled up).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 220) el.scrollTop = el.scrollHeight;
  }, [msgs, jobs]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(220, el.scrollHeight) + 'px';
  }, [input]);

  const patchMsg = (key: string, fn: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m) => (m.key === key ? fn(m) : m)));

  const runJob = useCallback(async (kind: StudioKind, brief: string, opts: { documentType?: DocumentType; sourceFile?: File | null } = {}) => {
    const key = nk();
    setJobs((j) => ({ ...j, [key]: { key, kind, brief, documentType: opts.documentType, status: 'running' } }));
    try {
      let sourceId: string | undefined;
      if (kind === 'review') {
        if (!opts.sourceFile) throw new ApiError(400, 'no_file', 'Attach the document to review first.');
        const up = await api<{ id: string }>(`/studio/sources?filename=${encodeURIComponent(opts.sourceFile.name)}`, { file: opts.sourceFile });
        sourceId = up.id;
      }
      const r = await api<{ item: StudioItem }>('/studio/generate', { body: { kind, brief, documentType: kind === 'document' ? opts.documentType : undefined, projectId: projectId || undefined, sourceId } });
      setJobs((j) => ({ ...j, [key]: { ...j[key]!, status: 'done', item: r.item } }));
      setCanvas(key);
      sound.playContent();
    } catch (e) {
      setJobs((j) => ({ ...j, [key]: { ...j[key]!, status: 'error', error: e instanceof ApiError ? e.message : 'Generation failed.' } }));
      sound.playError();
    }
    return key;
  }, [projectId]);

  const send = async (textArg?: string, modeArg?: Mode) => {
    const text = (textArg ?? input).trim();
    const m = modeArg ?? mode;
    if (busy || (!text && !(m === 'review' && file))) return;
    if (dict.listening) dict.stop();
    setInput('');
    if (m !== 'ask') {
      // Direct generation: no chat round-trip, the brief goes straight to the Studio generator.
      const brief = text || 'Review this document for completeness and good HSE practice.';
      const userKey = nk(), asstKey = nk();
      setMsgs((ms) => [...ms, { key: userKey, role: 'user', content: `${STUDIO_KIND_LABELS[m]}${m === 'document' ? ` · ${DOCUMENT_TYPE_LABELS[docType]}` : ''}${file && m === 'review' ? ` · ${file.name}` : ''}\n${brief}`, citations: [], actions: [], tools: [], jobs: [] },
        { key: asstKey, role: 'assistant', content: `Preparing your ${STUDIO_KIND_LABELS[m].toLowerCase()} — it opens on the right when ready. It is a draft for you to review.`, citations: [], actions: [], tools: [], jobs: [] }]);
      const jobKey = await runJob(m, brief, { documentType: docType, sourceFile: file });
      patchMsg(asstKey, (x) => ({ ...x, jobs: [jobKey] }));
      setFile(null);
      return;
    }
    const userKey = nk(), asstKey = nk();
    setMsgs((ms) => [...ms, { key: userKey, role: 'user', content: text, citations: [], actions: [], tools: [], jobs: [] },
      { key: asstKey, role: 'assistant', content: '', citations: [], actions: [], tools: [], jobs: [], streaming: true }]);
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let buffer = '', raf = 0;
    const flush = () => { raf = 0; const t = buffer; patchMsg(asstKey, (x) => ({ ...x, content: t })); };
    try {
      await streamChat({ message: text, conversationId: convId, projectId: convId ? undefined : projectId || undefined }, {
        onMeta: (d) => { if (!convId) { setConvId(d.conversationId); history.replaceState(null, '', `/app/studio?c=${d.conversationId}`); } },
        onDelta: (t) => { buffer += t; if (!raf) raf = requestAnimationFrame(flush); },
        onTool: (t) => patchMsg(asstKey, (x) => ({ ...x, tools: x.tools.some((y) => y.id === t.id) ? x.tools.map((y) => (y.id === t.id ? t : y)) : [...x.tools, t] })),
        onAction: (a) => {
          patchMsg(asstKey, (x) => ({ ...x, actions: [...x.actions, a] }));
          if (a.type === 'generate') void runJob(a.kind, a.brief, { documentType: a.documentType as DocumentType | undefined }).then((k) => patchMsg(asstKey, (x) => ({ ...x, jobs: [...x.jobs, k] })));
        },
        onDone: (d) => { cancelAnimationFrame(raf); patchMsg(asstKey, (x) => ({ ...x, content: buffer, citations: d.citations, streaming: false })); sound.playContent(); },
      }, ac.signal);
      setConvTick((t) => t + 1);
    } catch (e) {
      cancelAnimationFrame(raf);
      const aborted = (e as Error).name === 'AbortError';
      patchMsg(asstKey, (x) => ({ ...x, content: buffer, streaming: false, error: aborted ? 'Stopped.' : e instanceof ApiError ? e.message : 'The assistant is unavailable.' }));
      if (!aborted) sound.playError();
    } finally { setBusy(false); abort.current = null; }
  };

  // Deep link from the dashboard / command palette: /app/studio?q=…&send=1
  useEffect(() => {
    if (!autoSent.current && search.get('send') === '1' && input.trim() && status.data?.configured) { autoSent.current = true; void send(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
  };

  const newChat = () => { abort.current?.abort(); setConvId(undefined); setMsgs([]); setCanvas(null); history.replaceState(null, '', '/app/studio'); ta.current?.focus(); };
  const removeConv = async (id: string) => {
    await api(`/ai/conversations/${id}`, { method: 'DELETE' }).catch(() => undefined);
    if (id === convId) newChat();
    setConvTick((t) => t + 1);
  };

  const readAloud = (m: Msg) => {
    if (speaking === m.key) { window.speechSynthesis.cancel(); setSpeaking(null); return; }
    speak(m.content, lang); setSpeaking(m.key);
    const iv = setInterval(() => { if (!window.speechSynthesis.speaking) { setSpeaking(null); clearInterval(iv); } }, 500);
  };

  const job = canvas ? jobs[canvas] : undefined;
  const currentMode = MODES.find((x) => x.id === mode)!;

  return (
    <div className={`studio ${job ? 'with-canvas' : ''}`}>
      <aside className="threads" aria-label="Conversations">
        <div className="threads-head">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={newChat}><Icon name="plus" />New chat</button>
          <Link to="/app/studio/library" className="btn" aria-label="Studio library" title="Studio library"><Icon name="library" /></Link>
        </div>
        <div className="threads-list">
          {(convs.data?.items ?? []).length === 0 && <p className="small muted" style={{ padding: '4px 10px' }}>Your conversations appear here.</p>}
          {convs.data?.items.map((c) => (
            <div key={c.id} className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
              <button className="thread" aria-current={c.id === convId} onClick={() => { setCanvas(null); setConvId(c.id); history.replaceState(null, '', `/app/studio?c=${c.id}`); }} title={c.title}>{c.title}</button>
              <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Delete conversation ${c.title}`} onClick={() => void removeConv(c.id)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
        <div className="threads-foot">Answers use only records you can access. Generated items are drafts until reviewed.</div>
      </aside>

      <section className="chat" aria-label="AI Studio chat">
        <div className="chat-scroll" ref={scroller}>
          <div className="chat-inner">
            {msgs.length === 0 && (
              <>
                <div className="welcome has-lightfield">
                  <LightField />
                  <div className="eyebrow"><Icon name="spark" size={14} />FORGEHSE AI STUDIO</div>
                  <h1>Your HSE co-pilot — ask, speak, or create.</h1>
                  <p>Grounded in your organisation's live records, with references you can open. Generate checklists, toolbox talks, method statements, risk assessments, posters and flowcharts from one line — then review and export.</p>
                </div>
                {!configured && <div className="notice warn" style={{ marginBottom: 16 }}>AI is switched off on this server. An administrator can enable the free local rules engine (AI_PROVIDER=local), a self-hosted model, or Claude; until then Studio can show your library but cannot answer or generate.</div>}
                {configured && status.data?.provider?.deterministic && <div className="notice" role="note" style={{ marginBottom: 16 }}><strong>Local rules engine — no AI model.</strong> Answers and drafts come from the FORGEHSE guidance library and your live records. Every draft still needs review before use.</div>}
                <div className="starter-grid">
                  {STARTERS.map((s) => (
                    <button key={s.title} className="starter" disabled={!configured} onClick={() => { setMode(s.mode); if (s.mode === 'document') setDocType(/toolbox/i.test(s.text) ? 'toolbox_talk' : 'method_statement'); void send(s.text, s.mode); }}>
                      <span className="ico"><Icon name={s.icon} /></span><span><strong>{s.title}</strong><span>{s.text}</span></span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {msgs.map((m) => m.role === 'user' ? (
              <div key={m.key} className="msg user"><div className="bubble">{m.content}</div></div>
            ) : (
              <div key={m.key} className="msg assistant">
                <span className="avatar" aria-hidden><Icon name="spark" size={16} /></span>
                <div className="body">
                  {m.tools.length > 0 && <div>{m.tools.map((t) => (
                    <span key={t.id} className={`tool-chip ${t.status}`}>{t.status === 'running' ? <span className="spinner" aria-hidden /> : <Icon name={t.status === 'done' ? 'check' : 'alert'} size={13} />}
                      {TOOL_LABEL[t.name] ?? t.name}{t.summary ? ` · ${t.summary}` : ''}</span>))}</div>}
                  {m.streaming && !m.content && m.tools.every((t) => t.status !== 'running') && <div className="thinking" aria-label="Thinking"><i /><i /><i /></div>}
                  {m.content && <Markdown text={m.content} citations={m.citations} streaming={m.streaming} />}
                  {m.error && <div className="notice error" role="alert" style={{ marginTop: 8 }}>{m.error}</div>}
                  {m.jobs.map((k) => jobs[k] && <JobCard key={k} job={jobs[k]!} onOpen={() => setCanvas(k)} active={canvas === k} />)}
                  {m.actions.filter((a): a is Extract<ChatAction, { type: 'draft_observation' }> => a.type === 'draft_observation').map((a, i) => (
                    <button key={i} className="artifact-card" onClick={() => navigate(`/app/report?notes=${encodeURIComponent(a.notes)}`)}>
                      <span className="ico"><Icon name="eye" /></span>
                      <span style={{ flex: 1 }}><span className="t">Observation report ready to review</span><br /><span className="s">Opens the report form pre-filled from your notes. Nothing is submitted until you press Submit.</span></span>
                      <Icon name="arrow" />
                    </button>
                  ))}
                  {m.citations.length > 0 && !m.streaming && (
                    <div className="sources" aria-label="Records searched">
                      {m.citations.filter((c) => c.cited).concat(m.citations.filter((c) => !c.cited)).slice(0, 8).map((c) => (
                        <Link key={c.refNo} className="source-card" to={`/app/observations/${c.id}`}><b>{c.refNo}{c.cited ? '' : ' · searched'}</b><span>{c.title}</span></Link>
                      ))}
                    </div>
                  )}
                  {!m.streaming && m.content && (
                    <div className="msg-meta">
                      <span><Icon name="spark" size={12} /> AI-generated — verify before relying on it</span>
                      <span className="spacer" />
                      <button className="btn btn-ghost" onClick={() => { void navigator.clipboard.writeText(m.content).then(() => toast('Copied')); }}><Icon name="copy" size={14} />Copy</button>
                      {canSpeak() && <button className="btn btn-ghost" onClick={() => readAloud(m)} aria-pressed={speaking === m.key}><Icon name={speaking === m.key ? 'stop' : 'volume'} size={14} />{speaking === m.key ? 'Stop' : 'Listen'}</button>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="composer-wrap">
          <div className="row mode-row" role="group" aria-label="What to do">
            {MODES.map((x) => <button key={x.id} className="chip-btn" aria-pressed={mode === x.id} onClick={() => { setMode(x.id); sound.playSelection(); ta.current?.focus(); if (x.id === 'review' && !file) fileInput.current?.click(); }}><Icon name={x.icon} size={14} />{x.label}</button>)}
            {mode === 'document' && (
              <select className="select" style={{ width: 'auto', height: 32, minHeight: 32, padding: '0 8px', borderRadius: 999 }} aria-label="Document type" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
                {DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{DOCUMENT_TYPE_LABELS[d]}</option>)}
              </select>
            )}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            {file && <div className="row small" style={{ marginBottom: 6 }}><span className="tool-chip"><Icon name="clip" size={13} />{file.name} · {(file.size / 1024).toFixed(0)} KB</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>Remove</button></div>}
            <label htmlFor="studio-input" className="sr-only">Message</label>
            <textarea id="studio-input" ref={ta} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} placeholder={dict.listening ? 'Listening… speak naturally' : currentMode.placeholder} maxLength={8000} disabled={!configured} />
            <div className="composer-bar">
              <input ref={fileInput} type="file" hidden accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setMode('review'); } e.target.value = ''; }} />
              <button type="button" className="icon-btn" onClick={() => fileInput.current?.click()} aria-label="Attach a document to review" title="Attach a document to review" disabled={!configured}><Icon name="clip" /></button>
              <button type="button" className={`icon-btn mic-btn ${dict.listening ? 'live' : ''}`} onClick={toggleMic} aria-pressed={dict.listening} aria-label={dict.listening ? 'Stop voice input' : 'Speak'} title={dict.supported ? 'Voice input' : 'Voice input is not supported in this browser'} disabled={!configured || !dict.supported}><Icon name={dict.listening ? 'stop' : 'mic'} /></button>
              {dict.listening && <span className="listening" aria-live="polite"><span className="lvl">{dict.level.map((l, i) => <i key={i} style={{ '--h': `${4 + l * 10}px` } as CSSProperties} />)}</span>Listening</span>}
              {dict.supported && !dict.listening && (
                <select aria-label="Voice language" className="select" style={{ width: 'auto', height: 30, minHeight: 30, padding: '0 6px', fontSize: '0.78rem', border: 0, background: 'transparent', color: 'var(--muted)' }} value={lang} onChange={(e) => { setLang(e.target.value); writePref('voiceLang', e.target.value); }}>
                  {VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              )}
              <span className="spacer" />
              {!convId && me && me.projects.length > 1 && (
                <select aria-label="Project context" className="select" style={{ width: 'auto', height: 30, minHeight: 30, padding: '0 8px', fontSize: '0.8rem' }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">All my projects</option>
                  {me.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                </select>
              )}
              {busy
                ? <button type="button" className="send-btn" onClick={() => abort.current?.abort()} aria-label="Stop generating"><Icon name="stop" size={16} /></button>
                : <button type="submit" className="send-btn" aria-label="Send" disabled={!configured || (!input.trim() && !(mode === 'review' && file))}><Icon name={mode === 'ask' ? 'send' : 'spark'} size={16} /></button>}
            </div>
          </form>
          {dict.error && <p className="composer-hint" role="alert" style={{ color: 'var(--danger)' }}>{dict.error}</p>}
          <p className="composer-hint">FORGEHSE AI drafts and advises; it never approves permits, closes hazards or certifies compliance. {can('studio.review') ? 'You can review drafts in the library.' : 'Drafts need review by an HSE engineer or manager.'}</p>
        </div>
      </section>

      {job && (
        <aside className="canvas" aria-label="Generated item">
          <div className="canvas-head">
            <Icon name={KIND_ICON[job.kind]} />
            <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.item?.title ?? `Generating ${STUDIO_KIND_LABELS[job.kind].toLowerCase()}…`}</strong>
            {job.item && <Link className="btn btn-sm" to={`/app/studio/items/${job.item.id}`}>Open</Link>}
            <button className="icon-btn" aria-label="Close preview" onClick={() => setCanvas(null)}><Icon name="x" /></button>
          </div>
          {job.item && <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}><StatusPill status={job.item.status} /><span className="spacer" /><ExportButtons item={job.item} org={org} /></div>}
          <div className="canvas-body print-area">
            {job.status === 'running' && <div className="stack"><p className="muted">Drafting with your organisation's risk matrix and hazard categories…</p><div className="gen-progress"><i /></div><div className="paper" style={{ minHeight: 420, opacity: 0.5 }} /></div>}
            {job.status === 'error' && <div className="notice error">{job.error} <button className="btn btn-sm" onClick={() => void runJob(job.kind, job.brief, { documentType: job.documentType })}>Try again</button></div>}
            {job.item && <StudioPreview item={job.item} org={org} />}
          </div>
        </aside>
      )}
    </div>
  );
}

const TOOL_LABEL: Record<string, string> = {
  search_observations: 'Searched observations', hse_statistics: 'Computed statistics', create_studio_draft: 'Studio draft', prepare_observation: 'Observation draft',
};

function JobCard({ job, onOpen, active }: { job: Job; onOpen: () => void; active: boolean }) {
  return (
    <button className="artifact-card" onClick={onOpen} aria-pressed={active} style={active ? { borderColor: 'var(--electric)' } : undefined}>
      <span className="ico"><Icon name={KIND_ICON[job.kind]} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="t">{job.item?.title ?? `${STUDIO_KIND_LABELS[job.kind]}${job.status === 'running' ? ' — generating…' : ''}`}</span><br />
        <span className="s">{job.status === 'running' ? 'Usually 5–30 seconds' : job.status === 'error' ? job.error : `${STUDIO_KIND_LABELS[job.kind]} · draft — review before use`}</span>
        {job.status === 'running' && <div className="gen-progress"><i /></div>}
      </span>
      <Icon name="chevron" />
    </button>
  );
}
