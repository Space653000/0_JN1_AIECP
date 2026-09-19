'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { runHarness } = require('./harness.cjs');

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
  }

  async init(){
    await fs.mkdir(this.rootDir,{recursive:true});
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
      for(const taskId of run.taskIds||[]){
        const task=this.state.tasks[taskId];
        if(task?.lease && new Date(task.lease.expiresAt).getTime()<Date.now() && !TERMINAL.has(task.state)){
          task.state='QUEUED'; task.lease=null; task.recoveredAt=now();
        }
      }
    }
    await this.persist();
  }

  async createMission({goal,done,sourceRoot,context='',maxTasks=8,maxIterations=5,maxConcurrency=2,autoStart=true}){
    if(!goal||!done) throw new Error('Goal and Definition of Done are required.');
    const id=uid('mission');
    const run={id,schema:'aecp.mission/v1',goal,done,sourceRoot:path.resolve(sourceRoot),context,maxTasks:clamp(maxTasks,1,8,8),maxIterations:clamp(maxIterations,1,5,5),maxConcurrency:clamp(maxConcurrency,1,8,2),state:'QUEUED',createdAt:now(),updatedAt:now(),taskIds:[],events:[]};
    this.state.runs[id]=run;
    await this.persist();
    await this.event('mission.created',{runId:id,state:run.state,goal});
    if(autoStart) this.schedule();
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
    const c=this.controllers.get(id); if(c) c.abort();
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

  async schedulerTick(){
    for(const run of Object.values(this.state.runs)){
      if(!['QUEUED','RUNNING'].includes(run.state)) continue;
      if(run.state==='QUEUED') run.state='RUNNING';
      const active=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(t=>t&&t.state==='RUNNING').length;
      if(active>=run.maxConcurrency) continue;
      const queued=(run.taskIds||[]).map(id=>this.state.tasks[id]).filter(t=>t&&t.state==='QUEUED').slice(0,run.maxConcurrency-active);
      for(const task of queued) this.executeTask(run,task).catch(()=>{});
    }
    await this.persist();
  }

  schedule(){
    if(this.scheduler) return;
    this.scheduler=setInterval(()=>this.schedulerTick().catch(()=>{}),1000);
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
    await this.persist();await this.event('task.claimed',{runId:run.id,taskId:task.id,lease:task.lease});
    const controller=new AbortController();this.controllers.set(task.id,controller);
    try{
      const subRoot=path.join(this.rootDir,'runs',run.id,task.id);
      const result=await runHarness({goal:run.goal+'\nTask: '+task.title,done:task.acceptance||run.done,context:run.context+'\nOBJECTIVE: '+task.objective,sourceRoot:run.sourceRoot,runRoot:subRoot,maxTasks:1,maxIterations:run.maxIterations,signal:controller.signal,onEvent:async e=>{task.lastEvent=e;task.updatedAt=now();await this.persist();await this.emit({schema:'aecp.event/v1',type:'task.event',at:now(),runId:run.id,taskId:task.id,data:e});}});
      task.result=result;task.state=result.state==='DONE'?'DONE':result.state;task.lease=null;task.finishedAt=now();
      if(task.state==='HUMAN_REQUIRED') await this.requestApproval(run,task,'Harness requested human approval.');
      await this.event('task.finished',{runId:run.id,taskId:task.id,state:task.state});
    }catch(e){
      task.state=controller.signal.aborted?'CANCELLED':'FAILED';task.error=String(e.message||e);task.lease=null;await this.event('task.failed',{runId:run.id,taskId:task.id,error:task.error});
    }finally{
      this.controllers.delete(task.id);await this.persist();this.finalizeRun(run).catch(()=>{});this.schedule();
    }
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

  async status(){return this.snapshot();}
  async listEvents(limit=500){
    try{const lines=(await fs.readFile(this.eventFile,'utf8')).trim().split(/\r?\n/).filter(Boolean);return lines.slice(-clamp(limit,1,5000,500)).map(x=>JSON.parse(x));}catch(e){if(e.code==='ENOENT')return[];throw e;}
  }
  async getRun(id){return this.state.runs[id]||null;}
  async getTask(id){return this.state.tasks[id]||null;}
  async shutdown(){if(this.scheduler)clearInterval(this.scheduler);for(const c of this.controllers.values())c.abort();this.controllers.clear();await this.persist();}
}

module.exports={ControlPlane,STATES,TERMINAL,RISK};
