'use strict';
(() => {
let snapshot={runs:[],tasks:[],agents:[],workers:[],approvals:[],locks:[]},events=[],remoteDevices=[],pairing=null;
let selectedTaskId=null,selectedEventId=null;
const tr=(key,fallback)=>window.AECPI18N?.t(key,fallback)||fallback;
const esc=v=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const fmt=d=>d?new Date(d).toLocaleString():'—';
const elapsed=d=>{if(!d)return'—';const ms=Math.max(0,Date.now()-new Date(d).getTime()),s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);return h?`${h}h ${m%60}m`:m?`${m}m ${s%60}s`:`${s}s`;};
const cls=s=>['DONE','PASS','READY','APPROVED'].includes(s)?'ready':['FAILED','BLOCKED','BUDGET_EXHAUSTED','CANCELLED','REJECTED'].includes(s)?'bad':['HUMAN_REQUIRED','WAITING','PAUSED'].includes(s)?'warn':'neutral';
const sig=(value,good=[],warn=[])=>({text:value??'UNKNOWN',cls:good.includes(value)?'ready':warn.includes(value)?'warn':value==='UNKNOWN'?'neutral':'bad'});
const latestBy=(items,key='updatedAt')=>(items||[]).slice().sort((a,b)=>String(b?.[key]||'').localeCompare(String(a?.[key]||'')))[0]||null;
function taskAgent(task,run){
  if(task?.worker?.name)return task.worker.name;
  if(task?.workerId)return task.workerId;
  if(!run)return'UNKNOWN';
  if(task?.phase==='VERIFYING')return'Deterministic verifier';
  if(task?.phase==='CI_RECOVERY'||task?.ci?.state==='RUNNING')return'GitHub CI';
  if(task?.state==='REVIEWING'||task?.phase==='REVIEWING')return run.providers?.reviewer||'UNKNOWN';
  if(['RUNNING','QUEUED','REWORK'].includes(task?.state)||task?.phase==='EXECUTING')return run.providers?.builder||'UNKNOWN';
  return'NONE';
}
function taskTest(task){
  const inner=task?.result?.tasks?.at?.(-1)||task?.result?.tasks?.[task?.result?.tasks?.length-1];
  if(inner?.verification?.passed===true)return'PASS';
  if(inner?.verification?.passed===false)return'FAIL';
  if(task?.ci?.state)return'CI '+task.ci.state;
  return'UNKNOWN';
}
function taskChanged(task){
  const files=task?.result?.patch?.changedFiles;
  if(Array.isArray(files))return files.length?files.join(', '):'No changed files';
  return'UNKNOWN';
}
function taskNeedsMe(task,approvals){
  const approval=(approvals||[]).find(a=>a.taskId===task.id&&a.state==='WAITING');
  if(approval)return'YES · '+String(approval.reason||'approval required');
  return task.state==='HUMAN_REQUIRED'?'YES · approval required':'NO';
}
function taskNext(task){
  if(task.state==='DONE')return task.delivery?.state==='DRAFT'?'Review CI / human merge gate':'Done';
  if(task.state==='BUDGET_EXHAUSTED')return'Review evidence / adjust budget or goal';
  if(task.state==='BLOCKED'||task.state==='FAILED')return'Review evidence / recovery';
  if(task.state==='HUMAN_REQUIRED')return'Human approval';
  if(task.state==='QUEUED')return'Wait for scheduler';
  if(task.state==='REVIEWING')return task.ci?'Wait for CI':'Reviewer decision';
  return'Continue bounded execution';
}
async function refresh(){try{[snapshot,events,remoteDevices]=await Promise.all([window.aecp.getControlPlaneStatus(),window.aecp.getControlPlaneEvents(300),window.aecp.listRemoteDevices()]);if(document.body.dataset.aecpCommand==='1')render();}catch{}}
function render(){
 const host=document.querySelector('#controlContent');if(!host||document.body.dataset.aecpCommand!=='1')return;
 const runs=snapshot.runs||[],tasks=snapshot.tasks||[],workers=snapshot.workers||[],apps=snapshot.approvals||[],running=runs.filter(x=>x.state==='RUNNING').length,queued=tasks.filter(x=>x.state==='QUEUED').length,waiting=apps.filter(x=>x.state==='WAITING').length,done=tasks.filter(x=>x.state==='DONE').length,total=tasks.length,pct=total?Math.round(done*100/total):0;
 let h='';
 h+='<div class="hc-shell"><div class="hc-toolbar"><div><span class="eyebrow">HARNESS COMMAND CENTER</span><h1>AI Engineering Team Control Plane</h1><p>Durable queue · scheduler · leases · recovery · approvals · event journal · multi-worker execution</p></div><div class="hc-toolbar-actions"><button class="secondary-button" id="hcRefresh">Refresh</button><button class="primary-button" id="hcEmergency">STOP ALL</button></div></div>';
 const cpSignal=sig(snapshot.schema==='aecp.control-plane/v1'?'READY':'UNKNOWN',['READY']);
 const activeRun=runs.find(r=>['RUNNING','QUEUED','PAUSED','HUMAN_REQUIRED'].includes(r.state));
 const loopSignal=sig(snapshot.schema!=='aecp.control-plane/v1'?'UNKNOWN':(activeRun?'ACTIVE':'IDLE'),['ACTIVE','IDLE']);
 const latestCi=latestBy(tasks.filter(t=>t.ci),'updatedAt');
 const ciValue=latestCi?.ci?.state||'UNKNOWN';
 const ciSignal=sig(ciValue,['PASSED'],['WAITING','RUNNING']);
 const governanceValue=snapshot.adapterSecurity?.ok===true?(waiting?'ACTION REQUIRED':'READY'):snapshot.adapterSecurity?.ok===false?'BLOCKED':'UNKNOWN';
 const governanceSignal=sig(governanceValue,['READY'],['ACTION REQUIRED']);
 const repoCount=Object.keys(snapshot.resources?.repositories||{}).length;
 const repoValue=snapshot.resources?.schema==='aecp.resources/v1'?String(repoCount)+' REPOS':'UNKNOWN';
 const repoSignal=sig(repoValue,[repoValue],[]);
 const remoteInfo=snapshot.remote;
 const remoteValue=!remoteInfo?'UNKNOWN':remoteInfo.enabled?(remoteInfo.secure?'SECURE':'INSECURE'):'LOCAL ONLY';
 const remoteSignal=sig(remoteValue,['SECURE','LOCAL ONLY'],['INSECURE']);
 h+='<section class="hc-card hc-status-card"><div class="section-title"><h2>Runtime Signals</h2><span class="status '+cpSignal.cls+'">'+esc(cpSignal.text)+'</span></div><div class="hc-status-grid">'
   +'<div><b>CORE CONTROL PLANE</b><span class="status '+cpSignal.cls+'">'+esc(cpSignal.text)+'</span><small>Canonical mission/task snapshot</small></div>'
   +'<div><b>AI LOOP</b><span class="status '+loopSignal.cls+'">'+esc(loopSignal.text)+'</span><small>'+esc(activeRun?.id||'No active mission')+'</small></div>'
   +'<div><b>GITHUB / CI</b><span class="status '+ciSignal.cls+'">'+esc(ciSignal.text)+'</span><small>'+esc(latestCi?.delivery?.sha||'No CI evidence yet')+'</small></div>'
   +'<div><b>GOVERNANCE</b><span class="status '+governanceSignal.cls+'">'+esc(governanceSignal.text)+'</span><small>Adapter audit + approval queue</small></div>'
   +'<div><b>MULTI-REPO</b><span class="status '+repoSignal.cls+'">'+esc(repoSignal.text)+'</span><small>Canonical resource graph</small></div>'
   +'<div><b>REMOTE</b><span class="status '+remoteSignal.cls+'">'+esc(remoteSignal.text)+'</span><small>Authenticated supervision status</small></div>'
   +'</div><div class="hc-pending"><strong>Rule:</strong> runtime signals come from canonical state/evidence. If AECP cannot verify a condition, this dashboard shows UNKNOWN instead of a green status.</div></section>';
 const officialWorker=workers.find(w=>w.id==='codex-official')||null;
 const pegaWorker=workers.find(w=>w.id==='codex-pega')||null;
 const registryReady=Boolean(officialWorker&&pegaWorker);
 const homesKnown=Boolean(officialWorker?.codexHome&&pegaWorker?.codexHome);
 const homesIsolated=homesKnown&&String(officialWorker.codexHome).toLowerCase()!==String(pegaWorker.codexHome).toLowerCase();
 const bothRunning=officialWorker?.runtimeState==='RUNNING'&&pegaWorker?.runtimeState==='RUNNING';
 const parallelWorktreesKnown=Boolean(officialWorker?.worktree&&pegaWorker?.worktree);
 const parallelWorktreesIsolated=parallelWorktreesKnown&&String(officialWorker.worktree).toLowerCase()!==String(pegaWorker.worktree).toLowerCase();
 const registryValue=registryReady?'READY':'INCOMPLETE';
 const isolationValue=!homesKnown?'UNKNOWN':homesIsolated?'PASS':'BLOCKED';
 const parallelValue=!bothRunning?'IDLE':!parallelWorktreesKnown?'UNKNOWN':parallelWorktreesIsolated?'ACTIVE':'BLOCKED';
 const officialHealth=officialWorker?.health||'UNKNOWN';
 const pegaHealth=pegaWorker?.health||'UNKNOWN';
 const healthClass=value=>value==='READY'?'ready':['DEGRADED','AUTH_REQUIRED'].includes(value)?'warn':['UNKNOWN','NOT_CONFIGURED'].includes(value)?'neutral':'bad';
 h+='<section class="hc-card hc-status-card"><div class="section-title"><h2>V3.0 Multi-Worker Readiness</h2><span class="status '+(registryReady&&homesIsolated?'ready':'warn')+'">'+(registryReady&&homesIsolated?'REPOSITORY READY':'CHECK REQUIRED')+'</span></div><div class="hc-status-grid">'
   +'<div><b>WORKER REGISTRY</b><span class="status '+(registryReady?'ready':'warn')+'">'+esc(registryValue)+'</span><small>Codex OFFICIAL + Codex PEGA canonical Worker identities</small></div>'
   +'<div><b>CODEX_HOME ISOLATION</b><span class="status '+(isolationValue==='PASS'?'ready':isolationValue==='BLOCKED'?'bad':'neutral')+'">'+esc(isolationValue)+'</span><small>Independent config/auth/session/runtime roots</small></div>'
   +'<div><b>PARALLEL RUNTIME</b><span class="status '+(parallelValue==='ACTIVE'?'ready':parallelValue==='BLOCKED'?'bad':'neutral')+'">'+esc(parallelValue)+'</span><small>ACTIVE only when both Workers are running on distinct worktrees</small></div>'
   +'<div><b>OFFICIAL HEALTH</b><span class="status '+healthClass(officialHealth)+'">'+esc(officialHealth)+'</span><small>'+esc(officialWorker?.healthDetail||'Canonical Worker health')+'</small></div>'
   +'<div><b>PEGA HEALTH</b><span class="status '+healthClass(pegaHealth)+'">'+esc(pegaHealth)+'</span><small>'+esc(pegaWorker?.healthDetail||'Canonical Worker health')+'</small></div>'
   +'<div><b>REAL PROVIDER EVIDENCE</b><span class="status warn">ENVIRONMENT GATE</span><small>Requires exact-source self-hosted Windows evidence; never inferred from source tests or health alone.</small></div>'
   +'</div><div class="hc-pending"><strong>V3.0 rule:</strong> repository implementation and CI can prove architecture/runtime invariants, but real OFFICIAL/PEGA model execution remains an ENVIRONMENT gate until the dedicated evidence workflow produces a matching artifact.</div></section>';
 const projected=snapshot.eventProjection?.total||events.length;
 h+='<div class="hc-metrics"><div><strong>'+running+'</strong><span>RUNNING</span></div><div><strong>'+queued+'</strong><span>QUEUED</span></div><div><strong>'+waiting+'</strong><span>APPROVAL</span></div><div><strong>'+done+'/'+total+'</strong><span>TASKS DONE</span></div><div><strong>'+pct+'%</strong><span>PROGRESS</span></div><div><strong>'+projected+'</strong><span>JOURNALED EVENTS</span></div></div>';
 h+='<section class="hc-card"><div class="section-title"><h2>Worker Runtime</h2><span class="count-badge">'+workers.length+'</span></div><div class="hc-task-grid">'
   +(workers.map(w=>{const health=w.health||'UNKNOWN',healthClass=health==='READY'?'ready':['DEGRADED','AUTH_REQUIRED'].includes(health)?'warn':health==='UNKNOWN'?'neutral':'bad';return '<article class="hc-task hc-worker"><div class="hc-task-head"><strong>'+esc(w.name||w.id)+'</strong><span class="status '+cls(w.runtimeState)+'">'+esc(w.runtimeState||'UNKNOWN')+'</span></div>'
    +'<small>Worker: '+esc(w.id||'UNKNOWN')+'</small>'
    +'<small>Provider: '+esc(w.providerName||w.providerId||'UNKNOWN')+'</small>'
    +'<small>Model: '+esc(w.model||'UNKNOWN')+'</small>'
    +'<small>Role: '+esc(w.role||'UNKNOWN')+'</small>'
    +'<small>Task: '+esc(w.taskId||'—')+'</small>'
    +'<small>Runtime: '+esc(elapsed(w.startedAt))+'</small>'
    +'<small>Worktree: '+esc(w.worktree||'—')+'</small>'
    +'<small>Verify: '+esc(w.verificationState||'UNKNOWN')+'</small>'
    +'<small>Heartbeat: '+esc(fmt(w.heartbeatAt))+'</small>'
    +'<small>Cancel: '+esc(w.cancelState||'—')+'</small>'
    +'<span class="status '+healthClass+'">Health '+esc(health)+'</span>'
    +(w.healthDetail?'<small>'+esc(w.healthDetail)+'</small>':'')+'</article>';}).join('')||'<div class="empty-list">No registered workers.</div>')
   +'</div></section>';
 const remote=snapshot.remote||{};
 h+='<section class="hc-card"><div class="section-title"><h2>Remote Supervision</h2><span class="status '+(remote.secure?'ready':'neutral')+'">'+esc(remote.protocol||'http')+' · '+esc(remote.host||'127.0.0.1')+':'+esc(remote.port||'—')+'</span></div><p>Read-only paired-device supervision. Non-loopback binding is disabled unless the operator explicitly enables it and supplies TLS credentials.</p><div class="hc-actions"><button id="hcPair" class="primary-button">Create pairing code</button></div>'+(pairing?'<p><strong>Pairing code: '+esc(pairing.code)+'</strong> · expires '+esc(fmt(pairing.expiresAt))+'</p>':'')+'<div class="hc-table">'+((remoteDevices||[]).map(d=>'<div class="hc-row"><div class="hc-main"><strong>'+esc(d.deviceId)+'</strong><small>'+esc(d.scope)+' · expires '+esc(fmt(d.expiresAt))+'</small></div><button class="secondary-button" data-device-revoke="'+esc(d.deviceId)+'">Revoke</button></div>').join('')||'<div class="empty-list">No paired devices.</div>')+'</div></section>';
 h+='<section class="hc-card hc-mission-create"><div class="section-title"><h2>New Mission</h2><span class="status safe">AUTONOMOUS / BOUNDED</span></div><div class="hc-form"><label>Goal<textarea id="hcGoal" rows="3" placeholder="例如：把 AECP Harness 做成可長時間自動施工、可恢復、可審計的工程控制平面。"></textarea></label><label>Definition of Done<textarea id="hcDone" rows="3" placeholder="列出完成條件、測試、CI、證據與人工批准條件。"></textarea></label>'
   +(workers.length?'<div class="hc-worker-pool"><strong>Builder Worker Pool</strong><small>Select isolated workers. No selection keeps the legacy single-builder route.</small>'+workers.filter(w=>w.role==='builder').map(w=>'<label class="hc-check"><input type="checkbox" data-builder-worker="'+esc(w.id)+'" '+((['READY','DEGRADED'].includes(w.health||'UNKNOWN'))?'checked':'')+'> '+esc(w.name||w.id)+' · '+esc(w.providerName||w.providerId||'UNKNOWN')+' · '+esc(w.health||'UNKNOWN')+'</label>').join('')+'</div>':'')
   +'<div class="hc-inline"><label>Concurrency<input id="hcConcurrency" type="number" min="1" max="8" value="2"></label><label>Max iterations<input id="hcIterations" type="number" min="1" max="5" value="5"></label><label>Max tasks<input id="hcTasks" type="number" min="1" max="8" value="8"></label><label>Max provider calls<input id="hcTurns" type="number" min="1" max="200" value="40"></label><label>Max failed attempts<input id="hcFailures" type="number" min="1" max="20" value="20"></label><label>Max changed files<input id="hcChangedFiles" type="number" min="1" max="1000" value="100"></label><label>Max patch MiB<input id="hcPatchMiB" type="number" min="1" max="64" value="8"></label><label>Wall-clock minutes<input id="hcWallMinutes" type="number" min="1" max="1440" value="120"></label><label>Provider-reported cost<input id="hcProviderCost" type="number" min="0.000001" step="0.000001" placeholder="optional"></label><label>Local compute minutes<input id="hcLocalComputeMinutes" type="number" min="1" max="1440" placeholder="optional"></label><label class="hc-check"><input id="hcDelivery" type="checkbox"> Governed GitHub draft PR</label><button class="primary-button hc-create" id="hcCreate">START MISSION</button></div></div></section>';
 h+='<div class="hc-grid"><section class="hc-card"><div class="section-title"><h2>Mission Queue</h2><span class="count-badge">'+runs.length+'</span></div><div class="hc-table">';
 h+=runs.length?runs.map(r=>{let a='';if(r.state==='PAUSED')a+='<button data-start="'+esc(r.id)+'" class="secondary-button">Resume</button>';if(['QUEUED','RUNNING','PAUSED','HUMAN_REQUIRED'].includes(r.state))a+='<button data-pause="'+esc(r.id)+'" class="secondary-button">Pause</button>';if(!['DONE','BLOCKED','BUDGET_EXHAUSTED','FAILED','CANCELLED'].includes(r.state))a+='<button data-cancel="'+esc(r.id)+'" class="secondary-button">Cancel</button>';return '<div class="hc-row"><div class="hc-main"><strong>'+esc(r.goal)+'</strong><small>'+esc(r.id)+' · '+fmt(r.createdAt)+'</small><small>Project: '+esc(r.sourceRoot||'UNKNOWN')+'</small><small>Next: '+esc(r.state==='PAUSED'?'Explicit Resume required':r.state==='HUMAN_REQUIRED'?'Human approval':r.state==='DONE'?'Done':r.state==='BUDGET_EXHAUSTED'?'Review evidence / adjust budget or goal':'Continue bounded scheduler')+'</small></div><span class="status '+cls(r.state)+'">'+esc(r.state)+'</span><div class="hc-actions">'+a+'</div></div>';}).join(''):'<div class="empty-list">No missions yet.</div>';
 h+='</div></section><section class="hc-card"><div class="section-title"><h2>Approval Queue</h2><span class="count-badge">'+waiting+'</span></div><div class="hc-table">';
 h+=apps.filter(a=>a.state==='WAITING').map(a=>'<div class="hc-row hc-approval"><div class="hc-main"><strong>'+esc(a.reason)+'</strong><small>'+esc(a.taskId)+' · Risk '+esc(a.risk)+' · '+fmt(a.createdAt)+'</small></div><div class="hc-actions"><button data-approve="'+esc(a.id)+'" class="primary-button">Approve</button><button data-reject="'+esc(a.id)+'" class="secondary-button">Reject</button></div></div>').join('')||'<div class="empty-list">No human approvals waiting.</div>';
 h+='</div></section></div><section class="hc-card"><div class="section-title"><h2>Task Board</h2><span class="count-badge">'+tasks.length+'</span></div><div class="hc-task-grid">';
 const runById=Object.fromEntries(runs.map(r=>[r.id,r]));
 h+=tasks.map(t=>{const run=runById[t.runId];return '<article class="hc-task"><div class="hc-task-head"><strong>'+esc(t.title)+'</strong><span class="status '+cls(t.state)+'">'+esc(t.state||'UNKNOWN')+'</span></div><p>'+esc(t.objective||t.acceptance||'')+'</p><small>'+esc(t.id)+' · attempt '+(t.attempts||0)+' · heartbeat '+fmt(t.heartbeatAt||t.updatedAt)+'</small><small>Agent: '+esc(taskAgent(t,run))+'</small><small>Verifier/Test: '+esc(taskTest(t))+'</small><small>Changed: '+esc(taskChanged(t))+'</small><small>Needs me: '+esc(taskNeedsMe(t,apps))+'</small><small>Next: '+esc(taskNext(t))+'</small>'+(t.delivery?.pr?'<div class="hc-actions"><span>PR '+esc(t.delivery.pr)+'</span>'+(t.delivery.state==='DRAFT'?'<button data-merge="1" data-run="'+esc(t.runId)+'" data-task="'+esc(t.id)+'" class="primary-button">Approve & Merge</button>':'')+'</div>':'')+(t.ci?'<small>CI: '+esc(t.ci.state||'UNKNOWN')+'</small>':'')+(!['DONE','FAILED','BLOCKED','BUDGET_EXHAUSTED','CANCELLED'].includes(t.state)?'<div class="hc-actions"><button class="secondary-button" data-cancel-task="1" data-run="'+esc(t.runId)+'" data-task="'+esc(t.id)+'">Cancel task</button></div>':'')+(t.error?'<pre>'+esc(t.error)+'</pre>':'')+'</article>';}).join('')||'<div class="empty-list">Queue is empty.</div>';
 h+='</div></section><section class="hc-card"><div class="section-title"><h2>Live Event Stream</h2><span class="status ready">JOURNALED</span></div><div class="hc-events">';
 h+=events.slice().reverse().slice(0,120).map(e=>'<div class="hc-event"><time>'+esc(fmt(e.at))+'</time><b>'+esc(e.type)+'</b><span>'+esc(e.runId||'')+'</span><span>'+esc(e.taskId||'')+'</span></div>').join('')||'<div class="empty-list">No events yet.</div>';
 h+='</div></section></div>';
 const focusTask=tasks.find(t=>t.id===selectedTaskId)||latestBy(tasks)||null;
 const timeline=window.AECPDashboard.timeline(events,focusTask?.id);
 const selectedEvent=timeline.entries.find(e=>e.id===selectedEventId)||null;
 h+='<section class="hc-card" id="hcTimeline"><div class="section-title"><h2>'+esc(tr('dashboard.timeline','Run timeline'))+'</h2><span class="status neutral">'+esc(focusTask?.id||'UNKNOWN')+'</span></div>';
 h+='<div class="hc-actions" role="group" aria-label="'+esc(tr('dashboard.selectTask','Select task'))+'">'+tasks.map(t=>'<button type="button" class="secondary-button" data-select-task="'+esc(t.id)+'" aria-pressed="'+String(focusTask?.id===t.id)+'">'+esc(t.title||t.id)+'</button>').join('')+'</div>';
 h+='<div class="hc-events">'+(timeline.entries.map(e=>'<button type="button" class="hc-event hc-event-button" data-event-id="'+esc(e.id)+'" aria-label="'+esc(tr('dashboard.openEvidence','Open event evidence'))+' '+esc(e.type)+'"><time>'+esc(fmt(e.at))+'</time><b>'+esc(e.type)+'</b><span>ID '+esc(e.id)+'</span></button>').join('')||'<div class="empty-list">UNKNOWN · '+esc(tr('dashboard.noTimeline','No verified timeline'))+'</div>')+'</div>';
 h+='<div class="hc-event-evidence" role="region" aria-live="polite" aria-label="'+esc(tr('dashboard.evidence','Event evidence'))+'">'+(selectedEvent?'<strong>'+esc(tr('dashboard.evidence','Event evidence'))+'</strong><small>ID '+esc(selectedEvent.id)+'</small><small>'+esc(tr('dashboard.path','Path'))+': '+esc(selectedEvent.evidence.path)+'</small><small>SHA-256: '+esc(selectedEvent.evidence.sha256)+'</small><small>'+esc(tr('dashboard.summary','Summary'))+': '+esc(selectedEvent.evidence.summary)+'</small>':'UNKNOWN')+'</div></section>';
 host.innerHTML=h;
 document.querySelectorAll('[data-select-task]').forEach(b=>b.onclick=()=>{selectedTaskId=b.dataset.selectTask;selectedEventId=null;render();});
 document.querySelectorAll('[data-event-id]').forEach(b=>b.onclick=()=>{selectedEventId=b.dataset.eventId;render();});
 document.querySelector('#hcRefresh')?.addEventListener('click',refresh);
 document.querySelector('#hcPair')?.addEventListener('click',async()=>{pairing=await window.aecp.createRemotePairing();render();});
 document.querySelectorAll('[data-device-revoke]').forEach(b=>b.onclick=async()=>{if(!confirm('Revoke this paired device?'))return;await window.aecp.revokeRemoteDevice(b.dataset.deviceRevoke);pairing=null;await refresh();});
 document.querySelector('#hcEmergency')?.addEventListener('click',async()=>{if(!confirm('STOP ALL will cancel every active mission. Continue?'))return;for(const r of runs.filter(x=>['QUEUED','RUNNING','PAUSED','HUMAN_REQUIRED'].includes(x.state)))await window.aecp.cancelMission(r.id);await refresh();});
 document.querySelector('#hcCreate')?.addEventListener('click',async()=>{const goal=document.querySelector('#hcGoal').value.trim(),done=document.querySelector('#hcDone').value.trim();if(!goal||!done){alert('Goal and Definition of Done are required.');return;}const builderWorkers=[...document.querySelectorAll('[data-builder-worker]:checked')].map(x=>x.dataset.builderWorker);await window.aecp.createMission({goal,done,builderWorkers,maxConcurrency:Number(document.querySelector('#hcConcurrency').value),maxIterations:Number(document.querySelector('#hcIterations').value),maxTasks:Number(document.querySelector('#hcTasks').value),maxTurns:Number(document.querySelector('#hcTurns').value),maxFailedAttempts:Number(document.querySelector('#hcFailures').value),maxChangedFiles:Number(document.querySelector('#hcChangedFiles').value),maxPatchBytes:Number(document.querySelector('#hcPatchMiB').value)*1024*1024,maxWallClockMs:Number(document.querySelector('#hcWallMinutes').value)*60*1000,maxProviderReportedCost:Number(document.querySelector('#hcProviderCost').value)||null,maxLocalComputeMs:(Number(document.querySelector('#hcLocalComputeMinutes').value)||0)*60*1000||null,delivery:document.querySelector('#hcDelivery').checked,autoStart:true});await refresh();});
 document.querySelectorAll('[data-start]').forEach(b=>b.onclick=async()=>{await window.aecp.startMission(b.dataset.start);await refresh();});document.querySelectorAll('[data-pause]').forEach(b=>b.onclick=async()=>{await window.aecp.pauseMission(b.dataset.pause);await refresh();});document.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{await window.aecp.cancelMission(b.dataset.cancel);await refresh();});document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{await window.aecp.approveMissionAction(b.dataset.approve);await refresh();});
 document.querySelectorAll('[data-cancel-task]').forEach(b=>b.onclick=async()=>{if(!confirm('Cancel only this task? Other workers and tasks will keep running.'))return;await window.aecp.cancelTask(b.dataset.run,b.dataset.task);await refresh();});
 document.querySelectorAll('[data-merge]').forEach(b=>b.onclick=async()=>{if(!confirm('Merge this governed PR into main?'))return;await window.aecp.approveDelivery({runId:b.dataset.run,taskId:b.dataset.task,by:'human'});await refresh();});document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=async()=>{await window.aecp.rejectMissionAction(b.dataset.reject);await refresh();});
}
function activate(){document.body.dataset.aecpCommand='1';document.querySelectorAll('.view-tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='command'));const t=document.querySelector('#controlTitle');if(t)t.textContent='Harness Command Center';refresh();}
function deactivate(){document.body.dataset.aecpCommand='0';}
document.addEventListener('click',e=>{const tab=e.target.closest('.view-tab');if(tab?.dataset.view==='command')setTimeout(activate,0);else if(tab&&tab.dataset.view!=='command')deactivate();},true);
window.aecp.onControlPlaneEvent(refresh);refresh();setInterval(refresh,3000);
})();
const HARDENING_GATES = ['Failure Recovery Assistant — bounded classifier implemented','Adapter Security Audit','Clean E2E Matrix','Windows Release Gate','Authenticated Remote Pairing','Drift Scans'];
