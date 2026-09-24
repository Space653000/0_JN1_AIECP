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
  const NOTIFICATION_RULES=Object.freeze([
    Object.freeze({test:/^(?:security\.|policy\.violation)/,category:'CRITICAL'}),
    Object.freeze({test:/^approval\.requested$/,category:'ACTION REQUIRED'}),
    Object.freeze({test:/^(?:task\.failed|mission\.failed|ci\.failed|delivery\.blocked|state\.failed|approval\.rejected)$/,category:'ERROR'}),
    Object.freeze({test:/^(?:task\.accepted|mission\.finished|ci\.passed|approval\.approved)$/,category:'SUCCESS'}),
    Object.freeze({test:/^(?:provider\.degraded|task\.rework|state\.rework|task\.waiting_for_lock)$/,category:'WARNING'}),
    Object.freeze({test:/^(?:task\.|mission\.|provider\.|ci\.|delivery\.|state\.)/,category:'INFO'})
  ]);
  function notifications(events,{readIds=[]}={}){
    const read=new Set(readIds),seen=new Set(),out=[];
    for(const event of (Array.isArray(events)?events:[]).slice().sort((a,b)=>String(b?.at||'').localeCompare(String(a?.at||'')))){
      if(!event||typeof event.id!=='string'||seen.has(event.id))continue;
      seen.add(event.id);
      const type=String(event.data?.type||event.type||'');
      if(/(?:^|\.)token(?:\.|$)/i.test(type))continue;
      const category=NOTIFICATION_RULES.find(rule=>rule.test.test(type))?.category;
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
