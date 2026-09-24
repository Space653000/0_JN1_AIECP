'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.AECPDashboard=api;
})(typeof window!=='undefined'?window:null,function(){
  const UNKNOWN='UNKNOWN';
  function timeline(events,taskId){
    if(!taskId)return {state:UNKNOWN,entries:[]};
    const entries=(Array.isArray(events)?events:[])
      .filter(e=>e?.taskId===taskId&&typeof e.id==='string')
      .map(e=>({id:e.id,at:e.at||UNKNOWN,type:e.data?.type||e.type||UNKNOWN,runId:e.runId||UNKNOWN,
        evidence:{path:e.evidence?.file||UNKNOWN,sha256:e.evidence?.sha256||UNKNOWN,
          summary:String(e.evidence?.summary||e.data?.type||UNKNOWN).slice(0,200)}}))
      .sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.id.localeCompare(b.id));
    return {state:entries.length?'AVAILABLE':UNKNOWN,entries};
  }
  function diffView(task){
    const inner=task?.result?.tasks?.at?.(-1)||task?.result?.tasks?.[task?.result?.tasks?.length-1];
    const stats=inner?.diffStats||task?.diffStats;
    if(!stats)return {state:UNKNOWN,changedFiles:UNKNOWN,additions:UNKNOWN,deletions:UNKNOWN,untrackedFiles:UNKNOWN,
      patchBytes:UNKNOWN,baseCommit:UNKNOWN,currentCommit:UNKNOWN,verifierStatus:UNKNOWN};
    return {state:'AVAILABLE',changedFiles:stats.changedFiles||UNKNOWN,additions:stats.additions??UNKNOWN,
      deletions:stats.deletions??UNKNOWN,untrackedFiles:stats.untrackedFiles||UNKNOWN,
      patchBytes:task?.result?.patch?.bytes??stats.patchBytes??UNKNOWN,baseCommit:stats.baseCommit||UNKNOWN,
      currentCommit:stats.currentCommit||UNKNOWN,verifierStatus:stats.verifierStatus||UNKNOWN};
  }
  const REVIEW_DIMENSIONS=Object.freeze(['blueprint','plan','implementation','tests','security','architecture']);
  function reviewView(task){
    const inner=task?.result?.tasks?.at?.(-1)||task?.result?.tasks?.[task?.result?.tasks?.length-1];
    const report=inner?.review||task?.review;
    if(report?.schema!=='aecp.review/v1')return {state:UNKNOWN,result:UNKNOWN,dimensions:Object.fromEntries(REVIEW_DIMENSIONS.map(d=>[d,UNKNOWN])),findings:[],requiredChanges:[]};
    return {state:'AVAILABLE',result:report.result||UNKNOWN,originalResult:report.originalResult||null,
      dimensions:Object.fromEntries(REVIEW_DIMENSIONS.map(d=>[d,report[d]||UNKNOWN])),
      findings:Array.isArray(report.findings)?report.findings.slice(0,20):[],
      requiredChanges:Array.isArray(report.required_changes)?report.required_changes.slice(0,20):[]};
  }
  function githubView(task,events=[]){
    const delivery=task?.delivery||{},ci=task?.ci||{};
    const runs=ci.runs||ci.lastSnapshot?.runs||[];
    const recent=(Array.isArray(events)?events:[]).filter(e=>e?.taskId===task?.id).slice().sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')))[0];
    return {branch:delivery.branch||UNKNOWN,base:delivery.base||UNKNOWN,commit:delivery.sha||UNKNOWN,
      pr:delivery.pr||UNKNOWN,ciStatus:ci.state||UNKNOWN,
      workflow:runs.length?runs.map(r=>r.name).filter(Boolean).join(', ')||UNKNOWN:UNKNOWN,
      artifacts:ci.artifacts||UNKNOWN,release:delivery.release||UNKNOWN,
      lastEvent:recent?`${recent.type||UNKNOWN} · ${recent.id||UNKNOWN}`:UNKNOWN};
  }
  // Exact event catalog. A null category is an explicit decision not to notify.
  // CI polling and routine provider/maintenance events stay quiet; retries and
  // lock waits warn, while terminal failures and policy refusal stand out.
  const NOTIFICATION_RULES=Object.freeze(Object.entries({
    'approval.approved':'SUCCESS','approval.rejected':'ERROR','approval.requested':'ACTION REQUIRED',
    'ci.failed_max_iterations':'ERROR','ci.failed_rework':'ERROR','ci.passed':'SUCCESS','ci.waiting':'INFO',
    'delivery.blocked':'ERROR','delivery.ci_monitor_error':'ERROR','delivery.merged':'SUCCESS','delivery.pr_created':'INFO',
    'external.correlated':null,'external.received':null,
    'loop.checkpoint':null,'maintenance.completed':null,'maintenance.failed':'WARNING','maintenance.gc':null,
    'mission.cancelled':'ERROR','mission.created':'INFO','mission.finished':'INFO','mission.paused':'WARNING',
    'mission.planned':'INFO','mission.started':'INFO','policy.violation':'CRITICAL',
    'provider.budget':'WARNING','provider.call':null,'run.final_verification':'INFO','run.resumed':'INFO',
    'scheduler.selected':null,
    'state.blocked':'ERROR','state.budget_exhausted':'ERROR','state.cancelled':'WARNING',
    'state.done':'SUCCESS','state.failed':'ERROR','state.human_required':'WARNING',
    'state.planning':null,'state.ready':null,'state.reviewing':null,'state.rework':'WARNING',
    'state.running':null,'state.verifying':null,
    'task.accepted':'SUCCESS','task.cancel_requested':'WARNING','task.cancelled':'WARNING',
    'task.claimed':'INFO','task.event':null,'task.failed':'ERROR','task.finished':'SUCCESS',
    'task.lock_lost':'ERROR','task.paused':'WARNING','task.queued':'INFO',
    'task.recovery_rework':'WARNING','task.review_passed':'SUCCESS',
    'task.waiting_for_lock':'WARNING','task.waiting_for_worker':'WARNING'
  }).map(([type,category])=>Object.freeze({type,category})));
  function notifications(events,{readIds=[]}={}){
    const read=new Set(readIds),seen=new Set(),out=[];
    for(const event of (Array.isArray(events)?events:[]).slice().sort((a,b)=>String(b?.at||'').localeCompare(String(a?.at||'')))){
      if(!event||typeof event.id!=='string'||seen.has(event.id))continue;
      seen.add(event.id);
      const type=String(event.data?.type||event.type||'');
      if(/(?:^|\.)token(?:\.|$)/i.test(type))continue;
      const category=NOTIFICATION_RULES.find(rule=>rule.type===type)?.category;
      if(!category)continue;
      out.push({id:event.id,category,type,at:event.at||UNKNOWN,taskId:event.taskId||UNKNOWN,
        read:read.has(event.id),approvalTarget:category==='ACTION REQUIRED'?'#hcApprovals':null});
      if(out.length>=100)break;
    }
    return out;
  }
  const PROGRESS_PHASES=Object.freeze(['planning','implementation','testing','review','acceptance']);
  // For N mission tasks: Planning=100 only with durable Plan and N>0;
  // Implementation=verified patches/N; Testing=deterministic PASS/N;
  // Review=valid review PASS/N; Acceptance=DONE plus hashed evidence/N.
  // Each ratio is rounded to integer percent; overall is the rounded mean.
  // A mission with zero tasks is 0%; no mission is UNKNOWN, never a fake 0%.
  function progressView(runs,tasks,runId){
    const missions=Array.isArray(runs)?runs:[];
    const run=missions.find(r=>r.id===runId)||missions.slice().sort((a,b)=>String(b?.createdAt||'').localeCompare(String(a?.createdAt||'')))[0];
    if(!run)return {state:UNKNOWN,runId:UNKNOWN,overall:UNKNOWN,phases:Object.fromEntries(PROGRESS_PHASES.map(p=>[p,UNKNOWN]))};
    const members=(Array.isArray(tasks)?tasks:[]).filter(t=>t?.runId===run.id);
    const n=members.length,percent=count=>n?Math.round(100*count/n):0;
    const inner=t=>t?.result?.tasks?.at?.(-1)||t?.result?.tasks?.[t?.result?.tasks?.length-1];
    const phases={
      planning:n&&run.plan?100:0,
      implementation:percent(members.filter(t=>Boolean(t?.result?.patch)).length),
      testing:percent(members.filter(t=>inner(t)?.verification?.passed===true).length),
      review:percent(members.filter(t=>inner(t)?.review?.schema==='aecp.review/v1'&&inner(t).review.result==='PASS').length),
      acceptance:percent(members.filter(t=>t.state==='DONE'&&Boolean(t.evidenceManifest?.sha256)).length)
    };
    return {state:'AVAILABLE',runId:run.id,overall:Math.round(PROGRESS_PHASES.reduce((sum,p)=>sum+phases[p],0)/5),phases};
  }
  return Object.freeze({UNKNOWN,timeline,diffView,reviewView,githubView,notifications,progressView,PROGRESS_PHASES,NOTIFICATION_RULES,REVIEW_DIMENSIONS});
});
