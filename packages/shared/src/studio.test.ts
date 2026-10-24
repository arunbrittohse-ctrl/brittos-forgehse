import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  studioJsonSchema, parseStudioContent, renderPosterSvg, renderFlowchartSvg, layoutFlowchart, wrap, esc,
  STUDIO_KINDS, POSTER_ICONS, HSE_ICON_PATHS, can, type Flowchart,
} from './index';

describe('studio schemas', () => {
  it('every kind converts to a JSON Schema object usable as a tool input_schema', () => {
    for (const k of STUDIO_KINDS) {
      const s = studioJsonSchema(k);
      assert.equal(s.type, 'object');
      assert.ok(!('$schema' in s));
      assert.ok(Array.isArray(s.required));
    }
  });
  it('fills defaults and rejects missing required fields', () => {
    const ok = parseStudioContent('checklist', { title: 'Ladder check', scope: 'Before each use', sections: [{ heading: 'Condition', items: [{ text: 'Stiles undamaged' }] }] });
    assert.ok(ok.success);
    if (ok.success) assert.deepEqual((ok.data as any).sections[0].items[0], { text: 'Stiles undamaged', guidance: '', critical: false });
    assert.equal(parseStudioContent('checklist', { title: 'x' }).success, false);
  });
  it('flowchart edges must reference existing, unique nodes', () => {
    const base = { title: 'T', nodes: [{ id: 'a', label: 'Start', kind: 'start' }, { id: 'b', label: 'End', kind: 'end' }], edges: [{ from: 'a', to: 'b' }] };
    assert.ok(parseStudioContent('flowchart', base).success);
    assert.equal(parseStudioContent('flowchart', { ...base, edges: [{ from: 'a', to: 'zz' }] }).success, false);
    assert.equal(parseStudioContent('flowchart', { ...base, nodes: [...base.nodes, { id: 'a', label: 'dup', kind: 'step' }] }).success, false);
  });
  it('every poster icon has a drawing', () => {
    for (const i of POSTER_ICONS) assert.ok(HSE_ICON_PATHS[i]?.startsWith('M'), i);
  });
  it('studio.review is held by HSE engineers but not supervisors or viewers', () => {
    const a = (role: any) => [{ organizationId: 'o', role, projectId: null, siteId: null }];
    assert.ok(can(a('hse_engineer'), 'studio.review', { organizationId: 'o' }));
    assert.ok(!can(a('supervisor'), 'studio.review', { organizationId: 'o' }));
    assert.ok(!can(a('viewer'), 'studio.review', { organizationId: 'o' }));
  });
});

describe('renderers', () => {
  it('wrap respects width, line limit and hard-breaks long words', () => {
    assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four']);
    assert.equal(wrap('a b c d e f g h', 3, 2).length, 2);
    assert.ok(wrap('x'.repeat(30), 10).every((l) => l.length <= 10));
  });
  it('escapes every piece of text (no markup injection)', () => {
    const evil = '<script>alert(1)</script>"&\'';
    const svg = renderPosterSvg({ theme: 'warning', signalWord: evil, icon: 'hard_hat', headline: evil, subheadline: evil, points: [evil, 'ok'], footerNote: evil }, { draft: true, orgLabel: evil });
    assert.ok(!svg.includes('<script'));
    assert.ok(svg.includes(esc('<script>').toUpperCase()) || svg.includes('&lt;'));
    const f = renderFlowchartSvg({ title: evil, nodes: [{ id: 'a', label: evil, kind: 'start' }, { id: 'b', label: 'b', kind: 'end' }], edges: [{ from: 'a', to: 'b', label: evil.slice(0, 20) }] });
    assert.ok(!f.includes('<script'));
    assert.ok(f.startsWith('<svg') && f.endsWith('</svg>'));
  });
  it('draft posters carry a visible draft mark; reviewed ones do not', () => {
    const p = { theme: 'mandatory' as const, signalWord: '', icon: 'harness' as const, headline: 'Clip on above 1.8 m', subheadline: '', points: ['Inspect harness', 'Use the anchor'], footerNote: '' };
    assert.ok(renderPosterSvg(p, { draft: true }).includes('REVIEW FIRST'));
    assert.ok(!renderPosterSvg(p, { draft: false }).includes('REVIEW FIRST'));
  });
  it('flowchart layout puts each step below its predecessor and side-routes loops', () => {
    const f: Flowchart = {
      title: 'Permit',
      nodes: [
        { id: 's', label: 'Request permit', kind: 'start' },
        { id: 'c', label: 'Controls in place?', kind: 'decision' },
        { id: 'fix', label: 'Correct controls', kind: 'step' },
        { id: 'go', label: 'Issue permit', kind: 'step' },
        { id: 'e', label: 'Work starts', kind: 'end' },
      ],
      edges: [{ from: 's', to: 'c', label: '' }, { from: 'c', to: 'go', label: 'Yes' }, { from: 'c', to: 'fix', label: 'No' }, { from: 'fix', to: 'c', label: '' }, { from: 'go', to: 'e', label: '' }],
    };
    const L = layoutFlowchart(f);
    const by = Object.fromEntries(L.boxes.map((b) => [b.id, b]));
    assert.ok(by.c!.y > by.s!.y && by.go!.y > by.c!.y && by.e!.y > by.go!.y);
    assert.equal(L.edges.filter((e) => e.back).length, 1);
    for (const b of L.boxes) assert.ok(b.x >= 0 && b.x + b.w <= L.width && b.y + b.h <= L.height);
  });
});
