'use strict';
(() => {
let snapshot={runs:[],tasks:[],agents:[],approvals:[],locks:[]},events=[],remoteDevices=[],pairing=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const fmt=d=>d?new Date(d).toLocaleString():'—';
const cls=s=>['DONE','PASS','READY','APPROVED'].includes(s)?'ready':['FAILED','BLOCKED','BUDGET_EXHAUSTED','CANCELLED','REJECTED'].includes(s)?'bad':['HUMAN_REQUIRED','WAITING','PAUSED'].includes(s)?'warn':'neutral';
const sig=(value,good=[],warn=[])=>({text:value??'UNKNOWN',cls:good.includes(value)?'ready':warn.includes(value)?'warn':value==='UNKNOWN'?'neutral':'bad'});
const latestBy=(items,key='updatedAt')=>(items||[]).slice().sort((a,b)=>String(b?.[key]||'').localeCompare(String(a?.[key]||'')))[0]||null;
function taskAgent(task,run){
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
 const runs=snapshot.runs||[],tasks=snapshot.tasks||[],apps=snapshot.approvals||[],running=runs.filter(x=>x.state==='RUNNING').length,queued=tasks.filter(x=>x.state==='QUEUED').length,waiting=apps.filter(x=>x.state==='WAITING').length,done=tasks.filter(x=>x.state==='DONE').length,total=tasks.length,pct=total?Math.round(done*100/total):0;
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
   +'</div><div class="hc-pending"><strong>Rule:</strong> runtime signals come from canonical state/evidence. If AECP cannot verify a condition, this dashboard shows UNKNOWN instead of a green status.</div></section>';const projected=snapshot.eventProjection?.total||events.length;
 h+='<div class="hc-metrics"><div><strong>'+running+'</strong><span>RUNNING</span></div><div><strong>'+queued+'</strong><span>QUEUED</span></div><div><strong>'+waiting+'</strong><span>APPROVAL</span></div><div><strong>'+done+'/'+total+'</strong><span>TASKS DONE</span></div><div><strong>'+pct+'%</strong><span>PROGRESS</span></div><div><strong>'+projected+'</strong><span>JOURNALED EVENTS</span></div></div>';
 const remote=snapshot.remote||{};
 h+='<section class="hc-card"><div class="section-title"><h2>Remote Supervision</h2><span class="status '+(remote.secure?'ready':'neutral')+'">'+esc(remote.protocol||'http')+' · '+esc(remote.host||'127.0.0.1')+':'+esc(remote.port||'—')+'</span></div><p>Read-only paired-device supervision. Non-loopback binding is disabled unless the operator explicitly enables it and supplies TLS credentials.</p><div class="hc-actions"><button id="hcPair" class="primary-button">Create pairing code</button></div>'+(pairing?'<p><strong>Pairing code: '+esc(pairing.code)+'</strong> · expires '+esc(fmt(pairing.expiresAt))+'</p>':'')+'<div class="hc-table">'+((remoteDevices||[]).map(d=>'<div class="hc-row"><div class="hc-main"><strong>'+esc(d.deviceId)+'</strong><small>'+esc(d.scope)+' · expires '+esc(fmt(d.expiresAt))+'</small></div><button class="secondary-button" data-device-revoke="'+esc(d.deviceId)+'">Revoke</button></div>').join('')||'<div class="empty-list">No paired devices.</div>')+'</div></section>';
 h+='<section class="hc-card hc-mission-create"><div class="section-title"><h2>New Mission</h2><span class="status safe">AUTONOMOUS / BOUNDED</span></div><div class="hc-form"><label>Goal<textarea id="hcGoal" rows="3" placeholder="例如：把 AECP Harness 做成可長時間自動施工、可恢復、可審計的工程控制平面。"></textarea></label><label>Definition of Done<textarea id="hcDone" rows="3" placeholder="列出完成條件、測試、CI、證據與人工批准條件。"></textarea></label><div class="hc-inline"><label>Concurrency<input id="hcConcurrency" type="number" min="1" max="8" value="2"></label><label>Max iterations<input id="hcIterations" type="number" min="1" max="5" value="5"></label><label>Max tasks<input id="hcTasks" type="number" min="1" max="8" value="8"></label><label class="hc-check"><input id="hcDelivery" type="checkbox"> Governed GitHub draft PR</label><button class="primary-button hc-create" id="hcCreate">START MISSION</button></div></div></section>';
 h+='<div class="hc-grid"><section class="hc-card"><div class="section-title"><h2>Mission Queue</h2><span class="count-badge">'+runs.length+'</span></div><div class="hc-table">';
 h+=runs.length?runs.map(r=>{let a='';if(r.state==='PAUSED')a+='<button data-start="'+esc(r.id)+'" class="secondary-button">Resume</button>';if(['QUEUED','RUNNING','PAUSED','HUMAN_REQUIRED'].includes(r.state))a+='<button data-pause="'+esc(r.id)+'" class="secondary-button">Pause</button>';if(!['DONE','BLOCKED','BUDGET_EXHAUSTED','FAILED','CANCELLED'].includes(r.state))a+='<button data-cancel="'+esc(r.id)+'" class="secondary-button">Cancel</button>';return '<div class="hc-row"><div class="hc-main"><strong>'+esc(r.goal)+'</strong><small>'+esc(r.id)+' · '+fmt(r.createdAt)+'</small><small>Project: '+esc(r.sourceRoot||'UNKNOWN')+'</small><small>Next: '+esc(r.state==='PAUSED'?'Explicit Resume required':r.state==='HUMAN_REQUIRED'?'Human approval':r.state==='DONE'?'Done':r.state==='BUDGET_EXHAUSTED'?'Review evidence / adjust budget or goal':'Continue bounded scheduler')+'</small></div><span class="status '+cls(r.state)+'">'+esc(r.state)+'</span><div class="hc-actions">'+a+'</div></div>';}).join(''):'<div class="empty-list">No missions yet.</div>';
 h+='</div></section><section class="hc-card"><div class="section-title"><h2>Approval Queue</h2><span class="count-badge">'+waiting+'</span></div><div class="hc-table">';
 h+=apps.filter(a=>a.state==='WAITING').map(a=>'<div class="hc-row hc-approval"><div class="hc-main"><strong>'+esc(a.reason)+'</strong><small>'+esc(a.taskId)+' · Risk '+esc(a.risk)+' · '+fmt(a.createdAt)+'</small></div><div class="hc-actions"><button data-approve="'+esc(a.id)+'" class="primary-button">Approve</button><button data-reject="'+esc(a.id)+'" class="secondary-button">Reject</button></div></div>').join('')||'<div class="empty-list">No human approvals waiting.</div>';
 h+='</div></section></div><section class="hc-card"><div class="section-title"><h2>Task Board</h2><span class="count-badge">'+tasks.length+'</span></div><div class="hc-task-grid">';
 const runById=Object.fromEntries(runs.map(r=>[r.id,r]));
 h+=tasks.map(t=>{const run=runById[t.runId];return '<article class="hc-task"><div class="hc-task-head"><strong>'+esc(t.title)+'</strong><span class="status '+cls(t.state)+'">'+esc(t.state||'UNKNOWN')+'</span></div><p>'+esc(t.objective||t.acceptance||'')+'</p><small>'+esc(t.id)+' · attempt '+(t.attempts||0)+' · heartbeat '+fmt(t.heartbeatAt||t.updatedAt)+'</small><small>Agent: '+esc(taskAgent(t,run))+'</small><small>Verifier/Test: '+esc(taskTest(t))+'</small><small>Changed: '+esc(taskChanged(t))+'</small><small>Needs me: '+esc(taskNeedsMe(t,apps))+'</small><small>Next: '+esc(taskNext(t))+'</small>'+(t.delivery?.pr?'<div class="hc-actions"><span>PR '+esc(t.delivery.pr)+'</span>'+(t.delivery.state==='DRAFT'?'<button data-merge="1" data-run="'+esc(t.runId)+'" data-task="'+esc(t.id)+'" class="primary-button">Approve & Merge</button>':'')+'</div>':'')+(t.ci?'<small>CI: '+esc(t.ci.state||'UNKNOWN')+'</small>':'')+(t.error?'<pre>'+esc(t.error)+'</pre>':'')+'</article>';}).join('')||'<div class="empty-list">Queue is empty.</div>';
 h+='</div></section><section class="hc-card"><div class="section-title"><h2>Live Event Stream</h2><span class="status ready">JOURNALED</span></div><div class="hc-events">';
 h+=events.slice().reverse().slice(0,120).map(e=>'<div class="hc-event"><time>'+esc(fmt(e.at))+'</time><b>'+esc(e.type)+'</b><span>'+esc(e.runId||'')+'</span><span>'+esc(e.taskId||'')+'</span></div>').join('')||'<div class="empty-list">No events yet.</div>';
 h+='</div></section></div>';host.innerHTML=h;
 document.querySelector('#hcRefresh')?.addEventListener('click',refresh);
 document.querySelector('#hcPair')?.addEventListener('click',async()=>{pairing=await window.aecp.createRemotePairing();render();});
 document.querySelectorAll('[data-device-revoke]').forEach(b=>b.onclick=async()=>{if(!confirm('Revoke this paired device?'))return;await window.aecp.revokeRemoteDevice(b.dataset.deviceRevoke);pairing=null;await refresh();});
 document.querySelector('#hcEmergency')?.addEventListener('click',async()=>{if(!confirm('STOP ALL will cancel every active mission. Continue?'))return;for(const r of runs.filter(x=>['QUEUED','RUNNING','PAUSED','HUMAN_REQUIRED'].includes(x.state)))await window.aecp.cancelMission(r.id);await refresh();});
 document.querySelector('#hcCreate')?.addEventListener('click',async()=>{const goal=document.querySelector('#hcGoal').value.trim(),done=document.querySelector('#hcDone').value.trim();if(!goal||!done){alert('Goal and Definition of Done are required.');return;}await window.aecp.createMission({goal,done,maxConcurrency:Number(document.querySelector('#hcConcurrency').value),maxIterations:Number(document.querySelector('#hcIterations').value),maxTasks:Number(document.querySelector('#hcTasks').value),delivery:document.querySelector('#hcDelivery').checked,autoStart:true});await refresh();});
 document.querySelectorAll('[data-start]').forEach(b=>b.onclick=async()=>{await window.aecp.startMission(b.dataset.start);await refresh();});document.querySelectorAll('[data-pause]').forEach(b=>b.onclick=async()=>{await window.aecp.pauseMission(b.dataset.pause);await refresh();});document.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{await window.aecp.cancelMission(b.dataset.cancel);await refresh();});document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{await window.aecp.approveMissionAction(b.dataset.approve);await refresh();});
 document.querySelectorAll('[data-merge]').forEach(b=>b.onclick=async()=>{if(!confirm('Merge this governed PR into main?'))return;await window.aecp.approveDelivery({runId:b.dataset.run,taskId:b.dataset.task,by:'human'});await refresh();});document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=async()=>{await window.aecp.rejectMissionAction(b.dataset.reject);await refresh();});
}
function activate(){document.body.dataset.aecpCommand='1';document.querySelectorAll('.view-tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='command'));const t=document.querySelector('#controlTitle');if(t)t.textContent='Harness Command Center';refresh();}
function deactivate(){document.body.dataset.aecpCommand='0';}
document.addEventListener('click',e=>{const tab=e.target.closest('.view-tab');if(tab?.dataset.view==='command')setTimeout(activate,0);else if(tab&&tab.dataset.view!=='command')deactivate();},true);
window.aecp.onControlPlaneEvent(refresh);refresh();setInterval(refresh,3000);
})();
const HARDENING_GATES = ['Failure Recovery Assistant — bounded classifier implemented','Adapter Security Audit','Clean E2E Matrix','Windows Release Gate','Authenticated Remote Pairing','Drift Scans'];
