import { useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { fmtDateTime, money, compact } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Loading, ErrorNotice, Empty } from '../components/ui';

interface Usage {
  days: number; model: string; cacheTtl: string;
  totals: Record<string, number | null>;
  byFeature: { feature: string; requests: number; totalInputTokens: number; outputTokens: number; estimatedCostUsd: number | null }[];
  byDay: { day: string; requests: number; hits: number; cacheReadTokens: number; estimatedCostUsd: number | null }[];
  recent: { createdAt: string; feature: string; model: string; cacheStatus: string; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number; latencyMs: number; estimatedCostUsd: number | null; errorCode: string | null }[];
  pricing: { version: string; verified: boolean; source: string };
  note: string;
}
const FEATURE: Record<string, string> = { draft_observation: 'Observation drafts', suggest_capa: 'Action suggestions', summarize_observations: 'Summaries', ask: 'Questions' };
const CACHE: Record<string, string> = { hit: 'Cache hit', write: 'Cache written', miss: 'Not cached', not_requested: 'Below cache minimum', error: 'Failed' };

export function AiUsage() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useAsync(() => api<Usage>('/ai/usage', { query: { days } }), [days]);
  const t = data?.totals ?? {};
  return (
    <>
      <PageHead title="AI usage" sub={data ? `Model ${data.model}, cache lifetime ${data.cacheTtl}` : undefined} actions={
        <div className="segmented" role="group" aria-label="Period">{[7, 30, 90].map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div>} />
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <div className="stack">
          {!data.pricing.verified && <div className="notice warn">Cost figures use an unverified price table ({data.pricing.version}). Confirm prices against Anthropic's official pricing page and load them with AI_PRICING_FILE before relying on these estimates.</div>}
          <section className="kpi-strip" aria-label="AI usage totals">
            <div className="kpi"><div className="value">{t.requests}</div><span className="label">Requests</span><div className="sub">{t.errors} failed</div></div>
            <div className="kpi"><div className="value">{t.cacheHitRate === null ? '—' : `${t.cacheHitRate}%`}</div><span className="label">Cache hit rate</span><div className="sub">Of requests that asked for caching</div></div>
            <div className="kpi"><div className="value">{t.cachedInputShare === null ? '—' : `${t.cachedInputShare}%`}</div><span className="label">Input read from cache</span><div className="sub">{compact(t.cacheReadTokens)} tokens</div></div>
            <div className="kpi"><div className="value">{compact((t.inputTokens ?? 0) + (t.cacheCreationTokens ?? 0))}</div><span className="label">Uncached input tokens</span><div className="sub">{compact(t.cacheCreationTokens)} written to cache</div></div>
            <div className="kpi"><div className="value">{money(t.estimatedCostUsd)}</div><span className="label">Estimated cost</span><div className="sub">{compact(t.outputTokens)} output tokens</div></div>
            <div className="kpi"><div className="value">{money(t.estimatedSavingsUsd)}</div><span className="label">Estimated saving from cache</span><div className="sub">vs. the same calls uncached</div></div>
          </section>
          <p className="small muted">{data.note} Average latency {t.avgLatencyMs ?? '—'} ms ({t.avgLatencyHitMs ?? '—'} ms with a cache hit, {t.avgLatencyNoHitMs ?? '—'} ms without).{t.unpricedRequests ? ` ${t.unpricedRequests} requests used a model with no configured price and are excluded from cost.` : ''}</p>
          {data.totals.requests === 0 ? <div className="panel"><Empty title="No AI requests in this period">Usage appears here as soon as someone uses the assistant.</Empty></div> : (<>
            <section className="panel"><div className="panel-head"><h2>By feature</h2></div><div className="table-wrap"><table className="data">
              <thead><tr><th>Feature</th><th>Requests</th><th>Input tokens</th><th>Output tokens</th><th>Estimated cost</th></tr></thead>
              <tbody>{data.byFeature.map((f) => <tr key={f.feature}><td>{FEATURE[f.feature] ?? f.feature}</td><td className="num">{f.requests}</td><td className="num">{compact(f.totalInputTokens)}</td><td className="num">{compact(f.outputTokens)}</td><td className="num">{money(f.estimatedCostUsd)}</td></tr>)}</tbody>
            </table></div></section>
            <section className="panel"><div className="panel-head"><h2>Recent requests</h2><span className="spacer" /><span className="small muted">Token counts as reported by the API. Prompt text is never stored.</span></div><div className="table-wrap"><table className="data">
              <thead><tr><th>When</th><th>Feature</th><th>Cache</th><th>Input</th><th>Cache read</th><th>Cache write</th><th>Output</th><th>Latency</th><th>Est. cost</th></tr></thead>
              <tbody>{data.recent.map((r, i) => (
                <tr key={i}><td className="small num">{fmtDateTime(r.createdAt)}</td><td className="small">{FEATURE[r.feature] ?? r.feature}</td>
                  <td className="small">{r.errorCode ? <span style={{ color: 'var(--critical)' }}>{r.errorCode}</span> : CACHE[r.cacheStatus]}</td>
                  <td className="num small">{r.inputTokens}</td><td className="num small">{r.cacheReadTokens}</td><td className="num small">{r.cacheCreationTokens}</td><td className="num small">{r.outputTokens}</td>
                  <td className="num small">{r.latencyMs} ms</td><td className="num small">{money(r.estimatedCostUsd)}</td></tr>))}</tbody>
            </table></div></section>
          </>)}
        </div>
      )}
    </>
  );
}
