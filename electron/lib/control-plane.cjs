'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { runHarness, safeJson, DEFAULT_ROLE_PROVIDERS, invokeRole, prepareWorktree } = require('./harness.cjs');
const { SecurityPolicy } = require('./security-policy.cjs');
const { compileWorkspacePolicy } = require('./workspace-policy.cjs');
const { makeExecutionContract, updateExecutionContract } = require('./execution-contract.cjs');
const { LockManager } = require('./lock-manager.cjs');
const { EvidenceManager } = require('./evidence-manager.cjs');
const { resultCapsuleStatus } = require('./protocol.cjs');
const { policyReasonCode, policyViolationOf } = require('./security-policy.cjs');
const { ContextBus } = require('./context-bus.cjs');
const { ProviderRouter } = require('./provider-router.cjs');
const { DeliveryManager } = require('./delivery.cjs');
const { CIMonitor } = require('./ci-monitor.cjs');
const { EventLedger } = require('./event-ledger.cjs');
const { projectEvents } = require('./event-projection.cjs');
const { ResourceManager } = require('./resource-manager.cjs');
const { MaintenanceManager } = require('./maintenance.cjs');
const { RemoteGateway } = require('./remote-gateway.cjs');
const { GitHubWebhookReceiver } = require('./github-webhook.cjs');
const { recommend: recommendRecovery } = require('./failure-recovery.cjs');
const { audit: auditAdapters } = require('./adapter-security-audit.cjs');
const { acceptedTaskEvidence, validateAcceptedTaskEvidence } = require('./accepted-evidence.cjs');
const { redactSensitive } = require('./redaction.cjs');

const SCHEMA='aecp.control-plane/v1';
const STATES=Object.freeze(['PLANNING','QUEUED','RUNNING','VERIFYING','REVIEWING','REWORK','DONE','BLOCKED','BUDGET_EXHAUSTED','HUMAN_REQUIRED','FAILED','CANCELLED','PAUSED']);
const TERMINAL=new Set(['DONE','BLOCKED','BUDGET_EXHAUSTED','HUMAN_REQUIRED','FAILED','CANCELLED']);
const RISK={GREEN:0,YELLOW:1,RED:2};

function uid(prefix){return prefix+'-'+Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');}
function now(){return new Date().toISOString();}
function clamp(n,min,max,d){const x=Number(n);return Number.isFinite(x)?Math.max(min,Math.min(max,x)):d;}

function schedulerPriority(value){return clamp(value,0,100,50);}
function schedulerRisk(value){return RISK[String(value||'YELLOW').toUpperCase()] ?? RISK.YELLOW;}
function schedulerEstimate(value,fallback,max){return clamp(value,0,max,fallback);}
function compareSchedulerCandidates(a,b){
  return b.priority-a.priority
    || a.risk-b.risk
    || a.estimatedCostUnits-b.estimatedCostUnits
    || a.estimatedRuntimeMs-b.estimatedRuntimeMs
    || String(a.createdAt||'').localeCompare(String(b.createdAt||''))
    || String(a.taskId||'').localeCompare(String(b.taskId||''));
}

class ControlPlane {
  constructor({rootDir, emit=async()=>{}, providerRouter=null, workerRegistry=null, remoteOptions={}, policyConfig={}}={}) {
    this.rootDir=path.resolve(rootDir);
    this.file=path.join(this.rootDir,'control-plane.json');
    this.eventFile=path.join(this.rootDir,'events.jsonl');
    this.emit=emit;
    this.state=null;
    this.controllers=new Map();
    this.scheduler=null;
    this.persistQueue=Promise.resolve();
    this.persistSequence=0;
    this.shuttingDown=false;
    this.maintenanceTask=null;
    this.providerHealthCache=new Map();
    this.policyConfig=compileWorkspacePolicy(policyConfig);
    this.policy=new SecurityPolicy({allowRoots:[this.rootDir],...this.policyConfig});
    this.locks=new LockManager(path.join(this.rootDir,'locks'));
    this.evidence=new EvidenceManager(path.join(this.rootDir,'evidence'));
    this.contextBus=new ContextBus(this.rootDir);
    this.providers=providerRouter||new ProviderRouter();
    this.workerRegistry=workerRegistry||null;
    this.delivery=new DeliveryManager({repo:null,cwd:this.rootDir});
    this.ledger=new EventLedger(this.eventFile+'.ledger');
    this.resources=new ResourceManager(path.join(this.rootDir,'resources'));
    this.maintenance=null;
    this.remote=new RemoteGateway({
      ...remoteOptions,
      status:()=>this.status(),
      replay:(runId,limit)=>this.replay(runId,limit),
      approve:(approvalId,ctx)=>this.approve(approvalId,{by:'remote:'+String(ctx?.deviceId||'device'),note:'Remote paired approval',idempotencyKey:ctx?.requestId}),
      reject:(approvalId,ctx)=>this.reject(approvalId,{by:'remote:'+String(ctx?.deviceId||'device'),note:'Remote paired rejection',idempotencyKey:ctx?.requestId})
    });
    this.webhook=new GitHubWebhookReceiver({secret:process.env.AECP_GITHUB_WEBHOOK_SECRET,port:Number(process.env.AECP_GITHUB_WEBHOOK_PORT||0),onEvent:(e)=>this.ingestExternalEvent(e)});
  }

  async init(){
    await fs.mkdir(this.rootDir,{recursive:true});
    await this.locks.init(); await this.evidence.init(); await this.contextBus.init(); await this.ledger.init(); await this.resources.init();
    this.maintenance=new MaintenanceManager({locks:this.locks,evidence:this.evidence,contextBus:this.contextBus});
    this.adapterSecurity=auditAdapters();
    try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){
      if(e.code!=='ENOENT') throw e;
      this.state={schema:SCHEMA,version:1,runs:{},tasks:{},agents:{},approvals:{},locks:{},updatedAt:now()};
      await this.persist();
    }
    await this.recover();
    await this.remote.start();
    if(process.env.AECP_GITHUB_WEBHOOK_SECRET) await this.webhook.start();
    return this.snapshot();
  }

  async persist(){
    this.state.updatedAt=now();
    const payload=JSON.stringify(redactSensitive(this.state),null,2);
    const tmp=this.file+'.tmp-'+process.pid+'-'+(++this.persistSequence);
    const write=async()=>{
      await fs.writeFile(tmp,payload,'utf8');
      await fs.rename(tmp,this.file);
    };
    const operation=this.persistQueue.then(write,write);
    this.persistQueue=operation.catch(()=>{});
    return operation;
  }

  async event(type,data={}){
    const e=redactSensitive({schema:'aecp.event/v1',id:uid('evt'),at:now(),type,correlationId:data.correlationId||data.runId||null,...data});
    const ledger=await this.ledger.append({...e,idempotencyKey:data.idempotencyKey||null});
    if(ledger.duplicate) return e;
    await fs.appendFile(this.eventFile,JSON.stringify(e)+'\n','utf8');
    this.state.runs[data.runId]?.events?.push(e);
    await this.persist();
    await this.emit(e);
    return e;
  }

  snapshot(){
    return redactSensitive({schema:SCHEMA,updatedAt:this.state?.updatedAt,runs:Object.values(this.state?.runs||{}),tasks:Object.values(this.state?.tasks||{}),agents:Object.values(this.state?.agents||{}),workers:this.workerRegistry?.list?.()||[],approvals:Object.values(this.state?.approvals||{}),locks:Object.values(this.state?.locks||{})});
  }

  policyForRun(run){
    const roots=[this.rootDir,run?.sourceRoot,...(run?.repositoryPaths||[])].filter(Boolean).map(x=>path.resolve(String(x)));
    return new SecurityPolicy({allowRoots:[...new Set(roots)],...this.policyConfig});
  }

  async assertTaskWritePolicy(policy,{runId,taskId,path:targetPath,approved=false}){
    const check=policy.check({action:'WRITE',path:targetPath,approved});
    if(check.allowed)return check;
    await this.recordPolicyViolation({runId,taskId,action:'WRITE',reasonCode:policyReasonCode(check.reason,check.requiresApproval)});
    throw Object.assign(new Error(check.reason),{code:check.requiresApproval?'APPROVAL_REQUIRED':'POLICY_DENIED',policy:check});
  }

  // Records that a policy gate stopped an action. Only the action class and a stable reason code are stored.
  async recordPolicyViolation({runId=null,taskId=null,action,reasonCode}={}){
    await this.event('policy.violation',{runId,taskId,action:String(action||'UNKNOWN').slice(0,32),reasonCode:String(reasonCode||'POLICY_DENIED').slice(0,48)}).catch(()=>{});
  }

  // Same decision as policy.assert; a stopped action is recorded before the original error is re-thrown.
  async assertPolicyRecorded(policy,input,{runId,taskId}={}){
    try{return policy.assert(input);}
    catch(error){
      const violation=policyViolationOf(error);
      if(violation)await this.recordPolicyViolation({runId,taskId,...violation});
      throw error;
    }
  }

  setPolicyConfig(config={}){
    this.policyConfig=compileWorkspacePolicy(config);
    this.policy=new SecurityPolicy({allowRoots:[this.rootDir],...this.policyConfig});
    return {...this.policyConfig};
  }

  normalizeRoleConfig(providers={},models={}){
    const selected={};
    const selectedModels={};
    for(const role of ['planner','builder','reviewer']){
      const provider=String(providers?.[role]||DEFAULT_ROLE_PROVIDERS[role]||'').trim();
      if(!provider||!this.providers.resolve(role,provider)) throw new Error(`Provider "${provider||'(empty)'}" cannot serve role "${role}".`);
      selected[role]=provider;
      const model=models?.[role];
      selectedModels[role]=typeof model==='string'&&model.trim()?model.trim().slice(0,200):null;
    }
    return {providers:selected,models:selectedModels};
  }

  normalizeBuilderWorkers(workerIds=[]){
    const ids=[...new Set((Array.isArray(workerIds)?workerIds:[]).map(x=>String(x||'').trim()).filter(Boolean))];
    if(!ids.length) return [];
    if(!this.workerRegistry) throw new Error('Builder Worker pool requires a Worker Registry.');
    for(const id of ids){
      const worker=this.workerRegistry.get(id);
      if(!worker) throw new Error(`Worker "${id}" is not registered.`);
      if(worker.role!=='builder') throw new Error(`Worker "${id}" cannot serve role "builder".`);
      if(!worker.providerId||!this.providers.resolve('builder',worker.providerId)) throw new Error(`Worker "${id}" provider cannot serve role "builder".`);
    }
    return ids;
  }

  builderWorkerProfiles(run){
    const ids=Array.isArray(run?.builderWorkers)?run.builderWorkers:[];
    if(!ids.length||!this.workerRegistry) return [];
    return ids.map(id=>this.workerRegistry.get(id)).filter(Boolean);
  }

  builderProviderEntries(run){
    const workers=this.builderWorkerProfiles(run);
    if(workers.length) return workers.map(worker=>({
      workerId:worker.id,
      providerId:worker.providerId,
      model:worker.model||null
    }));
    return run?.providers?.builder?[{workerId:null,providerId:run.providers.builder,model:run.models?.builder||null}]:[];
  }

  missingProviderApprovals(run){
    const missing=new Set();
    const entries=[
      {role:'planner',providerId:run.providers?.planner,model:run.models?.planner||null},
      {role:'reviewer',providerId:run.providers?.reviewer,model:run.models?.reviewer||null},
      ...this.builderProviderEntries(run).map(entry=>({role:'builder',providerId:entry.providerId,model:entry.model}))
    ];
    for(const entry of entries){
      if(!entry.providerId) continue;
      const capabilities=this.providers.capabilities(entry.role,entry.providerId,{model:entry.model});
      if(!capabilities) continue;
      if(capabilities.network && !run.providerApprovals?.network) missing.add('NETWORK');
      if(capabilities.credential && !run.providerApprovals?.credential) missing.add('CREDENTIAL');
    }
    return [...missing];
  }

  async ensureMissionProviderApprovals(run){
    const missing=this.missingProviderApprovals(run);
    if(!missing.length) return true;
    const action=missing[0];
    const existing=Object.values(this.state.approvals||{}).find(a=>a.runId===run.id&&!a.taskId&&a.action===action&&a.state==='WAITING');
    if(!existing){
      const id=uid('approval');
      const risk=this.policy.classify(action);
      this.state.approvals[id]={id,runId:run.id,taskId:null,state:'WAITING',risk,reason:`${action} approval is required by the selected mission providers.`,action,createdAt:now()};
      run.state='HUMAN_REQUIRED'; run.waitingFor=action;
      await this.persist();
      await this.event('approval.requested',{runId:run.id,taskId:null,approvalId:id,risk,reason:this.state.approvals[id].reason,action});
    }else{
      run.state='HUMAN_REQUIRED'; run.waitingFor=action; await this.persist();
    }
    return false;
  }

  async recover(){
    for(const run of Object.values(this.state.runs||{})){
      if(['RUNNING','QUEUED'].includes(run.state) && !this.controllers.has(run.id)){
        run.state='PAUSED';
        run.recovery={reason:'process-restart',at:now(),requiresExplicitResume:true};
      }
      for(const taskId of run.taskIds||[]){
        const task=this.state.tasks[taskId];
        if(!task||TERMINAL.has(task.state)) continue;
        if(['RUNNING','VERIFYING','REVIEWING'].includes(task.state) && !this.controllers.has(task.id)){
          if(task.delivery?.sha && task.ci?.state!=='PASSED'){ task.state='REVIEWING'; task.phase='CI_RECOVERY'; task.recoveredAt=now(); this.monitorDeliveryCI(run,task).catch(()=>{}); }
          else { task.state='QUEUED'; task.phase='RECOVERED'; task.lease=null; task.resume=true; task.recoveredAt=now(); }
        } else if(task.lease && new Date(task.lease.expiresAt).getTime()<Date.now()){
          task.state='QUEUED'; task.phase='RECOVERED'; task.lease=null; task.resume=true; task.recoveredAt=now();
        }
      }
    }
    await this.persist();
  }

  async planMission(run){
    const repositories=await this.resources.scan(run.sourceRoot); run.repositoryPaths=repositories.map(r=>r.path);
    const prompt=[
      'You are the AECP Mission Planner.',
      'Return ONLY JSON: {"tasks":[{"title":"...","objective":"...","acceptance":"...","dependencies":[],"risk":"GREEN|YELLOW|RED","priority":50,"estimatedRuntimeMs":300000,"estimatedCostUnits":1,"repositories":["absolute or listed repository path"]}]}',
      'Create small independent engineering tasks. Do not invent permissions or credentials.',
      'GOAL:\n'+run.goal,
      'DEFINITION OF DONE:\n'+run.done,
      'CONTEXT:\n'+run.context,
      'AVAILABLE REPOSITORIES:\n'+repositories.map(r=>r.path+' | '+r.remote+' | '+r.branch).join('\n')
    ].join('\n\n');
    const roleConfig=this.normalizeRoleConfig(run.providers,run.models);
    run.providers=roleConfig.providers; run.models=roleConfig.models;
    const runPolicy=this.policyForRun(run);
    const execution=await invokeRole({
      router:this.providers,
      role:'planner',
      prompt,
      providerId:run.providers.planner,
      model:run.models.planner,
      cwd:run.sourceRoot,
      policy:runPolicy,
      timeoutMs:180000,
      networkApproved:Boolean(run.providerApprovals?.network),
      credentialApproved:Boolean(run.providerApprovals?.credential)
    });
    if(execution.code!==0||execution.timedOut||execution.aborted) throw new Error('Mission planner failed: '+String(execution.stderr||execution.stdout||'unknown provider failure').slice(-3000));
    const plan=safeJson(execution.stdout);
    const tasks=Array.isArray(plan?.tasks)?plan.tasks.slice(0,run.maxTasks):[];
    if(!tasks.length) throw new Error('Planner returned no tasks.');
    for(const item of tasks) await this.enqueueTask(run,{title:String(item.title||'Task'),objective:String(item.objective||''),acceptance:String(item.acceptance||run.done),dependencies:Array.isArray(item.dependencies)?item.dependencies:[],risk:['GREEN','YELLOW','RED'].includes(item.risk)?item.risk:'YELLOW',priority:schedulerPriority(item.priority),estimatedRuntimeMs:schedulerEstimate(item.estimatedRuntimeMs,300000,24*60*60*1000),estimatedCostUnits:schedulerEstimate(item.estimatedCostUnits,1,1000000),repositories:Array.isArray(item.repositories)?item.repositories:[]});
    run.executionContract=updateExecutionContract(run.executionContract,{taskIds:[...(run.taskIds||[])]});
    run.plannedAt=now();run.plan=plan;await this.persist();await this.event('mission.planned',{runId:run.id,taskCount:tasks.length});
    return tasks;
  }

  async createMission({goal,done,sourceRoot,workspaceId=null,context='',maxTasks=8,maxIterations=5,maxConcurrency=2,maxTurns=null,maxFailedAttempts=null,maxNoProgressAttempts=2,maxWallClockMs=null,maxProviderReportedCost=null,maxLocalComputeMs=null,maxPatchBytes=null,maxChangedFiles=null,checkpointEvery=1,autoStart=true,autoResume=true,delivery=false,githubRepo=null,providers={},models={},builderWorkers=[],providerApprovals={}}){
    if(!goal||!done) throw new Error('Goal and Definition of Done are required.');
    if(!sourceRoot) throw new Error('Mission sourceRoot is required.');
    const roleConfig=this.normalizeRoleConfig(providers,models);
    const selectedBuilderWorkers=this.normalizeBuilderWorkers(builderWorkers);
    const id=uid('mission');
    const executionContract=makeExecutionContract({
      goal,
      done,
      workspaceId,
      workspaceRoot:path.resolve(sourceRoot),
      permissionPolicy:{mode:'CONTROL_PLANE_MISSION',...this.policyConfig,highRisk:'HUMAN_REQUIRED'},
      taskIds:[],
      resultCapsuleRef:`local://control-plane/${id}/control-plane.json`,
      evidenceRef:`local://control-plane/${id}/evidence`,
      traceRef:`local://control-plane/${id}/events.jsonl`,
      transport:'control-plane-harness',
      worker:selectedBuilderWorkers.length?selectedBuilderWorkers:roleConfig.providers.builder
    });
    const boundedMaxTasks=clamp(maxTasks,1,8,8),boundedMaxIterations=clamp(maxIterations,1,5,5);
    const run={id,schema:'aecp.mission/v1',goal,done,sourceRoot:path.resolve(sourceRoot),workspaceId:workspaceId||null,context,maxTasks:boundedMaxTasks,maxIterations:boundedMaxIterations,maxConcurrency:clamp(maxConcurrency,1,8,2),maxTurns:clamp(maxTurns,1,200,Math.max(3,1+(boundedMaxTasks*boundedMaxIterations*2))),maxFailedAttempts:clamp(maxFailedAttempts,1,20,boundedMaxTasks*boundedMaxIterations),maxNoProgressAttempts:clamp(maxNoProgressAttempts,1,5,2),maxWallClockMs:maxWallClockMs==null?null:clamp(maxWallClockMs,1000,24*60*60*1000,null),maxProviderReportedCost:maxProviderReportedCost==null?null:Math.max(0.000001,Math.min(1000000000,Number(maxProviderReportedCost)||0.000001)),maxLocalComputeMs:maxLocalComputeMs==null?null:clamp(maxLocalComputeMs,1000,24*60*60*1000,null),maxPatchBytes:maxPatchBytes==null?8*1024*1024:clamp(maxPatchBytes,1024,64*1024*1024,8*1024*1024),maxChangedFiles:maxChangedFiles==null?100:clamp(maxChangedFiles,1,1000,100),checkpointEvery:clamp(checkpointEvery,1,boundedMaxIterations,1),autoResume:Boolean(autoResume),delivery:Boolean(delivery),githubRepo:githubRepo||null,providers:roleConfig.providers,models:roleConfig.models,builderWorkers:selectedBuilderWorkers,providerApprovals:{network:Boolean(providerApprovals?.network),credential:Boolean(providerApprovals?.credential)},executionContract,state:'QUEUED',createdAt:now(),updatedAt:now(),taskIds:[],events:[]};
    this.state.runs[id]=run;
    await this.persist();
    await this.event('mission.created',{runId:id,state:run.state,goal});
    if(autoStart) {
      if(await this.ensureMissionProviderApprovals(run)){
        await this.planMission(run);
        await this.startMission(id);
      }
    }
    return run;
  }

  async startMission(id){
    const run=this.state.runs[id]; if(!run) throw new Error('Mission not found.');
    if(TERMINAL.has(run.state)) throw new Error('Mission is already terminal.');
    run.state='RUNNING'; run.startedAt=run.startedAt||now();
    await this.persist();
    this.schedule();
    await this.event('mission.started',{runId:id});
    return run;
  }

  async pauseMission(id){
    const run=this.state.runs[id]; if(!run) throw new Error('Mission not found.');
    run.state='PAUSED'; run.pausedAt=now();
    for(const taskId of run.taskIds||[]){ const task=this.state.tasks[taskId]; const controller=this.controllers.get(taskId); if(controller) controller.abort(); if(task?.workerId&&this.workerRegistry) await this.workerRegistry.markCancelling(task.workerId).catch(()=>{}); }
    await this.persist(); await this.event('mission.paused',{runId:id}); return run;
  }

  async cancelTask(runId,taskId){
    const run=this.state.runs[runId]; if(!run) throw new Error('Mission not found.');
    const task=this.state.tasks[taskId]; if(!task||task.runId!==runId) throw new Error('Task not found.');
    if(TERMINAL.has(task.state)||task.state==='CANCELLED') return task;
    const controller=this.controllers.get(taskId);
    if(task.workerId&&this.workerRegistry) await this.workerRegistry.markCancelling(task.workerId).catch(()=>{});
    task.cancelRequestedAt=now();
    task.cancelRequested=true;
    if(controller){
      controller.abort();
      await this.persist();
      await this.event('task.cancel_requested',{runId,taskId,workerId:task.workerId||null});
      return task;
    }
    task.state='CANCELLED';
    task.phase='CANCELLED';
    task.lease=null;
    task.finishedAt=now();
    await this.persist();
    await this.event('task.cancelled',{runId,taskId,workerId:task.workerId||null});
    await this.finalizeRun(run);
    this.schedule();
    return task;
  }

  async cancelMission(id){
    const run=this.state.runs[id]; if(!run) throw new Error('Mission not found.');
    for(const taskId of run.taskIds||[]){const task=this.state.tasks[taskId];const controller=this.controllers.get(taskId);if(controller)controller.abort();if(task?.workerId&&this.workerRegistry)await this.workerRegistry.markCancelling(task.workerId).catch(()=>{});}
    run.state='CANCELLED'; run.cancelledAt=now();
    await this.persist(); await this.event('mission.cancelled',{runId:id}); return run;
  }

  async approve(id,{by='human',note='',idempotencyKey=null}={}){
    const a=this.state.approvals[id]; if(!a) throw new Error('Approval not found.');
    if(a.state!=='WAITING'){
      if(idempotencyKey&&a.decisionIdempotencyKey===idempotencyKey&&a.state==='APPROVED') return a;
      throw new Error('Approval is not waiting.');
    }
    a.state='APPROVED'; a.decidedAt=now(); a.decidedBy=by; a.note=note; a.decisionIdempotencyKey=idempotencyKey||null;
    const run=this.state.runs[a.runId];
    if(run && a.action==='NETWORK'){run.providerApprovals||={};run.providerApprovals.network=true;}
    if(run && a.action==='CREDENTIAL'){run.providerApprovals||={};run.providerApprovals.credential=true;}
    const task=this.state.tasks[a.taskId];
    if(task && a.action){
      task.approvedActions=Array.isArray(task.approvedActions)?task.approvedActions:[];
      if(!task.approvedActions.includes(a.action)) task.approvedActions.push(a.action);
    }
    if(task){task.lease=null;if(!task.delivery?.pr) task.state='QUEUED'; else task.state='HUMAN_REQUIRED';}
    // A task approved for rework lets a mission that only stopped for this decision continue; a delivery still
    // waiting for its merge approval, or any other pending approval, keeps the mission stopped.
    let resumed=false;
    if(run && task && task.state==='QUEUED' && run.state==='HUMAN_REQUIRED'){
      const pending=Object.values(this.state.approvals||{}).some(x=>x.runId===run.id&&x.state==='WAITING');
      const humanTasks=(run.taskIds||[]).map(taskId=>this.state.tasks[taskId]).some(x=>x&&x.state==='HUMAN_REQUIRED');
      if(!pending&&!humanTasks){run.state='RUNNING';run.finishedAt=null;resumed=true;}
    }
    await this.persist(); await this.event('approval.approved',{runId:a.runId,taskId:a.taskId,approvalId:id,...(resumed?{resumed:true}:{})});
    if(run && !a.taskId && ['NETWORK','CREDENTIAL'].includes(a.action)){
      run.waitingFor=null;
      if(await this.ensureMissionProviderApprovals(run)){
        if(run.state==='HUMAN_REQUIRED') run.state='QUEUED';
        if(!(run.taskIds||[]).length) await this.planMission(run);
        await this.startMission(run.id);
      }
    }
    this.schedule(); return a;
  }

  async reject(id,{by='human',note='Rejected',idempotencyKey=null}={}){
    const a=this.state.approvals[id]; if(!a) throw new Error('Approval not found.');
    if(a.state!=='WAITING'){
      if(idempotencyKey&&a.decisionIdempotencyKey===idempotencyKey&&a.state==='REJECTED') return a;
      throw new Error('Approval is not waiting.');
    }
    a.state='REJECTED';a.decidedAt=now();a.decidedBy=by;a.note=note;a.decisionIdempotencyKey=idempotencyKey||null;
    const task=this.state.tasks[a.taskId]; if(task) task.state='BLOCKED';
    const run=this.state.runs[a.runId]; if(run&&!a.taskId){run.state='BLOCKED';run.blockedAt=now();run.blockReason=note;}
    await this.persist(); await this.event('approval.rejected',{runId:a.runId,taskId:a.taskId,approvalId:id});
    return a;
  }

  async heartbeat(){
    for(const run of Object.values(this.state.runs||{})){
      for(const taskId of run.taskIds||[]){
        const t=this.state.tasks[taskId];
        if(t?.state!=='RUNNING'||!t.lease) continue;
        t.lease.expiresAt=new Date(Date.now()+15*60*1000).toISOString();
        t.heartbeatAt=now();
        if(t.workerId&&this.workerRegistry) await this.workerRegistry.updateAssignment(t.workerId,{runId:run.id,taskId:t.id,verificationState:t.phase==='VERIFYING'?'RUNNING':'PENDING'}).catch(()=>{});
        for(const lock of t.lockLeases||[]){
          try{
            const renewed=await this.locks.renew(lock.key,t.id,lock.token);
            lock.expiresAt=renewed.expiresAt;
          }catch(error){
            t.lockRenewError=String(error?.message||error).slice(0,1000);
            this.controllers.get(t.id)?.abort();
            await this.event('task.lock_lost',{runId:run.id,taskId:t.id,key:lock.key,error:t.lockRenewError});
          }
        }
      }
    }
    await this.persist();
  }

  taskMutationLockKeys(run,task){
    const subRoot=path.join(this.rootDir,'runs',run.id,task.id);
    return ['worktree:'+subRoot.toLowerCase()];
  }

  gitAdminLockKey(repositoryRoot){
    return 'git-admin:'+path.resolve(repositoryRoot).toLowerCase();
  }

  async providerHealthForRun(run){
    const results={};
    const unique=new Map();
    for(const role of ['planner','reviewer']){
      const providerId=run.providers?.[role];
      if(providerId) unique.set(providerId,{providerId,model:run.models?.[role]||null});
    }
    for(const entry of this.builderProviderEntries(run)){
      if(entry.providerId) unique.set(entry.providerId,{providerId:entry.providerId,model:entry.model||null});
    }
    for(const {providerId,model} of unique.values()){
      const cacheKey=[providerId,model||'',Boolean(run.providerApprovals?.network),Boolean(run.providerApprovals?.credential)].join('|');
      const cached=this.providerHealthCache.get(cacheKey);
      if(cached&&Date.now()-cached.at<15000){results[providerId]=cached.value;continue;}
      let value={provider:providerId,status:'READY',detail:'Provider registration is valid.'};
      if(typeof this.providers.health==='function'){
        try{
          value=await this.providers.health(providerId,{
            model,
            networkApproved:Boolean(run.providerApprovals?.network),
            credentialApproved:Boolean(run.providerApprovals?.credential),
            timeoutMs:5000
          });
        }catch(error){
          value={provider:providerId,status:'UNAVAILABLE',detail:String(error?.message||error).slice(0,500)};
        }
      }
      this.providerHealthCache.set(cacheKey,{at:Date.now(),value});
      results[providerId]=value;
    }
    return results;
  }

  schedulerDecision(run,task,{providerHealth={},locks=[],reservedWorkers=new Set()}={}){
    const reasons=[];
    const dependenciesReady=(task.dependencies||[]).every(d=>{
      const dep=(run.taskIds||[]).map(x=>this.state.tasks[x]).find(x=>x?.id===d||x?.title===d);
      return dep?dep.state==='DONE':true;
    });
    if(!dependenciesReady) reasons.push('DEPENDENCY_WAIT');

    const retryRemaining=Math.max(0,Number(run.maxIterations||1)-Number(task.attempts||0));
    if(retryRemaining<=0) reasons.push('RETRY_BUDGET_EXHAUSTED');

    const repositoryLocks=this.taskMutationLockKeys(run,task);
    const lockConflict=repositoryLocks.find(key=>locks.some(lock=>lock.key===key&&lock.meta?.taskId!==task.id));
    if(lockConflict) reasons.push('LOCK_BUSY');

    const missingApprovals=this.missingProviderApprovals(run);
    if(missingApprovals.length) reasons.push('PROVIDER_APPROVAL_REQUIRED');
    if(!this.adapterSecurity?.ok) reasons.push('ADAPTER_POLICY_BLOCKED');

    const providerStates={};
    for(const role of ['planner','reviewer']){
      const providerId=run.providers?.[role];
      if(!providerId) continue;
      const health=providerHealth[providerId]||{status:'NOT_CONFIGURED',detail:'Provider health unavailable.'};
      providerStates[role]={provider:providerId,status:health.status,detail:health.detail||null};
      if(health.status!=='READY') reasons.push('PROVIDER_'+role.toUpperCase()+'_'+health.status);
    }

    let selectedWorker=null;
    const workerProfiles=this.builderWorkerProfiles(run);
    if(workerProfiles.length){
      const candidates=workerProfiles.filter(worker=>worker.runtimeState==='IDLE'&&!reservedWorkers.has(worker.id));
      selectedWorker=candidates.find(worker=>(providerHealth[worker.providerId]?.status||'NOT_CONFIGURED')==='READY')||null;
      if(!selectedWorker){
        const anyIdle=candidates.length>0;
        if(!anyIdle) reasons.push('WORKER_BUSY');
        else reasons.push('BUILDER_PROVIDER_UNAVAILABLE');
      }else{
        const health=providerHealth[selectedWorker.providerId]||{status:'NOT_CONFIGURED',detail:'Provider health unavailable.'};
        providerStates.builder={provider:selectedWorker.providerId,workerId:selectedWorker.id,status:health.status,detail:health.detail||null};
      }
    }else{
      const providerId=run.providers?.builder;
      const health=providerHealth[providerId]||{status:'NOT_CONFIGURED',detail:'Provider health unavailable.'};
      providerStates.builder={provider:providerId,status:health.status,detail:health.detail||null};
      if(health.status!=='READY') reasons.push('PROVIDER_BUILDER_'+health.status);
    }

    return {
      schema:'aecp.scheduler-decision/v1',
      taskId:task.id,
      at:now(),
      eligible:reasons.length===0,
      reasons:[...new Set(reasons)],
      selectedWorkerId:selectedWorker?.id||null,
      selectedBuilderProvider:selectedWorker?.providerId||run.providers?.builder||null,
      selectedBuilderModel:selectedWorker?.model||run.models?.builder||null,
      priority:schedulerPriority(task.priority),
      risk:schedulerRisk(task.risk),
      estimatedCostUnits:schedulerEstimate(task.estimatedCostUnits,1,1000000),
      estimatedRuntimeMs:schedulerEstimate(task.estimatedRuntimeMs,300000,24*60*60*1000),
      retryRemaining,
      repositoryLocks,
      providerStates
    };
  }

  async schedulerTick(){
    if(this.shuttingDown) return;
    await this.locks.recover();
    const locks=this.locks.list();
    for(const run of Object.values(this.state.runs)){
      if(!['QUEUED','RUNNING'].includes(run.state)) continue;
      if(run.state==='QUEUED') run.state='RUNNING';
      const active=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(t=>t&&t.state==='RUNNING').length;
      if(active>=run.maxConcurrency) continue;

      const providerHealth=await this.providerHealthForRun(run);
      const reservedWorkers=new Set();
      const ordered=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(t=>t&&t.state==='QUEUED').sort((a,b)=>compareSchedulerCandidates(
        {priority:schedulerPriority(a.priority),risk:schedulerRisk(a.risk),estimatedCostUnits:schedulerEstimate(a.estimatedCostUnits,1,1000000),estimatedRuntimeMs:schedulerEstimate(a.estimatedRuntimeMs,300000,24*60*60*1000),createdAt:a.createdAt,taskId:a.id},
        {priority:schedulerPriority(b.priority),risk:schedulerRisk(b.risk),estimatedCostUnits:schedulerEstimate(b.estimatedCostUnits,1,1000000),estimatedRuntimeMs:schedulerEstimate(b.estimatedRuntimeMs,300000,24*60*60*1000),createdAt:b.createdAt,taskId:b.id}
      ));
      const selected=[];
      for(const task of ordered){
        const decision=this.schedulerDecision(run,task,{providerHealth,locks,reservedWorkers});
        task.schedulerDecision=decision;
        if(!decision.eligible) continue;
        selected.push({task,decision});
        if(decision.selectedWorkerId) reservedWorkers.add(decision.selectedWorkerId);
        if(selected.length>=run.maxConcurrency-active) break;
      }
      for(const {task,decision} of selected){
        await this.event('scheduler.selected',{runId:run.id,taskId:task.id,decision});
        this.executeTask(run,task).catch(()=>{});
      }
    }
    await this.persist();
    if(!this.shuttingDown && (!this.lastMaintenanceAt || Date.now()-this.lastMaintenanceAt>60000)){this.lastMaintenanceAt=Date.now();const worktrees=[]; for(const run of Object.values(this.state.runs||{})){ if(!TERMINAL.has(run.state)) continue; for(const taskId of run.taskIds||[]){const t=this.state.tasks[taskId]; if(t?.result?.worktree) worktrees.push({worktree:t.result.worktree,repoRoot:t.delivery?.taskRoot||run.sourceRoot});}} const repoRoots=[...new Set(Object.values(this.state.runs||{}).map(r=>r.sourceRoot).filter(Boolean))];
      const dependencyDue=!this.lastDependencyScanAt || Date.now()-this.lastDependencyScanAt>6*60*60*1000;
      const maintenance=this.maintenance?.run({worktrees,driftRoots:repoRoots,dependencyRoots:dependencyDue?repoRoots:[],dependencyScan:dependencyDue}).then(r=>{if(dependencyDue)this.lastDependencyScanAt=Date.now();return this.event('maintenance.completed',{data:r,idempotencyKey:'maintenance:'+Math.floor(Date.now()/60000)})}).catch(e=>this.event('maintenance.failed',{error:String(e.message||e)}));
      if(maintenance){this.maintenanceTask=maintenance;maintenance.finally(()=>{if(this.maintenanceTask===maintenance)this.maintenanceTask=null;}).catch(()=>{});}
    }
  }
  schedule(){
    if(this.shuttingDown||this.scheduler) return;
    this.scheduler=setInterval(()=>{this.schedulerTick().catch(()=>{});this.heartbeat().catch(()=>{});},1000);
    this.scheduler.unref?.();
    this.schedulerTick().catch(()=>{});
  }

  async enqueueTask(run,task){
    const id=uid('task');
    const fallbackRoot=path.resolve(run.sourceRoot||this.rootDir);
    const allowedRoots=(Array.isArray(run.repositoryPaths)&&run.repositoryPaths.length?run.repositoryPaths:[fallbackRoot]).filter(Boolean);
    const allowed=new Set(allowedRoots.map(x=>path.resolve(String(x)).toLowerCase()));
    const requested=(task.repositories||[]).map(x=>path.resolve(String(x))).filter(x=>allowed.has(x.toLowerCase()));
    const repositories=requested.length?requested:[fallbackRoot];
    const t={...task,id,runId:run.id,state:'QUEUED',phase:'QUEUED',createdAt:now(),updatedAt:now(),attempts:0,lease:null,priority:schedulerPriority(task.priority),estimatedRuntimeMs:schedulerEstimate(task.estimatedRuntimeMs,300000,24*60*60*1000),estimatedCostUnits:schedulerEstimate(task.estimatedCostUnits,1,1000000),resources:{repositories}};
    this.state.tasks[id]=t;run.taskIds.push(id);
    await this.persist();await this.event('task.queued',{runId:run.id,taskId:id,title:t.title});
    return t;
  }

  async executeTask(run,task){
    if(task.state!=='QUEUED'||run.state!=='RUNNING') return;
    task.state='RUNNING';task.phase='PREPARE';task.attempts++;task.startedAt=now();
    task.lease={id:uid('lease'),owner:task.id,processId:process.pid,expiresAt:new Date(Date.now()+15*60*1000).toISOString()};
    const taskRoot=path.resolve(task.resources?.repositories?.[0]||run.sourceRoot);
    const subRoot=path.join(this.rootDir,'runs',run.id,task.id);
    const selectedWorkerId=task.schedulerDecision?.selectedWorkerId||null;
    let workerProfile=null;
    let workerAcquired=false;
    if(selectedWorkerId&&this.workerRegistry){
      try{
        workerProfile=await this.workerRegistry.acquire(selectedWorkerId,{
          runId:run.id,
          taskId:task.id,
          repository:taskRoot,
          worktree:path.join(subRoot,'worktree'),
          verificationState:'PENDING'
        });
        workerAcquired=true;
        task.workerId=workerProfile.id;
        task.worker={id:workerProfile.id,name:workerProfile.name,providerId:workerProfile.providerId,providerName:workerProfile.providerName,model:workerProfile.model||null,runtime:workerProfile.runtime,codexHome:workerProfile.codexHome};
      }catch(error){
        task.state='QUEUED';task.phase='WAITING_WORKER';task.lease=null;task.attempts=Math.max(0,task.attempts-1);
        await this.persist();
        await this.event('task.waiting_for_worker',{runId:run.id,taskId:task.id,workerId:selectedWorkerId,error:String(error?.message||error)});
        return;
      }
    }
    const builderProvider=workerProfile?.providerId||run.providers.builder;
    const builderModel=workerProfile?.model||run.models.builder||null;
    const lockKeys=this.taskMutationLockKeys(run,task);
    const locks=[];
    try { for(const key of lockKeys) locks.push(await this.locks.acquire(key,task.id,{meta:{runId:run.id,taskId:task.id,workerId:task.workerId||null}})); } catch(e) { for(const x of locks){try{await this.locks.release(x.key,task.id,x.token)}catch{}} if(workerAcquired&&this.workerRegistry)await this.workerRegistry.release(selectedWorkerId,{resultState:'WAITING_LOCK'}).catch(()=>{}); task.state='QUEUED'; task.phase='WAITING_LOCK'; task.lease=null; task.attempts=Math.max(0,task.attempts-1); await this.event('task.waiting_for_lock',{runId:run.id,taskId:task.id,workerId:selectedWorkerId,error:String(e.message||e)}); return; }
    task.lockLeases=locks.map(x=>({key:x.key,token:x.token,expiresAt:x.expiresAt}));
    await this.persist();await this.event('task.claimed',{runId:run.id,taskId:task.id,workerId:task.workerId||null,builderProvider,lease:task.lease,locks:task.lockLeases});
    const controller=new AbortController();this.controllers.set(task.id,controller);
    const runPolicy=this.policyForRun(run);
    const roleConfig=this.normalizeRoleConfig(run.providers,run.models);
    run.providers=roleConfig.providers; run.models=roleConfig.models;
    try{
      await this.assertTaskWritePolicy(runPolicy,{runId:run.id,taskId:task.id,path:subRoot,approved:Boolean(task.approvedActions?.includes('WRITE'))});
      if(!this.adapterSecurity.ok) throw new Error('Adapter security audit failed; autonomous execution is blocked.');
      task.phase='EXECUTING'; await this.persist();
      let baseRef=null;
      let preparedWorktree=null;
      let preparedBaseHead=null;
      const existingHarness=await fs.readFile(path.join(subRoot,'harness.json'),'utf8').then(text=>JSON.parse(text)).catch(()=>null);
      const resumableWorktree=task.resume&&existingHarness?.worktree&&await fs.stat(existingHarness.worktree).then(()=>true).catch(()=>false);
      if(!resumableWorktree){
        const adminKey=this.gitAdminLockKey(taskRoot);
        const adminLease=await this.locks.acquire(adminKey,task.id,{leaseMs:60000,meta:{runId:run.id,taskId:task.id,scope:'git-worktree-admin'}});
        try{
          if(task.delivery?.branch){await this.gitLocal(taskRoot,['fetch','origin',task.delivery.branch]);baseRef='origin/'+task.delivery.branch;}
          const prepared=await prepareWorktree(taskRoot,subRoot,controller.signal,baseRef);
          preparedWorktree=prepared.worktree;
          preparedBaseHead=prepared.baseHead;
        }finally{
          await this.locks.release(adminKey,task.id,adminLease.token).catch(()=>{});
        }
      }
      task.executionContract=task.executionContract||makeExecutionContract({
        goal:run.goal+'\nTask: '+task.title,
        done:task.acceptance||run.done,
        workspaceId:run.workspaceId||run.executionContract?.workspace?.id||null,
        workspaceRoot:taskRoot,
        permissionPolicy:{mode:'FULL_HARNESS',...this.policyConfig,networkApproved:Boolean(run.providerApprovals?.network),credentialApproved:Boolean(run.providerApprovals?.credential),highRisk:'HUMAN_REQUIRED'},
        taskIds:[task.id],
        resultCapsuleRef:`local://control-plane/${run.id}/${task.id}/harness.json`,
        evidenceRef:`local://control-plane/${run.id}/${task.id}/verified.patch`,
        traceRef:`local://control-plane/${run.id}/${task.id}/harness.json`,
        transport:'control-plane-harness',
        worker:task.workerId||builderProvider
      });
      const result=await runHarness({goal:run.goal+'\nTask: '+task.title,done:task.acceptance||run.done,context:run.context+'\nOBJECTIVE: '+task.objective,sourceRoot:taskRoot,runRoot:subRoot,baseRef,preparedWorktree,preparedBaseHead,maxTasks:1,maxIterations:run.maxIterations,maxTurns:run.maxTurns,maxFailedAttempts:run.maxFailedAttempts,maxNoProgressAttempts:run.maxNoProgressAttempts,maxWallClockMs:run.maxWallClockMs,maxProviderReportedCost:run.maxProviderReportedCost,maxLocalComputeMs:run.maxLocalComputeMs,maxPatchBytes:run.maxPatchBytes,maxChangedFiles:run.maxChangedFiles,checkpointEvery:run.checkpointEvery,workspaceId:run.workspaceId||null,executionContract:task.executionContract,signal:controller.signal,policy:runPolicy,providerRouter:this.providers,plannerProvider:run.providers.planner,builderProvider,reviewerProvider:run.providers.reviewer,plannerModel:run.models.planner,builderModel,reviewerModel:run.models.reviewer,executionApproved:Boolean(task.approvedActions?.includes('EXECUTE')),providerNetworkApproved:Boolean(run.providerApprovals?.network),providerCredentialApproved:Boolean(run.providerApprovals?.credential),resume:Boolean(task.resume),onWorkerSpawn:workerAcquired&&this.workerRegistry?(processId=>{this.workerRegistry.updateAssignment(selectedWorkerId,{processId}).catch(()=>{});}):null,onEvent:async e=>{task.lastEvent=e;task.updatedAt=now();const evidence=await this.evidence.appendEvent(run.id,e).catch(()=>null);await this.persist();await this.event('task.event',{runId:run.id,taskId:task.id,data:e,evidence:evidence?{file:evidence.file,sha256:evidence.eventSha256,summary:String(e.type||'UNKNOWN').slice(0,200)}:null});}});
      if(result?.policyViolation)await this.recordPolicyViolation({runId:run.id,taskId:task.id,...result.policyViolation});
      task.phase='VERIFYING';
      if(workerAcquired&&this.workerRegistry) await this.workerRegistry.updateAssignment(selectedWorkerId,{worktree:result.worktree||path.join(subRoot,'worktree'),verificationState:'RUNNING'}).catch(()=>{});
      await this.persist(); task.result=result;task.state=result.state==='DONE'?'DONE':result.state;task.lease=null;task.resume=false;task.finishedAt=now();
      if(task.state==='DONE' && run.delivery){
        task.phase='DELIVERY'; await this.persist();
        try{
          const repo=task.delivery?.repo || (path.resolve(taskRoot)===path.resolve(run.sourceRoot)?run.githubRepo:null) || await this.detectRepo(taskRoot); if(!repo) throw new Error('GitHub repository could not be detected.');
          await this.assertPolicyRecorded(runPolicy,{action:'COMMIT',path:result.worktree,approved:Boolean(run.delivery)},{runId:run.id,taskId:task.id});
          await this.assertPolicyRecorded(runPolicy,{action:'PUSH',path:result.worktree,approved:Boolean(run.delivery)},{runId:run.id,taskId:task.id});
          await this.assertPolicyRecorded(runPolicy,{action:'PR',path:result.worktree,approved:Boolean(run.delivery)},{runId:run.id,taskId:task.id});
          const branch='agent/'+task.id;
          const delivery=new DeliveryManager({repo,cwd:taskRoot});
          await delivery.branch(result.worktree,branch);
          const sha=await delivery.commit(result.worktree,'feat: '+task.title);
          await delivery.push(result.worktree,branch);
          task.state='REVIEWING'; await this.persist(); task.delivery={repo,branch,base:'main',sha,pr:await delivery.draftPR(result.worktree,{branch,title:'AECP: '+task.title,body:'Generated by AECP. Deterministic verification and reviewer passed. Human approval remains required for promotion.'}),state:'DRAFT'};
          task.delivery.taskRoot=taskRoot; await this.event('delivery.pr_created',{runId:run.id,taskId:task.id,delivery:task.delivery});
          this.monitorDeliveryCI(run,task).catch(async e=>{task.ciError=String(e.message||e);await this.event('delivery.ci_monitor_error',{runId:run.id,taskId:task.id,error:task.ciError});});
        }catch(e){task.deliveryError=String(e.message||e);await this.event('delivery.blocked',{runId:run.id,taskId:task.id,error:task.deliveryError});}
      }
      if(result.state==='DONE' && result.patch) {
        task.evidence=await this.evidence.write(run.id,task.id+'-result.json',{task,result});
        const accepted=acceptedTaskEvidence({run,task,result});
        const acceptedCheck=validateAcceptedTaskEvidence(accepted);
        if(!acceptedCheck.ok) throw Object.assign(new Error('Accepted-task evidence is incomplete: '+acceptedCheck.errors.join(', ')),{code:'EVIDENCE_INCOMPLETE'});
        task.acceptedEvidence=await this.evidence.write(run.id,task.id+'-accepted-evidence.json',accepted);
        const manifestItems=[
          {type:'task-result',file:task.evidence.file},
          {type:'accepted-task',file:task.acceptedEvidence.file},
          {type:'harness-record',file:path.join(result.runRoot,'harness.json')},
          {type:'verified-patch',file:result.patch.file}
        ];
        const eventFile=path.join(this.evidence.root,run.id,'events.jsonl');
        try{await fs.access(eventFile);manifestItems.push({type:'event-journal',file:eventFile});}catch{}
        task.evidenceManifest=await this.evidence.manifest(run.id,manifestItems);
      }
      if(result.state==='DONE') { task.phase='COMPLETED'; task.resultCapsule=await this.contextBus.write('result',{runId:run.id,taskId:task.id,state:task.state,status:resultCapsuleStatus(result),evidence:task.evidenceManifest||task.evidence||null,verification:result.tasks}); }
      if(task.state==='HUMAN_REQUIRED') await this.requestApproval(run,task,'Harness requested human approval.',result.requiredAction||null);
      await this.event('task.finished',{runId:run.id,taskId:task.id,workerId:task.workerId||null,builderProvider,state:task.state});
    }catch(e){
      task.error=String(e.message||e);task.lease=null;
      if(e?.code==='APPROVAL_REQUIRED'){
        task.state='HUMAN_REQUIRED';
        await this.requestApproval(run,task,task.error,e.action||e.policy?.action||null);
      }else if(controller.signal.aborted){
        if(run.state==='PAUSED'){
          task.state='QUEUED';
          task.phase='PAUSED';
          task.resume=true;
          task.error=null;
          task.lease=null;
          await this.event('task.paused',{runId:run.id,taskId:task.id,workerId:task.workerId||null});
        }else{
          task.state='CANCELLED';
          task.phase='CANCELLED';
          task.resume=false;
          task.lease=null;
          await this.event('task.cancelled',{runId:run.id,taskId:task.id,workerId:task.workerId||null});
        }
      }else{
        task.state='FAILED';task.recovery=recommendRecovery({error:task.error,phase:task.phase});await this.event('task.failed',{runId:run.id,taskId:task.id,error:task.error,recovery:task.recovery});if(task.recovery.autoEligible && task.attempts < run.maxIterations){task.state='REWORK';task.reworkReason=task.recovery.reason;task.reworkAt=now();await this.persist();await this.event('task.recovery_rework',{runId:run.id,taskId:task.id,attempt:task.attempts,recovery:task.recovery});task.state='QUEUED';}
      }
    }finally{
      this.controllers.delete(task.id);
      for(const x of locks){try{await this.locks.release(x.key,task.id,x.token);}catch{}}
      task.lockLeases=[];
      if(workerAcquired&&this.workerRegistry){
        const evidenceRefs=[task.evidence?.file,task.acceptedEvidence?.file,task.evidenceManifest?.file].filter(Boolean);
        await this.workerRegistry.release(selectedWorkerId,{
          resultState:task.state,
          verificationState:task.result?.state==='DONE'?'PASS':(task.phase==='VERIFYING'?'FAIL':task.phase||null),
          evidenceRefs
        }).catch(()=>{});
      }
      await this.persist();this.finalizeRun(run).catch(()=>{});this.schedule();
    }
  }

  async monitorDeliveryCI(run,task){
    const deliveryRepo=task.delivery?.repo||run.githubRepo;if(!task.delivery?.sha||!deliveryRepo)return;
    const monitor=new CIMonitor({repo:deliveryRepo,cwd:task.delivery?.taskRoot||run.sourceRoot,pollMs:10000});
    task.ci={state:'WAITING',sha:task.delivery.sha,startedAt:now()};
    await this.persist(); await this.event('ci.waiting',{runId:run.id,taskId:task.id,sha:task.delivery.sha});
    const result=await monitor.wait(task.delivery.sha,{timeoutMs:1800000,onUpdate:async snapshot=>{
      task.ci={...task.ci,state:'RUNNING',lastSnapshot:snapshot,updatedAt:now()};await this.persist();
      await this.emit({schema:'aecp.event/v1',type:'ci.update',at:now(),runId:run.id,taskId:task.id,data:snapshot});
    }});
    task.ci={...task.ci,state:result.passed?'PASSED':'FAILED',finishedAt:now(),runs:result.runs};
    if(result.passed){
      task.state='HUMAN_REQUIRED';
      task.ciEvidence=await this.evidence.write(run.id,task.id+'-ci.json',{sha:task.delivery.sha,runs:result.runs});
      await this.event('ci.passed',{runId:run.id,taskId:task.id,sha:task.delivery.sha,evidence:task.ciEvidence});
      await this.requestApproval(run,task,'GitHub CI passed. Human approval is required before PR merge.');
    }else{
      task.ciFailure=result.runs; task.ciEvidence=await this.evidence.write(run.id,task.id+'-ci-failure.json',{sha:task.delivery.sha,runs:result.runs});
      task.recovery=recommendRecovery({phase:'CI',ciFailure:result.runs,evidence:{sha:task.delivery.sha}});
      await this.evidence.write(run.id,task.id+'-recovery.json',{recovery:task.recovery});
      if(task.recovery.autoEligible && task.attempts < run.maxIterations){
        task.state='REWORK'; task.reworkReason=task.recovery.reason; task.reworkAt=now();
        await this.event('ci.failed_rework',{runId:run.id,taskId:task.id,attempt:task.attempts,runs:result.runs});
        task.state='QUEUED';
        this.schedule();
      }else{
        task.state='BLOCKED';
        await this.event('ci.failed_max_iterations',{runId:run.id,taskId:task.id,attempt:task.attempts,runs:result.runs});
      }
    }
    await this.persist(); await this.finalizeRun(run);
  }

  async approveDelivery(runId,taskId,{by='human',note=''}={}){
    const run=this.state.runs[runId], task=this.state.tasks[taskId];
    if(!run||!task||!task.delivery?.repo||!task.delivery?.branch||!task.delivery?.pr) throw new Error('Delivery approval target not found.');
    if(task.delivery.state!=='DRAFT') throw new Error('Delivery is not awaiting approval.');
    if(task.ci?.state!=='PASSED') throw new Error('Merge is blocked until required CI passes.');
    let approvals=Object.values(this.state.approvals||{}).filter(a=>a.runId===runId&&a.taskId===taskId&&a.state==='APPROVED');
    if(!approvals.length){
      const waiting=Object.values(this.state.approvals||{}).find(a=>a.runId===runId&&a.taskId===taskId&&a.state==='WAITING');
      if(!waiting) throw new Error('Explicit human approval is required before merge.');
      await this.approve(waiting.id,{by, note:note||'Approved from governed delivery action.'});
      approvals=[waiting];
    }
    const mergeRoot=path.resolve(task.delivery?.taskRoot||run.sourceRoot);
    const check=this.policyForRun(run).check({action:'MERGE',path:mergeRoot,approved:true});
    if(!check.allowed) throw new Error(check.reason);
    const gh=await new Promise((resolve,reject)=>{const c=spawn('gh',['pr','merge',String(task.delivery.pr),'--repo',task.delivery.repo,'--squash','--delete-branch'],{cwd:mergeRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';c.stdout.on('data',b=>o+=b);c.stderr.on('data',b=>e+=b);c.on('error',reject);c.on('close',code=>code===0?resolve(o.trim()):reject(new Error((e||o).slice(-3000))));});
    task.delivery.state='MERGED'; task.delivery.mergedAt=now(); task.delivery.mergedBy=by; task.delivery.note=note; task.state='DONE';
    await this.persist(); await this.event('delivery.merged',{runId,taskId,pr:task.delivery.pr,by,note,output:gh}); await this.finalizeRun(run); return task;
  }

  async requestApproval(run,task,reason,action=null){
    const id=uid('approval');
    this.state.approvals[id]={id,runId:run.id,taskId:task.id,state:'WAITING',risk:task.risk||'RED',reason,action:action||null,createdAt:now()};
    task.state='HUMAN_REQUIRED';await this.persist();await this.event('approval.requested',{runId:run.id,taskId:task.id,approvalId:id,risk:task.risk||'RED',reason});
  }

  async finalizeRun(run){
    const tasks=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(Boolean);
    if(!tasks.length) return;
    if(tasks.some(t=>t.state==='HUMAN_REQUIRED')) run.state='HUMAN_REQUIRED';
    else if(tasks.some(t=>['FAILED','BLOCKED','BUDGET_EXHAUSTED'].includes(t.state))) run.state='BLOCKED';
    else if(tasks.every(t=>t.state==='DONE')) run.state='DONE';
    else return;
    run.finishedAt=now();await this.persist();await this.event('mission.finished',{runId:run.id,state:run.state});
  }

  async gitLocal(cwd,args){return await new Promise((resolve,reject)=>{const p=spawn('git',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',b=>o+=b);p.stderr.on('data',b=>e+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(o.trim()):reject(new Error((e||o).slice(-3000))));});}
  async detectRepo(cwd){try{const out=await new Promise((resolve,reject)=>{const p=spawn('gh',['repo','view','--json','nameWithOwner','-q','.nameWithOwner'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',b=>o+=b);p.stderr.on('data',b=>e+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(o.trim()):reject(new Error(e||'gh repo view failed')));});return out||null;}catch{return null;}}
  async status(){
    const s=this.snapshot();
    s.remote=this.remote?.info()||{enabled:false};
    s.webhook=this.webhook?.info()||{enabled:false};
    s.resources=this.resources.state;
    s.adapterSecurity=this.adapterSecurity||auditAdapters();
    s.eventProjection=projectEvents(await this.listEvents(5000));
    if(this.workerRegistry){
      const workers=this.workerRegistry.list();
      const health=await this.providerHealthForRun({
        builderWorkers:workers.map(worker=>worker.id),
        providers:{},
        models:{},
        providerApprovals:{network:false,credential:false}
      }).catch(()=>({}));
      s.workers=workers.map(worker=>({
        ...worker,
        health:health[worker.providerId]?.status||'UNKNOWN',
        healthDetail:health[worker.providerId]?.detail||null
      }));
    }
    return s;
  }
  hasActiveWork(){
    if(this.controllers.size>0) return true;
    return Object.values(this.state?.runs||{}).some(run=>['PLANNING','QUEUED','RUNNING','VERIFYING','REVIEWING','REWORK','PAUSED'].includes(run.state));
  }
  createRemotePairing(){return this.remote.pairing.create()}
  listRemoteDevices(){return this.remote.listDevices()}
  revokeRemoteDevice(deviceId){return this.remote.revokeDeviceId(deviceId)}
  async scanResources(root){return this.resources.scan(root)}
  async ingestExternalEvent(event){const key=event?.idempotencyKey||event?.externalId;if(!key)throw new Error('External event requires idempotencyKey or externalId.');const r=await this.ledger.append({type:'external.received',...event,idempotencyKey:key});if(r.duplicate)return{duplicate:true};await this.event('external.correlated',{externalId:event.externalId||null,correlationId:event.correlationId||null,idempotencyKey:key});return{duplicate:false};}
  async gc(){const removed=await this.contextBus.gc();await this.locks.recover();await this.event('maintenance.gc',{removedCapsules:removed});return{removedCapsules:removed};}
  async replay(runId,limit=500){const events=await this.listEvents(limit);return events.filter(e=>!runId||e.runId===runId);}
  async listEvents(limit=500){
    try{const lines=(await fs.readFile(this.eventFile,'utf8')).trim().split(/\r?\n/).filter(Boolean);return lines.slice(-clamp(limit,1,5000,500)).map(x=>JSON.parse(x));}catch(e){if(e.code==='ENOENT')return[];throw e;}
  }
  async getRun(id){return redactSensitive(this.state.runs[id]||null);}
  async getTask(id){return redactSensitive(this.state.tasks[id]||null);}
  async shutdown(){
    this.shuttingDown=true;
    if(this.scheduler){clearInterval(this.scheduler);this.scheduler=null;}
    for(const c of this.controllers.values())c.abort();
    this.controllers.clear();
    await this.remote?.stop();
    await this.webhook?.stop();
    await this.persist();
    const maintenance=this.maintenanceTask;
    if(maintenance) await maintenance.catch(()=>{});
    await this.persist();
  }
}

module.exports={ControlPlane,STATES,TERMINAL,RISK,compareSchedulerCandidates,schedulerPriority,schedulerRisk};
