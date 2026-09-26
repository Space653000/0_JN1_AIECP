'use strict';

// One-time, conservative extraction from the normative Blueprint text. This
// script deliberately does not run in verify: manual evidence review is needed.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const blueprint=path.join(root,'Blueprint');
const names=fs.readdirSync(blueprint).filter(n=>/^\d\d_.*\.md$/.test(n));
const read=n=>fs.readFileSync(path.join(blueprint,n),'utf8').split(/\r?\n/);
const items=[];const seen=new Set();
function section(lines,index){
  for(let i=index;i>=0;i--)if(/^##?\s/.test(lines[i]))return lines[i];
  return lines[0];
}
function add(name,index,id,text,workOrder='UNASSIGNED'){
  if(seen.has(id))return;seen.add(id);
  const lines=read(name);
  items.push({id,source:{file:`Blueprint/${name}`,section:section(lines,index)},text:text.trim(),status:'GAP',evidence:[],workOrder,note:'Normative clause extracted from Blueprint; implementation/test equivalence not yet proven.'});
}
const req='REQUIREMENTS.md';read(req).forEach((line,i)=>{
  const match=line.match(/^\s*-\s*\*\*(R[1-8]\.\d+)\*\*\s*(.+)/);
  if(match)add(req,i,match[1],match[2]);
});
const groups=[
  ['18_BOUNDED_AUTONOMOUS_EXECUTION.md','## 13. Acceptance criteria',15,'B18-13'],
  ['20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md','## 27. Acceptance criteria',20,'B20-27'],
  ['21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md','## 10. Handoff rules',8,'B21-10'],
  ['22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md','## 16. Acceptance',8,'B22-16']
];
for(const [name,heading,count,prefix] of groups){
  const lines=read(name);let start=lines.indexOf(heading);if(start<0)throw Error(`missing ${heading}`);
  let found=0;for(let i=start+1;i<lines.length&&!/^## /.test(lines[i]);i++){
    const m=lines[i].match(/^(\d+)\.\s+(.+)/);if(!m)continue;
    found++;add(name,i,`${prefix}-${String(+m[1]).padStart(2,'0')}`,m[2]);
  }
  if(found!==count)throw Error(`${name} ${heading}: expected ${count}, found ${found}`);
}
// The handoff schemas and dashboard sections are normative even when they do
// not repeat the word "must" on every field or line.
for(const [name,sections,prefix] of [
  ['21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md',[6,7],'B21'],
  ['22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md',[5,6,7,8,9,10,11],'B22'],
  ['11_TASK_PROTOCOL.md',[2,4,5,6,7,8],'B11']
]){
  const lines=read(name);
  for(const number of sections){
    const start=lines.findIndex(l=>new RegExp(`^## ${number}\\.`).test(l));
    if(start<0)throw Error(`${name} section ${number} missing`);
    let end=lines.findIndex((l,i)=>i>start&&/^## /.test(l));if(end<0)end=lines.length;
    const body=lines.slice(start+1,end).filter(l=>l.trim()&&!/^~~~|^```/.test(l));
    if(name.startsWith('21_')){
      add(name,start,`${prefix}-${number}-SCHEMA`,body.filter(l=>/^(?:schema:|task_id:|run_id:|agent:|worker_id:|reviewer:|result:|blueprint:|plan:|implementation:|tests:|security:|architecture:|findings:|required_changes:|changed_files:|commands:|unresolved:|evidence_refs:|iteration:|base_commit:)/.test(l)).join(' '), '0007');
    }else if(name.startsWith('22_')){
      if(number===5)add(name,start,`${prefix}-5-FIELDS`,'Worker name, Provider, Model, Role, Task, State, Runtime, Repository, Worktree, Verify, Health and heartbeat/cancel state; unverifiable status is UNKNOWN.','0009');
      if(number===6)add(name,start,`${prefix}-6-TIMELINE`,'Run timeline events are chronological; clicking an event opens its evidence.','0009');
      if(number===7)add(name,start,`${prefix}-7-DIFF`,body.join(' '),'0009');
      if(number===8)add(name,start,`${prefix}-8-REVIEW`,'Review view shows six structured dimensions and result.','0009');
      if(number===9)add(name,start,`${prefix}-9-GITHUB`,body.join(' '),'0009');
      if(number===10)add(name,start,`${prefix}-10-EVENT`,'Every UI event maps to an immutable Harness event.','0009');
      if(number===11)add(name,start,`${prefix}-11-NOTIFY`,body.join(' '),'0009');
    }else{
      if(number===2)add(name,start,`${prefix}-2-CARD`,'Command Card aecp.task/v1 schema, read-only capabilities, validation rules and permissions.');
      if(number===4)add(name,start,`${prefix}-4-CONTEXT`,'Context Capsule aecp.context/v1 schema and bounded content.');
      if(number===5)add(name,start,`${prefix}-5-RESULT`,'Result Capsule aecp.result/v1 schema, no secrets or huge raw logs.');
      if(number===6)add(name,start,`${prefix}-6-TRACE`,'Execution Trace aecp.trace/v1 event schema.');
      if(number===7)add(name,start,`${prefix}-7-CLIPBOARD`,'Explicit clipboard framing and invalid card rejection.');
      if(number===8)for(let i=start+1;i<end;i++)if(/^- /.test(lines[i]))add(name,i,`${prefix}-8-L${i+1}`,lines[i]);
    }
  }
}
const explicit=['01_UX_UI_SPEC.md','02_LOCAL_AGENT_HARNESS.md','03_PROVIDER_ROUTER.md','04_SECURITY_AND_POLICY.md','05_GITHUB_MULTI_REPO.md','14_GUIDED_UX_AND_GOAL_LOOP.md','15_SELF_EVOLUTION_PRIVATE_UPDATE_AGENT_INTEROP.md','16_CONSTRAINT_RESOLUTION_DISTRIBUTION_EXECUTION_MODES.md'];
for(const name of explicit){
  const lines=read(name),prefix=`B${name.slice(0,2)}`;
  lines.forEach((line,i)=>{
    if(/^\s*(?:#|\||```|~~~)/.test(line)||!/(?:\bmust\b|\bshall\b|\bnever\b|\brequired\b|必須|不得)/i.test(line))return;
    if(/(?:No architecture knowledge is required|No GitHub credentials required|maximum compatibility is required|required permission is unavailable|not required for the current security boundary|not required unless a later work order|is not required)/i.test(line))return;
    add(name,i,`${prefix}-L${i+1}`,line);
  });
}
const a11='11_TASK_PROTOCOL.md';read(a11).forEach((line,i)=>{
  if(/^(?:- |Result Capsule|Each action|Do not)/.test(line)&&/(?:\bmust\b|\bnever\b|\brequired\b)/i.test(line))add(a11,i,`B11-L${i+1}`,line);
});
const a01='01_UX_UI_SPEC.md',lines01=read(a01);let aStart=lines01.indexOf('## 10. Accessibility and quality');
for(let i=aStart+1;i<lines01.length&&!/^## /.test(lines01[i]);i++)if(/^- /.test(lines01[i]))add(a01,i,`B01-A11Y-L${i+1}`,lines01[i]);
const a04='04_SECURITY_AND_POLICY.md',lines04=read(a04);
for(const [startTitle,endTitle,tag] of [
  ['## 3. Electron baseline','## 4. Risk classes','ELECTRON'],
  ['### RED','## 5. Policy as code','RED']
]){
  const start=lines04.indexOf(startTitle),end=lines04.indexOf(endTitle);
  for(let i=start+1;i<end;i++)if(/^- /.test(lines04[i]))add(a04,i,`B04-${tag}-L${i+1}`,lines04[i]);
}
const a20='20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md',lines20=read(a20);
for(const [title,id,text,order] of [
  ['### Repository as agent memory','B20-14-MEMORY','Durable repository knowledge lives in Blueprint, AGENTS.md, docs, architecture rules, verification commands and decision records.','0008'],
  ['## 15. AGENTS.md strategy','B20-15-AGENTS','Use layered AGENTS.md discovery rather than giant prompt injection.','0008'],
  ['## 16. Dashboard as engineering cockpit','B20-16-OVERVIEW','Live project progress shows Planning, Implementation, Testing, Review and Acceptance percentages from canonical state.','0009']
])add(a20,lines20.indexOf(title),id,text,order);
const a14='14_GUIDED_UX_AND_GOAL_LOOP.md',lines14=read(a14),reqStart=lines14.indexOf('### 5.2 Required fields');
if(reqStart>=0){let end=lines14.findIndex((l,i)=>i>reqStart&&/^###? /.test(l));if(end<0)end=lines14.length;
  for(let i=reqStart+1;i<end;i++)if(/^- /.test(lines14[i]))add(a14,i,`B14-REQUIRED-L${i+1}`,lines14[i]);}
const a12='12_DATA_MODEL.md',lines12=read(a12),migrationLine=lines12.findIndex(l=>l.startsWith('Every persisted document includes `schemaVersion`'));
if(migrationLine<0)throw Error('Blueprint/12 schemaVersion clause missing');
add(a12,migrationLine,'B12-L134',lines12[migrationLine]);
// Known gaps from independent source/code audit, not inferred from a filename.
const orders={
  'B20-27-06':'0007','B20-27-07':'0007','B20-27-19':'0008',
  'B22-16-05':'0009','B22-16-06':'0009','B22-16-08':'0009',
  'B21-10-01':'0007','B21-10-02':'0007','B21-10-07':'0007','R8.6':'0009'
};
for(const item of items)if(orders[item.id])item.workOrder=orders[item.id];
const schemaGap=items.find(item=>item.id==='B12-L134');
schemaGap.status='PARTIAL';schemaGap.evidence=[
  {file:'electron/lib/state-migration.cjs',kind:'code',name:'schemaVersion'},
  {file:'electron/lib/event-ledger.cjs',kind:'code',name:'schema'}
];
schemaGap.note='New gap beyond GAP_REGISTER: state migration uses schemaVersion, but persisted event ledger records use schema without schemaVersion. Equivalence and migration coverage need owner decision; no change in this work order.';
// Only direct, named, existing tests are credited. These are review candidates,
// not claims that a similarly named source file by itself proves behavior.
const proven={
  'R1.3':['tests/security-recovery-matrix.test.cjs','policy rejects lexical traversal and sibling-prefix escapes'],
  'R1.5':['tests/security-recovery-matrix.test.cjs','adapter security matrix has an explicit decision for every capability'],
  'R2.5':['tests/harness-bounds.test.cjs','Harness enforces failed-attempt budget outside the model'],
  'R3.4':['tests/provider-router.test.cjs','Ollama without a model is rejected instead of silently selecting one'],
  'R3.8':['tests/provider-router.test.cjs','isolated Codex worker command uses its dedicated CODEX_HOME environment'],
  'R4.2':['tests/lock-manager.test.cjs','concurrent acquisition of one key has exactly one task owner'],
  'R5.3':['tests/event-projection.test.cjs','event projection materializes run task approval and type counters deterministically'],
  'B18-13-01':['tests/autonomy.test.cjs','validates bounded autonomy spec'],
  'B18-13-02':['tests/autonomy.test.cjs','OpenCode v1 invocation carries deny-first inline policy'],
  'B18-13-03':['tests/autonomy.test.cjs','Codex invocation uses workspace-write sandbox and disables network'],
  'B18-13-04':['tests/autonomy.test.cjs','dirty source repository blocks bounded autonomy before Worker execution'],
  'B18-13-05':['tests/autonomy.test.cjs','bounded runner isolates writes in worktree then applies only after explicit apply call'],
  'B18-13-06':['tests/autonomy.test.cjs','bounded runner isolates writes in worktree then applies only after explicit apply call'],
  'B18-13-07':['tests/autonomy.test.cjs','failed verification triggers another bounded iteration and can then pass'],
  'B18-13-08':['tests/autonomy.test.cjs','max iteration limit terminates repeated verification failure as BUDGET_EXHAUSTED'],
  'B18-13-09':['tests/autonomy.test.cjs','cancellation aborts bounded autonomy instead of continuing another iteration'],
  'B18-13-10':['tests/autonomy.test.cjs','bounded runner isolates writes in worktree then applies only after explicit apply call'],
  'B18-13-11':['tests/autonomy.test.cjs','Apply refuses a verified patch after source HEAD changes'],
  'B18-13-12':['tests/autonomy.test.cjs','bounded runner isolates writes in worktree then applies only after explicit apply call'],
  'B20-27-09':['tests/lock-manager.test.cjs','concurrent acquisition of one key has exactly one task owner'],
  'B20-27-13':['tests/harness-bounds.test.cjs','Harness enforces failed-attempt budget outside the model'],
  'B20-27-06':['tests/review-context.test.cjs','Reviewer input includes bounded redacted Blueprint full Plan actual diff and verification evidence'],
  'B20-27-07':['tests/review-report.test.cjs','FAIL dimension contradicting PASS becomes REWORK'],
  'B21-6-SCHEMA':['tests/worker-report.test.cjs','Worker Report changed files come from Git, never Builder claims'],
  'B21-7-SCHEMA':['tests/review-report.test.cjs','Review Report accepts a complete correlated six-dimension PASS only with verifier PASS'],
  'B21-10-01':['tests/review-report.test.cjs','Review Report accepts a complete correlated six-dimension PASS only with verifier PASS'],
  'B21-10-02':['tests/review-report.test.cjs','Review Report accepts a complete correlated six-dimension PASS only with verifier PASS'],
  'B21-10-04':['tests/review-context.test.cjs','Reviewer input includes bounded redacted Blueprint full Plan actual diff and verification evidence'],
  'B21-10-07':['tests/worker-report.test.cjs','Worker Report changed files come from Git, never Builder claims'],
  'B20-14-MEMORY':['tests/repo-knowledge.test.cjs','repo knowledge discovers layered AGENTS, blueprint entry, scripts and decision names'],
  'B20-15-AGENTS':['tests/repo-knowledge.test.cjs','repo knowledge discovers layered AGENTS, blueprint entry, scripts and decision names'],
  'B20-27-19':['tests/harness-bounds.test.cjs','Harness gives user context priority, routes knowledge by provider capability and stores content-free manifest'],
  'B20-27-11':['tests/dashboard-acceptance.test.cjs','Command Center answers the eight Blueprint 22 novice questions from canonical state'],
  'B20-16-OVERVIEW':['tests/event-projection.test.cjs','five-phase progress has deterministic empty, complete, partial-failure and no-mission boundaries'],
  'B22-5-FIELDS':['tests/dashboard-acceptance.test.cjs','Command Center projects canonical Multi-Worker identity, health and isolated cancellation controls'],
  'B22-6-TIMELINE':['tests/event-projection.test.cjs','timeline maps immutable event IDs to bounded evidence and remains read-only'],
  'B22-7-DIFF':['tests/event-projection.test.cjs','Diff projection shows canonical stats or UNKNOWN without changing task state'],
  'B22-8-REVIEW':['tests/event-projection.test.cjs','Review projection shows six canonical dimensions, human gate and UNKNOWN'],
  'B22-9-GITHUB':['tests/event-projection.test.cjs','GitHub projection shows existing delivery/CI data and UNKNOWN for missing fields'],
  'B22-10-EVENT':['tests/event-projection.test.cjs','timeline maps immutable event IDs to bounded evidence and remains read-only'],
  'B22-11-NOTIFY':['tests/notification-catalog.test.cjs','real CI, task, approval and policy event names project to their required categories'],
  'R8.6':['tests/dashboard-acceptance.test.cjs','Command Center projects canonical Multi-Worker identity, health and isolated cancellation controls'],
  'B22-16-01':['tests/dashboard-acceptance.test.cjs','Command Center answers the eight Blueprint 22 novice questions from canonical state'],
  'B01-A11Y-L173':['tests/i18n-accessibility.test.cjs','styles provide visible focus and reduced-motion support'],
  'B01-A11Y-L175':['tests/i18n-accessibility.test.cjs','Dashboard and shell accessibility provide keyboard focus text status and reduced motion'],
  'B11-2-CARD':['tests/protocol.test.cjs','rejects unsupported schema']
};
for(let number=2;number<=8;number++)proven[`B22-16-${String(number).padStart(2,'0')}`]=
  ['tests/dashboard-acceptance.test.cjs','Command Center answers the eight Blueprint 22 novice questions from canonical state'];
for(const item of items){
  const match=proven[item.id];if(!match)continue;
  const file=path.join(root,match[0]);
  if(!fs.existsSync(file)||!fs.readFileSync(file,'utf8').includes(`test('${match[1]}'`))continue;
  item.status='IMPLEMENTED';item.evidence=[{file:match[0],kind:'test',name:match[1]}];delete item.workOrder;
  item.note='Named deterministic test exists; mapped for manual equivalence review.';
}
const sharedGroups=[
  ['B18-13-05','B18-13-06','B18-13-10','B18-13-12'],
  ['B20-27-11',...Array.from({length:8},(_,i)=>`B22-16-${String(i+1).padStart(2,'0')}`)]
];
for(const group of sharedGroups)for(const id of group){
  const item=items.find(x=>x.id===id);
  if(item?.evidence?.[0]?.kind==='test')item.evidence[0].covers=group;
}
items.sort((a,b)=>a.id.localeCompare(b.id));
fs.writeFileSync(path.join(root,'.ai','TRACEABILITY.json'),JSON.stringify({schema:'aecp.traceability/v2',generatedFrom:'Blueprint normative text; manually reviewed evidence statuses',items},null,2)+'\n');
process.stdout.write(`${items.length} clauses extracted\n`);
