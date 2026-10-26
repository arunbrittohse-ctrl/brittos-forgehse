import { useEffect, useState } from 'react';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType, type HseDocument } from '@forgehse/shared';
import { api } from '../lib/api';
import { PageHead } from '../components/AppShell';
import { Icon, useToast } from '../components/ui';
import { Link } from '../lib/router';

type Inputs = {
 docType:DocumentType; title:string; projectId:string; projectName:string; site:string; client:string; country:string; emirate:string;
 authorityRequirements:string; workPackage:string; activity:string; scope:string; sequence:string; equipment:string; materials:string;
 workforce:string; environment:string; isolations:string; hazards:string[]; emergency:string; ppe:string; references:string; riskMatrixConvention:string;
};
type Saved = {id:string;title:string;content:HseDocument;version:number;status:'draft'|'reviewed';projectId?:string|null;createdAt?:string;updatedAt?:string};
const initial:Inputs={docType:'risk_assessment',title:'',projectId:'',projectName:'',site:'',client:'',country:'United Arab Emirates',emirate:'Abu Dhabi',authorityRequirements:'',workPackage:'',activity:'',scope:'',sequence:'',equipment:'',materials:'',workforce:'',environment:'',isolations:'',hazards:[],emergency:'',ppe:'',references:'',riskMatrixConvention:'Likelihood × Severity; 1–5 scales. Confirm the organisation-approved matrix and risk bands before issue.'};
const HAZARDS=['Work at height','Lifting operations','Excavation','Confined space','Electrical','Hot work','Chemicals','Traffic / mobile plant','Manual handling','Noise / dust','Simultaneous operations'];
export function HseDocumentStudio(){
 const toast=useToast(); const [form,setForm]=useState<Inputs>(initial); const [items,setItems]=useState<Saved[]>([]);
 const [current,setCurrent]=useState<Saved|null>(null); const [json,setJson]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
 const set=(k:keyof Inputs,v:unknown)=>setForm(f=>({...f,[k]:v}));
 const loadList=async()=>{try{const r=await api<{items:Saved[]}>('/hse-documents');setItems(r.items);}catch(e){setError(e instanceof Error?e.message:'Could not load saved drafts.');}};
 useEffect(()=>{void loadList();},[]);
 const generate=async()=>{setError(''); if(!form.title.trim()||!form.activity.trim()||!form.scope.trim()){setError('Complete document title, work activity and scope before generating.');return;}
 setLoading(true);try{const r=await api<Saved & {disclaimer:string}>('/hse-documents/generate',{method:'POST',body:{...form,projectId:form.projectId||undefined}});setCurrent(r);setJson(JSON.stringify(r.content,null,2));toast(r.disclaimer,'success');await loadList();}catch(e){setError(e instanceof Error?e.message:'Draft generation failed.');}finally{setLoading(false);}};
 const open=async(id:string)=>{setError('');try{const r=await api<{item:Saved;revisions:unknown[]}>(`/hse-documents/${id}`);setCurrent(r.item);setJson(JSON.stringify(r.item.content,null,2));}catch(e){setError(e instanceof Error?e.message:'Could not open draft.');}};
 const save=async()=>{if(!current)return;setError('');try{const content=JSON.parse(json) as HseDocument;const r=await api<Saved>(`/hse-documents/${current.id}`,{method:'PATCH',body:{title:content.title,content,version:current.version,changeNote:'Edited in HSE Document Studio'}});setCurrent(r);setJson(JSON.stringify(r.content,null,2));toast('Draft saved with a new revision.','success');await loadList();}catch(e){setError(e instanceof Error?e.message:'Save failed. Check that the preview contains valid document JSON.');}};
 const exportFile=(format:'docx'|'pdf')=>{if(!current)return;window.open(`/api/studio/items/${current.id}/export?format=${format}`,'_blank','noopener,noreferrer');};
 const hazardField=['risk_assessment','jsa_jha','method_statement','work_method_plan'].includes(form.docType);
 const setInput=(key:keyof Inputs,label:string,placeholder='',multiline=false)=><label className="field"><span>{label}</span>{multiline?<textarea value={String(form[key]??'')} onChange={e=>set(key,e.target.value)} placeholder={placeholder} rows={3}/>:<input value={String(form[key]??'')} onChange={e=>set(key,e.target.value)} placeholder={placeholder}/>}</label>;
 return <div className="hse-doc-studio">
  <PageHead title="HSE Document Studio" sub="Create, edit, save and export controlled HSE document drafts." actions={<Link to="/app/studio" className="btn"><Icon name="spark"/> AI Studio</Link>}/>
  <div className="notice warn"><strong>Draft safeguard.</strong> Template-based generation is deterministic; it does not call a live AI model. Drafts are not legal advice or approvals. A qualified person must verify site facts, current requirements, risk scoring and approvals.</div>
  {error&&<div className="notice error" role="alert">{error}</div>}
  <div className="studio-doc-layout">
   <section className="panel"><div className="panel-head"><h2>Document inputs</h2><span className="muted small">Required fields marked *</span></div><div className="panel-body stack">
    <label className="field"><span>Document type *</span><select value={form.docType} onChange={e=>set('docType',e.target.value)}>{DOCUMENT_TYPES.map(t=><option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}</select></label>
    {setInput('title','Document title *','e.g. Mobile crane lifting operation')}
    <div className="grid two">{setInput('projectName','Project name','Project / package name')}{setInput('site','Site / location','Worksite / zone')}</div>
    <div className="grid two">{setInput('client','Client','Client / consultant')}{setInput('workPackage','Work package','Package / subcontract')}</div>
    <div className="grid two">{setInput('country','Country','Country')}{setInput('emirate','Emirate / region','Abu Dhabi')}</div>
    {setInput('activity','Work activity *','Describe the exact activity')}
    {setInput('scope','Scope and boundaries *','Inclusions, exclusions, interfaces and limits',true)}
    {setInput('sequence','Work sequence','Actual steps in sequence',true)}
    <div className="grid two">{setInput('equipment','Plant / tools / equipment','Equipment and inspection needs',true)}{setInput('materials','Materials / chemicals','Include SDS references where relevant',true)}</div>
    {setInput('workforce','Workforce / competencies','Roles, training, authorisations',true)}
    {hazardField&&<div className="field"><span>Activity-specific hazard prompts</span><div className="hazard-checks">{HAZARDS.map(h=><label key={h}><input type="checkbox" checked={form.hazards.includes(h)} onChange={e=>set('hazards',e.target.checked?[...form.hazards,h]:form.hazards.filter(x=>x!==h))}/>{h}</label>)}</div></div>}
    {form.hazards.some(h=>['Electrical','Confined space','Lifting operations','Excavation','Work at height'].includes(h))&&setInput('isolations','Energy sources / isolation and specialist controls','Isolation points, LOTO, permit, rescue or lifting arrangements',true)}
    {setInput('environment','Environmental conditions / SIMOPS','Weather, access, nearby work, dust, noise, waste',true)}
    {setInput('authorityRequirements','Authority / client requirements supplied','Paste exact requirement references supplied by the project',true)}
    {setInput('references','Source references / specifications','Controlled document IDs, revision and supplied references',true)}
    {setInput('emergency','Emergency arrangements','Contacts, alarm, muster, rescue, first aid',true)}
    {setInput('ppe','Required PPE','Task-specific PPE to verify',true)}
    {hazardField&&setInput('riskMatrixConvention','Risk matrix convention','Document the approved likelihood/severity convention')}
    <button className="btn btn-primary" onClick={()=>void generate()} disabled={loading}>{loading?'Preparing draft…':<><Icon name="spark"/> Generate deterministic draft</>}</button>
   </div></section>
   <section className="panel"><div className="panel-head"><h2>Saved drafts</h2><button className="btn btn-sm" onClick={()=>void loadList()}><Icon name="refresh"/> Refresh</button></div><div className="panel-body">
    {!items.length?<p className="muted">No saved HSE document drafts yet.</p>:<div className="saved-doc-list">{items.map(i=><button className={current?.id===i.id?'saved-doc active':'saved-doc'} key={i.id} onClick={()=>void open(i.id)}><strong>{i.title}</strong><span>v{i.version} · {i.status.toUpperCase()} · {i.id.slice(0,8)}</span></button>)}</div>}
   </div>
   {current&&<><div className="panel-head"><h2>Editable document preview</h2><span className="badge">DRAFT · v{current.version}</span></div><div className="panel-body stack">
    <div className="notice">Edit the structured document JSON below. Save validates the schema and creates a revision. Keep status as draft until the formal review/approval workflow is completed.</div>
    <textarea className="document-json-editor" aria-label="Editable structured document content" value={json} onChange={e=>setJson(e.target.value)} spellCheck={false}/>
    <div className="row wrap"><button className="btn btn-primary" onClick={()=>void save()}><Icon name="save"/> Save draft</button><button className="btn" onClick={()=>exportFile('docx')}><Icon name="download"/> Export DOCX</button><button className="btn" onClick={()=>exportFile('pdf')}><Icon name="download"/> Export PDF</button><button className="btn" onClick={()=>window.print()}><Icon name="printer"/> Print</button></div>
    <div className="paper-preview"><h2>{current.title}</h2><p><strong>Document ID:</strong> FHSE-DOC-{current.id.slice(0,8).toUpperCase()} · <strong>Version:</strong> {current.version} · <strong>Status:</strong> DRAFT — NOT APPROVED</p><p><strong>Purpose:</strong> {current.content.purpose}</p><p><strong>Scope:</strong> {current.content.scope}</p>{current.content.sections.map((s,i)=><section key={i}><h3>{s.heading}</h3>{s.body.split('\n').map((p,j)=><p key={j}>{p}</p>)}{s.bullets.length>0&&<ul>{s.bullets.map((b,j)=><li key={j}>{b}</li>)}</ul>}</section>)}{current.content.riskTable.length>0&&<section><h3>Risk assessment table</h3><div className="table-scroll"><table><thead><tr><th>Task step</th><th>Hazard</th><th>Consequence</th><th>Initial L×S</th><th>Controls</th><th>Residual L×S</th></tr></thead><tbody>{current.content.riskTable.map((r,i)=><tr key={i}><td>{r.activity}</td><td>{r.hazard}</td><td>{r.consequence}</td><td>{r.likelihood} × {r.severity}</td><td>{r.controls.join('; ')}</td><td>{r.residualLikelihood} × {r.residualSeverity}</td></tr>)}</tbody></table></div></section>}<h3>Review and approval placeholders</h3><p>Prepared by: __________________ · HSE review: __________________ · Project approval: __________________ · Date: __________</p></div>
   </div></>}
  </section>
  </div>
 </div>;
}
