'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { runHarness, safeJson } = require('./harness.cjs');
const { SecurityPolicy } = require('./security-policy.cjs');
const { LockManager } = require('./lock-manager.cjs');
const { EvidenceManager } = require('./evidence-manager.cjs');
const { ContextBus } = require('./context-bus.cjs');
const { ProviderRouter } = require('./provider-router.cjs');
const { DeliveryManager } = require('./delivery.cjs');
const { CIMonitor } = require('./ci-monitor.cjs');

const SCHEMA='aecp.control-plane/v1';
const STATES=Object.freeze(['PLANNING','QUEUED','RUNNING','VERIFYING','REVIEWING','REWORK','DONE','BLOCKED','HUMAN_REQUIRED','FAILED','CANCELLED','PAUSED']);
const TERMINAL=new Set(['DONE','BLOCKED','HUMAN_REQUIRED','FAILED','CANCELLED']);
const RISK={GREEN:0,YELLOW:1,RED:2};

function uid(prefix){return prefix+'-'+Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');}
function now(){return new Date().toISOString();}
function clamp(n,min,max,d){const x=Number(n);return Number.isFinite(x)?Math.max(min,Math.min(max,x)):d;}

class ControlPlane {
  constructor({rootDir, emit=async()=>{}}={}) {
    this.rootDir=path.resolve(rootDir);
    this.file=path.join(this.rootDir,'control-plane.json');
    this.eventFile=path.join(this.rootDir,'events.jsonl');
    this.emit=emit;
    this.state=null;
    this.controllers=new Map();
    this.scheduler=null;
    this.policy=new SecurityPolicy({allowRoots:[this.rootDir]});
    this.locks=new LockManager(path.join(this.rootDir,'locks'));
    this.evidence=new EvidenceManager(path.join(this.rootDir,'evidence'));
    this.contextBus=new ContextBus(this.rootDir);
    this.providers=new ProviderRouter();
    this.delivery=new DeliveryManager({repo:null,cwd:this.rootDir});
  }

  async init(){
    await fs.mkdir(this.rootDir,{recursive:true});
    await this.locks.init(); await this.evidence.init(); await this.contextBus.init();
    try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){
      if(e.code!=='ENOENT') throw e;
      this.state={schema:SCHEMA,version:1,runs:{},tasks:{},agents:{},approvals:{},locks:{},updatedAt:now()};
      await this.persist();
    }
    await this.recover();
    return this.snapshot();
  }

  async persist(){
    this.state.updatedAt=now();
    const tmp=this.file+'.tmp-'+process.pid;
    await fs.writeFile(tmp,JSON.stringify(this.state,null,2),'utf8');
    await fs.rename(tmp,this.file);
  }

  async event(type,data={}){
    const e={schema:'aecp.event/v1',id:uid('evt'),at:now(),type,...data};
    await fs.appendFile(this.eventFile,JSON.stringify(e)+'\n','utf8');
    this.state.runs[data.runId]?.events?.push(e);
    await this.persist();
    await this.emit(e);
    return e;
  }

  snapshot(){
    return {schema:SCHEMA,updatedAt:this.state?.updatedAt,runs:Object.values(this.state?.runs||{}),tasks:Object.values(this.state?.tasks||{}),agents:Object.values(this.state?.agents||{}),approvals:Object.values(this.state?.approvals||{}),locks:Object.values(this.state?.locks||{})};
  }

  async recover(){
    for(const run of Object.values(this.state.runs||{})){
      if(run.state==='RUNNING' && !this.controllers.has(run.id)){
        run.state='PAUSED'; run.recovery={reason:'process-restart',at:now()};
      }
      if(run.state==='PAUSED' && run.recovery?.reason==='process-restart' && run.autoResume){ run.state='QUEUED'; run.recovery.resumedAt=now(); }
      for(const taskId of run.taskIds||[]){
        const task=this.state.tasks[taskId];
        if(task?.lease && new Date(task.lease.expiresAt).getTime()<Date.now() && !TERMINAL.has(task.state)){
          task.state='QUEUED'; task.lease=null; task.recoveredAt=now();
        }
      }
    }
    await this.persist();
  }

  async planMission(run){
    const prompt=[
      'You are the AECP Mission Planner.',
      'Return ONLY JSON: {"tasks":[{"title":"...","objective":"...","acceptance":"...","dependencies":[],"risk":"GREEN|YELLOW|RED"}]}',
      'Create small independent engineering tasks. Do not invent permissions or credentials.',
      'GOAL:\n'+run.goal,
      'DEFINITION OF DONE:\n'+run.done,
      'CONTEXT:\n'+run.context
    ].join('\n\n');
    const out=await new Promise((resolve,reject)=>{
      const child=spawn('claude',['-p',prompt,'--output-format','json'],{cwd:run.sourceRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';const timer=setTimeout(()=>{try{child.kill()}catch{};reject(new Error('Mission planner timed out.'));},180000);
      child.stdout.on('data',b=>{stdout+=b.toString()});
      child.stderr.on('data',b=>{stderr+=b.toString()});
      child.on('error',e=>{clearTimeout(timer);reject(e)});
      child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error((stderr||stdout).slice(-3000)));else resolve(stdout)});
    });
    const plan=safeJson(out);
    const tasks=Array.isArray(plan?.tasks)?plan.tasks.slice(0,run.maxTasks):[];
    if(!tasks.length) throw new Error('Planner returned no tasks.');
    for(const item of tasks) await this.enqueueTask(run,{title:String(item.title||'Task'),objective:String(item.objective||''),acceptance:String(item.acceptance||run.done),dependencies:Array.isArray(item.dependencies)?item.dependencies:[],risk:['GREEN','YELLOW','RED'].includes(item.risk)?item.risk:'YELLOW'});
    run.plannedAt=now();run.plan=plan;await this.persist();await this.event('mission.planned',{runId:run.id,taskCount:tasks.length});
    return tasks;
  }

  async createMission({goal,done,sourceRoot,context='',maxTasks=8,maxIterations=5,maxConcurrency=2,autoStart=true,autoResume=true,delivery=false,githubRepo=null}){
    if(!goal||!done) throw new Error('Goal and Definition of Done are required.');
    const id=uid('mission');
    const run={id,schema:'aecp.mission/v1',goal,done,sourceRoot:path.resolve(sourceRoot),context,maxTasks:clamp(maxTasks,1,8,8),maxIterations:clamp(maxIterations,1,5,5),maxConcurrency:clamp(maxConcurrency,1,8,2),autoResume:Boolean(autoResume),delivery:Boolean(delivery),githubRepo:githubRepo||null,state:'QUEUED',createdAt:now(),updatedAt:now(),taskIds:[],events:[]};
    this.state.runs[id]=run;
    await this.persist();
    await this.event('mission.created',{runId:id,state:run.state,goal});
    if(autoStart) { await this.planMission(run); await this.startMission(id); }
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
    for(const taskId of run.taskIds||[]){ const c=this.controllers.get(taskId); if(c) c.abort(); }
    await this.persist(); await this.event('mission.paused',{runId:id}); return run;
  }

  async cancelMission(id){
    const run=this.state.runs[id]; if(!run) throw new Error('Mission not found.');
    for(const taskId of run.taskIds||[]){const c=this.controllers.get(taskId);if(c)c.abort();}
    run.state='CANCELLED'; run.cancelledAt=now();
    await this.persist(); await this.event('mission.cancelled',{runId:id}); return run;
  }

  async approve(id,{by='human',note=''}={}){
    const a=this.state.approvals[id]; if(!a) throw new Error('Approval not found.');
    if(a.state!=='WAITING') throw new Error('Approval is not waiting.');
    a.state='APPROVED'; a.decidedAt=now(); a.decidedBy=by; a.note=note;
    const task=this.state.tasks[a.taskId]; if(task){task.state='QUEUED';task.lease=null;}
    await this.persist(); await this.event('approval.approved',{runId:a.runId,taskId:a.taskId,approvalId:id});
    this.schedule(); return a;
  }

  async reject(id,{by='human',note='Rejected'}={}){
    const a=this.state.approvals[id]; if(!a) throw new Error('Approval not found.');
    a.state='REJECTED';a.decidedAt=now();a.decidedBy=by;a.note=note;
    const task=this.state.tasks[a.taskId]; if(task) task.state='BLOCKED';
    await this.persist(); await this.event('approval.rejected',{runId:a.runId,taskId:a.taskId,approvalId:id});
    return a;
  }

  async heartbeat(){for(const run of Object.values(this.state.runs||{})){for(const taskId of run.taskIds||[]){const t=this.state.tasks[taskId];if(t?.state==='RUNNING'&&t.lease){t.lease.expiresAt=new Date(Date.now()+15*60*1000).toISOString();t.heartbeatAt=now();}}}await this.persist();}

  async schedulerTick(){
    for(const run of Object.values(this.state.runs)){
      if(!['QUEUED','RUNNING'].includes(run.state)) continue;
      if(run.state==='QUEUED') run.state='RUNNING';
      const active=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(t=>t&&t.state==='RUNNING').length;
      if(active>=run.maxConcurrency) continue;
      const queued=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(t=>t&&t.state==='QUEUED' && (t.dependencies||[]).every(d=>{const dep=(run.taskIds||[]).map(x=>this.state.tasks[x]).find(x=>x.id===d||x.title===d);return dep?dep.state==='DONE':true;})).slice(0,run.maxConcurrency-active);
      for(const task of queued) this.executeTask(run,task).catch(()=>{});
    }
    await this.persist();
  }

  schedule(){
    if(this.scheduler) return;
    this.scheduler=setInterval(()=>{this.schedulerTick().catch(()=>{});this.heartbeat().catch(()=>{});},1000);
    this.scheduler.unref?.();
    this.schedulerTick().catch(()=>{});
  }

  async enqueueTask(run,task){
    const id=uid('task');
    const t={...task,id,runId:run.id,state:'QUEUED',createdAt:now(),updatedAt:now(),attempts:0,lease:null};
    this.state.tasks[id]=t;run.taskIds.push(id);
    await this.persist();await this.event('task.queued',{runId:run.id,taskId:id,title:t.title});
    return t;
  }

  async executeTask(run,task){
    if(task.state!=='QUEUED'||run.state!=='RUNNING') return;
    task.state='RUNNING';task.attempts++;task.startedAt=now();
    task.lease={id:uid('lease'),owner:process.pid,expiresAt:new Date(Date.now()+15*60*1000).toISOString()};
    const subRoot=path.join(this.rootDir,'runs',run.id,task.id);
    const lockKey='workspace:'+subRoot.toLowerCase();
    let lock=null;
    try { lock=await this.locks.acquire(lockKey,String(process.pid),{meta:{runId:run.id,taskId:task.id}}); } catch(e) { task.state='QUEUED'; task.lease=null; await this.event('task.waiting_for_lock',{runId:run.id,taskId:task.id}); return; }
    await this.persist();await this.event('task.claimed',{runId:run.id,taskId:task.id,lease:task.lease});
    const controller=new AbortController();this.controllers.set(task.id,controller);
    try{
      const policyCheck=this.policy.check({action:'WRITE',path:subRoot});
      if(!policyCheck.allowed) throw Object.assign(new Error(policyCheck.reason),{code:policyCheck.requiresApproval?'APPROVAL_REQUIRED':'POLICY_DENIED'});
      const result=await runHarness({goal:run.goal+'\nTask: '+task.title,done:task.acceptance||run.done,context:run.context+'\nOBJECTIVE: '+task.objective,sourceRoot:run.sourceRoot,runRoot:subRoot,maxTasks:1,maxIterations:run.maxIterations,signal:controller.signal,onEvent:async e=>{task.lastEvent=e;task.updatedAt=now();await this.evidence.appendEvent(run.id,e).catch(()=>{});await this.persist();await this.emit({schema:'aecp.event/v1',type:'task.event',at:now(),runId:run.id,taskId:task.id,data:e});}});
      task.result=result;task.state=result.state==='DONE'?'DONE':result.state;task.lease=null;task.finishedAt=now();
      if(task.state==='DONE' && run.delivery){
        try{
          const repo=run.githubRepo || await this.detectRepo(run.sourceRoot); if(!repo) throw new Error('GitHub repository could not be detected.');
          const branch='agent/'+task.id;
          const delivery=new DeliveryManager({repo,cwd:run.sourceRoot});
          await delivery.branch(result.worktree,branch);
          const sha=await delivery.commit(result.worktree,'feat: '+task.title);
          await delivery.push(result.worktree,branch);
          task.delivery={repo,branch,sha,pr:await delivery.draftPR(result.worktree,{branch,title:'AECP: '+task.title,body:'Generated by AECP. Deterministic verification and reviewer passed. Human approval remains required for promotion.'}),state:'DRAFT'};
          await this.event('delivery.pr_created',{runId:run.id,taskId:task.id,delivery:task.delivery});
          this.monitorDeliveryCI(run,task).catch(async e=>{task.ciError=String(e.message||e);await this.event('delivery.ci_monitor_error',{runId:run.id,taskId:task.id,error:task.ciError});});
        }catch(e){task.deliveryError=String(e.message||e);await this.event('delivery.blocked',{runId:run.id,taskId:task.id,error:task.deliveryError});}
      }
      if(result.state==='DONE' && result.patch) { task.evidence=await this.evidence.write(run.id,task.id+'-result.json',{task,result}); }
      if(result.state==='DONE') { task.resultCapsule=await this.contextBus.write('result',{runId:run.id,taskId:task.id,state:task.state,evidence:task.evidence||null,verification:result.tasks}); }
      if(task.state==='HUMAN_REQUIRED') await this.requestApproval(run,task,'Harness requested human approval.');
      await this.event('task.finished',{runId:run.id,taskId:task.id,state:task.state});
    }catch(e){
      task.state=controller.signal.aborted?'CANCELLED':'FAILED';task.error=String(e.message||e);task.lease=null;await this.event('task.failed',{runId:run.id,taskId:task.id,error:task.error});
    }finally{
      this.controllers.delete(task.id); if(lock){try{await this.locks.release(lockKey,String(process.pid),lock.token);}catch{}} await this.persist();this.finalizeRun(run).catch(()=>{});this.schedule();
    }
  }

  async monitorDeliveryCI(run,task){
    if(!task.delivery?.sha||!run.githubRepo)return;
    const monitor=new CIMonitor({repo:run.githubRepo,cwd:run.sourceRoot,pollMs:10000});
    task.ci={state:'WAITING',sha:task.delivery.sha,startedAt:now()};
    await this.persist(); await this.event('ci.waiting',{runId:run.id,taskId:task.id,sha:task.delivery.sha});
    const result=await monitor.wait(task.delivery.sha,{timeoutMs:1800000,onUpdate:async snapshot=>{
      task.ci={...task.ci,state:'RUNNING',lastSnapshot:snapshot,updatedAt:now()};await this.persist();
      await this.emit({schema:'aecp.event/v1',type:'ci.update',at:now(),runId:run.id,taskId:task.id,data:snapshot});
    }});
    task.ci={...task.ci,state:result.passed?'PASSED':'FAILED',finishedAt:now(),runs:result.runs};
    if(result.passed){
      await this.event('ci.passed',{runId:run.id,taskId:task.id,sha:task.delivery.sha});
    }else{
      task.ciFailure=result.runs;
      if(task.attempts < run.maxIterations){
        task.state='REWORK'; task.reworkReason='GitHub CI failed'; task.reworkAt=now();
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
    const approvals=Object.values(this.state.approvals||{}).filter(a=>a.runId===runId&&a.taskId===taskId&&a.state==='APPROVED');
    if(!approvals.length) throw new Error('Explicit human approval is required before merge.');
    const check=this.policy.check({action:'MERGE',path:run.sourceRoot,approved:true});
    if(!check.allowed) throw new Error(check.reason);
    const gh=await new Promise((resolve,reject)=>{const c=spawn('gh',['pr','merge',String(task.delivery.pr),'--repo',task.delivery.repo,'--squash','--delete-branch'],{cwd:run.sourceRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';c.stdout.on('data',b=>o+=b);c.stderr.on('data',b=>e+=b);c.on('error',reject);c.on('close',code=>code===0?resolve(o.trim()):reject(new Error((e||o).slice(-3000))));});
    task.delivery.state='MERGED'; task.delivery.mergedAt=now(); task.delivery.mergedBy=by; task.delivery.note=note; task.state='DONE';
    await this.persist(); await this.event('delivery.merged',{runId,taskId,pr:task.delivery.pr,by,note,output:gh}); await this.finalizeRun(run); return task;
  }

  async requestApproval(run,task,reason){
    const id=uid('approval');
    this.state.approvals[id]={id,runId:run.id,taskId:task.id,state:'WAITING',risk:task.risk||'RED',reason,createdAt:now()};
    task.state='HUMAN_REQUIRED';await this.persist();await this.event('approval.requested',{runId:run.id,taskId:task.id,approvalId:id,risk:task.risk||'RED',reason});
  }

  async finalizeRun(run){
    const tasks=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(Boolean);
    if(!tasks.length) return;
    if(tasks.some(t=>t.state==='HUMAN_REQUIRED')) run.state='HUMAN_REQUIRED';
    else if(tasks.some(t=>['FAILED','BLOCKED'].includes(t.state))) run.state='BLOCKED';
    else if(tasks.every(t=>t.state==='DONE')) run.state='DONE';
    else return;
    run.finishedAt=now();await this.persist();await this.event('mission.finished',{runId:run.id,state:run.state});
  }

  async detectRepo(cwd){try{const out=await new Promise((resolve,reject)=>{const p=spawn('gh',['repo','view','--json','nameWithOwner','-q','.nameWithOwner'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',b=>o+=b);p.stderr.on('data',b=>e+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(o.trim()):reject(new Error(e||'gh repo view failed')));});return out||null;}catch{return null;}}
  async status(){return this.snapshot();}
  async gc(){const removed=await this.contextBus.gc();await this.locks.recover();await this.event('maintenance.gc',{removedCapsules:removed});return{removedCapsules:removed};}
  async replay(runId,limit=500){const events=await this.listEvents(limit);return events.filter(e=>!runId||e.runId===runId);}
  async listEvents(limit=500){
    try{const lines=(await fs.readFile(this.eventFile,'utf8')).trim().split(/\r?\n/).filter(Boolean);return lines.slice(-clamp(limit,1,5000,500)).map(x=>JSON.parse(x));}catch(e){if(e.code==='ENOENT')return[];throw e;}
  }
  async getRun(id){return this.state.runs[id]||null;}
  async getTask(id){return this.state.tasks[id]||null;}
  async shutdown(){if(this.scheduler)clearInterval(this.scheduler);for(const c of this.controllers.values())c.abort();this.controllers.clear();await this.persist();}
}

module.exports={ControlPlane,STATES,TERMINAL,RISK};
