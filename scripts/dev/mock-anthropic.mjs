// DEVELOPMENT / TEST ONLY — a local stand-in for the Anthropic Messages API so the AI Studio UI
// can be exercised end-to-end without an API key. Every reply is canned and clearly labelled as
// mock output. Never point a production deployment at this server.
//
//   node scripts/dev/mock-anthropic.mjs            (listens on 127.0.0.1:4500)
//   ANTHROPIC_BASE_URL=http://127.0.0.1:4500 ANTHROPIC_API_KEY=mock-key npm run dev:api
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4500);
const NOTE = 'Mock AI output from the local test server — not a real model response.';

function sample(kind, brief) {
  const short = brief.replace(/\s+/g, ' ').slice(0, 60);
  switch (kind) {
    case 'checklist': return {
      title: `Pre-use inspection — ${short}`, scope: 'Complete before first use each shift and after any modification. Stop and report if any critical item is answered No.',
      sections: [
        { heading: 'Documentation and competence', items: [
          { text: 'Operator holds a valid competence card for this equipment class', critical: true, guidance: 'Check card number and expiry against the register' },
          { text: 'Daily inspection record from the previous shift is complete', critical: false, guidance: '' },
          { text: 'Lifting / work plan for today has been briefed to the crew', critical: false, guidance: '' } ] },
        { heading: 'Condition of equipment', items: [
          { text: 'Guardrails, gates and toe boards are fitted and undamaged', critical: true, guidance: '' },
          { text: 'Emergency lowering and stop controls function correctly', critical: true, guidance: 'Test from both platform and ground controls' },
          { text: 'Tyres, outriggers and chassis show no visible damage or leaks', critical: false, guidance: '' } ] },
        { heading: 'Work area', items: [
          { text: 'Ground is firm and level within the manufacturer limits', critical: true, guidance: '[confirm limit per project procedure]' },
          { text: 'Exclusion zone is barricaded and signed', critical: false, guidance: '' },
          { text: 'Overhead hazards (services, structures) identified and controlled', critical: true, guidance: '' } ] },
      ],
      notes: ['Confirm numeric limits (slope, wind speed, load) against the manufacturer manual and project procedure.', NOTE],
    };
    case 'document': return {
      docType: 'toolbox_talk', title: `Toolbox talk — ${short}`,
      purpose: 'To make sure every worker recognises the early signs of heat illness and knows the controls in place on this site.',
      scope: 'All site personnel and subcontractors working outdoors or in hot enclosed areas.',
      sections: [
        { heading: 'Why it matters', body: 'Working in high heat and humidity puts the body under strain. Heat exhaustion can progress to heat stroke, which is a medical emergency.', bullets: [] },
        { heading: 'Key hazards', body: '', bullets: ['Direct sun and radiant heat from steel and concrete', 'Heavy physical work without rest', 'Dehydration and not being acclimatised', 'Heavy or non-breathable clothing'] },
        { heading: 'Controls on this site', body: '', bullets: ['Drink water regularly — do not wait until you are thirsty', 'Use the shaded rest areas at scheduled breaks', 'Work-hour restrictions apply as set in the project procedure [to be confirmed]', 'Tell your supervisor immediately if you or a colleague feels unwell'] },
        { heading: 'Discussion questions', body: '', bullets: ['What are the early signs of heat exhaustion?', 'Where is the nearest rest shelter and first aider?', 'What will you do if a colleague becomes confused?'] },
      ],
      responsibilities: [{ role: 'Supervisor', duties: 'Deliver the talk, enforce rest breaks and monitor the crew.' }, { role: 'All workers', duties: 'Hydrate, rest, look out for each other and report symptoms.' }],
      riskTable: [],
      reviewNotes: ['Insert the site first aider names and emergency number [to be confirmed]', 'Confirm the work-hour restrictions that apply to this project', NOTE],
    };
    case 'poster': return { theme: 'mandatory', signalWord: 'MANDATORY', icon: 'harness', headline: 'Clip on before you step out', subheadline: 'Your harness only protects you when it is connected.', points: ['Inspect harness and lanyard before every use', 'Anchor at or above shoulder height', 'Stay connected while moving at height', 'Report damaged equipment immediately'], footerNote: 'Mock AI sample' };
    case 'flowchart': return { title: `Process — ${short}`, nodes: [
      { id: 'n1', label: 'Request permit', kind: 'start' }, { id: 'n2', label: 'Isolate and test atmosphere', kind: 'step' },
      { id: 'n3', label: 'Readings within limits?', kind: 'decision' }, { id: 'n4', label: 'Ventilate and re-test', kind: 'step' },
      { id: 'n5', label: 'Standby person and rescue plan in place?', kind: 'decision' }, { id: 'n6', label: 'Arrange standby and rescue equipment', kind: 'step' },
      { id: 'n7', label: 'Issue permit and brief entrants', kind: 'step' }, { id: 'n8', label: 'Monitor during work', kind: 'step' }, { id: 'n9', label: 'Close out permit', kind: 'end' } ],
      edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n5', label: 'Yes' }, { from: 'n3', to: 'n4', label: 'No' }, { from: 'n4', to: 'n3' },
        { from: 'n5', to: 'n7', label: 'Yes' }, { from: 'n5', to: 'n6', label: 'No' }, { from: 'n6', to: 'n5' }, { from: 'n7', to: 'n8' }, { from: 'n8', to: 'n9' }] };
    case 'review': return { documentTitle: 'Uploaded document', documentType: 'Method statement', summary: 'The document covers the sequence of work but lacks detail on emergency arrangements and competence.', overallRating: 'needs_improvement',
      strengths: ['Clear sequence of work'], findings: [{ severity: 'major', section: 'Emergency arrangements', issue: 'No rescue plan described', recommendation: 'Add a rescue plan with roles and equipment' }],
      missingElements: ['Competence requirements'], questionsForAuthor: ['Who supervises the activity?', NOTE] };
    default: return {};
  }
}

function lastUserText(body) {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const m = body.messages[i];
    if (m.role !== 'user') continue;
    const t = m.content.find((c) => c.type === 'text');
    if (t) return t.text;
    return null;
  }
  return '';
}

function plan(body) {
  const forced = body.tool_choice?.type === 'tool' ? body.tool_choice.name : null;
  if (forced) {
    const kind = forced.replace('emit_', '');
    const brief = (body.messages[0].content.find((c) => c.type === 'text')?.text ?? '').split('<brief>')[1]?.split('</brief>')[0]?.trim() ?? '';
    return { tools: [{ name: forced, input: sample(kind, brief) }] };
  }
  const last = body.messages[body.messages.length - 1];
  const toolResult = last.content.find((c) => c.type === 'tool_result');
  if (toolResult) {
    let data = {};
    try { data = JSON.parse(toolResult.content); } catch { /* ignore */ }
    if (data.records) {
      const lines = data.records.slice(0, 5).map((r) => `| [${r.refNo}] | ${r.hazardCategory} | ${r.location || r.site} | ${r.riskBand} | ${r.status.replace('_', ' ')} |`);
      return { text: `**${data.matched} matching record${data.matched === 1 ? '' : 's'}** in your scope, highest risk first.\n\n| Ref | Hazard | Location | Risk | Status |\n|---|---|---|---|---|\n${lines.join('\n')}\n\n### Suggested focus\n- Close out the highest-rated items first and verify on site.\n- Check overdue actions with their owners this week.\n\n_${NOTE}_` };
    }
    if (data.periodDays) {
      return { text: `### Last ${data.periodDays} days\n- **${data.reportedInPeriod}** observations reported (${data.unsafeActs} unsafe acts, ${data.unsafeConditions} unsafe conditions)\n- **${data.openNow}** open now, **${data.overdueNow}** overdue\n- **${data.highOrCriticalOpen}** high or critical still open\n\nTop hazard: ${data.byHazardCategory?.[0]?.category ?? '—'}.\n\n_${NOTE}_` };
    }
    return { text: `Your draft is being prepared in Studio — review it before use.\n\n_${NOTE}_` };
  }
  const q = (lastUserText(body) ?? '').toLowerCase();
  if (/checklist|poster|flowchart|flow chart|toolbox|method statement|procedure/.test(q)) {
    const kind = /checklist/.test(q) ? 'checklist' : /poster/.test(q) ? 'poster' : /flow/.test(q) ? 'flowchart' : 'document';
    return { text: 'On it — preparing that in Studio.', tools: [{ name: 'create_studio_draft', input: { kind, brief: q.slice(0, 300) } }] };
  }
  if (/summar|month|trend|statistic|how many|30 days/.test(q)) return { text: 'Checking your live figures.', tools: [{ name: 'hse_statistics', input: { days: 30 } }] };
  if (/open|overdue|high|critical|show|which|list|edge|scaffold|electric/.test(q)) return { text: 'Searching your records.', tools: [{ name: 'search_observations', input: { query: q.replace(/which|what|show|me|are|still|the|high|critical|open|items|observations?|and|or|risk/g, ' ').trim(), status: /overdue/.test(q) ? 'overdue' : 'open', riskBand: /high|critical/.test(q) ? 'high_or_critical' : 'any' } }] };
  return { text: `## Hot work: key controls\n\n1. **Permit** — issue a hot work permit before starting and keep it at the work area.\n2. **Clear the area** — remove or protect combustibles; check below and behind walls.\n3. **Fire watch** — a trained person with a suitable extinguisher stays during the work and afterwards for the period set in your procedure.\n4. **Equipment** — inspect hoses, regulators and flashback arrestors.\n\n> Confirm the exact requirements in your project HSE plan.\n\n_${NOTE}_` };
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) { res.statusCode = 404; res.end(); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    const body = JSON.parse(raw);
    const p = plan(body);
    const content = [];
    if (p.text) content.push({ type: 'text', text: p.text });
    (p.tools ?? []).forEach((t, i) => content.push({ type: 'tool_use', id: `toolu_mock_${Date.now()}_${i}`, name: t.name, input: t.input }));
    const stop = p.tools?.length ? 'tool_use' : 'end_turn';
    const usage = { input_tokens: 420, output_tokens: 180, cache_creation_input_tokens: 0, cache_read_input_tokens: 2900 };
    if (!body.stream) {
      await new Promise((r) => setTimeout(r, 700));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'msg_mock', model: body.model, content, stop_reason: stop, usage }));
      return;
    }
    res.setHeader('content-type', 'text/event-stream');
    const send = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    send('message_start', { message: { model: body.model, usage: { ...usage, output_tokens: 1 } } });
    let idx = 0;
    if (p.text) {
      send('content_block_start', { index: idx, content_block: { type: 'text', text: '' } });
      for (const chunk of p.text.match(/.{1,6}/gs) ?? []) { send('content_block_delta', { index: idx, delta: { type: 'text_delta', text: chunk } }); await new Promise((r) => setTimeout(r, 12)); }
      send('content_block_stop', { index: idx++ });
    }
    for (const c of content.filter((x) => x.type === 'tool_use')) {
      send('content_block_start', { index: idx, content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} } });
      send('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } });
      send('content_block_stop', { index: idx++ });
    }
    send('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: usage.output_tokens } });
    send('message_stop', {});
    res.end();
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[mock-anthropic] TEST ONLY — listening on http://127.0.0.1:${PORT}`));
