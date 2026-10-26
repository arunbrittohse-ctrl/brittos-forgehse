import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { PageHead } from '../components/AppShell';
import { Field, Icon } from '../components/ui';

/** Very small, safe Markdown renderer (headings, bullets, bold). Builds React nodes — never injects HTML. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={out.length}>{list}</ul>); list = []; } };
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (/^[-*] /.test(t)) { list.push(<li key={i}>{inline(t.slice(2))}</li>); return; }
    flush();
    if (!t) return;
    const h = /^(#{1,3}) (.*)$/.exec(t);
    if (h) out.push(h[1]!.length === 1 ? <h2 key={i}>{h[2]}</h2> : <h3 key={i}>{h[2]}</h3>);
    else out.push(<p key={i}>{inline(t)}</p>);
  });
  flush();
  return <div className="md">{out}</div>;
}

interface Turn { task: string; input: string; text?: string; error?: string; truncated?: boolean }

export function Assistant() {
  const { me } = useAuth();
  const status = useAsync(() => api<{ configured: boolean; model: string; provider?: { id: string; label: string; deterministic: boolean } }>('/ai/status'), []);
  const [task, setTask] = useState<'ask' | 'summarize_observations'>('ask');
  const [projectId, setProjectId] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = task === 'summarize_observations' ? input || 'Write the management summary for the last 30 days.' : input;
    setBusy(true);
    try {
      const r = await api<{ text: string; truncated: boolean }>('/ai/assist', { body: { task, input: text, projectId: projectId || undefined } });
      setTurns((t) => [{ task, input: text, text: r.text, truncated: r.truncated }, ...t]);
      setInput('');
    } catch (err) {
      setTurns((t) => [{ task, input: text, error: err instanceof ApiError ? err.message : 'The assistant is unavailable.' }, ...t]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="HSE assistant" sub="Ask HSE questions or get a management summary of recent observations. Answers are drafts for a competent person to check." />
      {status.data && !status.data.configured && <div className="notice warn" style={{ marginBottom: 16 }}>The assistant is switched off on this server. An administrator can enable the free local rules engine (AI_PROVIDER=local), a self-hosted model, or Claude.</div>}
      {status.data?.configured && status.data.provider?.deterministic && <div className="notice" role="note" style={{ marginBottom: 16 }}><strong>Local rules engine — no AI model.</strong> Replies are rules-based from the FORGEHSE guidance library and your records.</div>}
      <div className="detail-grid">
        <div className="stack">
          {turns.length === 0 && (
            <div className="panel panel-body">
              <h2>What it can help with</h2>
              <ul className="small" style={{ marginTop: 10, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Explain what a good method statement or toolbox talk for a task should cover</li>
                <li>Suggest inspection points for scaffolding, excavations or lifting operations</li>
                <li>Summarise the last 30 days of observations for a management meeting</li>
                <li>Turn rough site notes into an observation, from the Report observation page</li>
              </ul>
              <p className="small muted" style={{ marginTop: 10 }}>The assistant only sees records you are allowed to see. It will not quote regulation clauses it was not given; confirm legal requirements with the official text.</p>
            </div>
          )}
          {turns.map((t, i) => (
            <article key={turns.length - i} className="panel">
              <div className="panel-head"><span className="small muted">{t.task === 'ask' ? 'Question' : 'Summary request'}</span></div>
              <div className="panel-body stack">
                <p><strong>{t.input}</strong></p>
                {t.error ? <div className="notice error">{t.error}</div> : <Markdown text={t.text ?? ''} />}
                {t.truncated && <p className="small muted">The answer was cut short. Ask a narrower question for the rest.</p>}
                {!t.error && <p className="small ai-tag"><Icon name="spark" size={12} /> AI-generated. Verify before relying on it.</p>}
              </div>
            </article>
          ))}
        </div>
        <form className="panel panel-body stack" onSubmit={submit} style={{ position: 'sticky', top: 80 }}>
          <div className="segmented" role="group" aria-label="Request type">
            <button type="button" aria-pressed={task === 'ask'} onClick={() => setTask('ask')}>Ask a question</button>
            <button type="button" aria-pressed={task === 'summarize_observations'} onClick={() => setTask('summarize_observations')}>Summarise 30 days</button>
          </div>
          <Field label="Project" htmlFor="ai-project" hint={task === 'summarize_observations' ? 'Leave blank to summarise all your projects' : 'Optional context'}>
            <select id="ai-project" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All my projects</option>
              {me?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </Field>
          <Field label={task === 'ask' ? 'Your question' : 'Anything to focus on? (optional)'} htmlFor="ai-input">
            <textarea id="ai-input" className="textarea" value={input} onChange={(e) => setInput(e.target.value)} maxLength={8000} />
          </Field>
          <button className="btn btn-primary" disabled={busy || (task === 'ask' && input.trim().length < 3) || status.data?.configured === false}>{busy ? 'Working…' : task === 'ask' ? 'Ask' : 'Write summary'}</button>
        </form>
      </div>
    </>
  );
}
