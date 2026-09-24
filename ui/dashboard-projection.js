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
  return Object.freeze({UNKNOWN,timeline,diffView});
});
