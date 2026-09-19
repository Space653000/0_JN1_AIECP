'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {scan:scanDrift}=require('./drift-scanner.cjs');
function git(args,cwd){return new Promise((resolve,reject)=>{const p=spawn('git',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',b=>o+=b);p.stderr.on('data',b=>e+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(o.trim()):reject(new Error((e||o).trim()||'git failed')));});}
class MaintenanceManager{
 constructor({locks,evidence,contextBus}={}){this.locks=locks;this.evidence=evidence;this.contextBus=contextBus}
 async run({evidenceRetentionDays=30,maxEvidenceRuns=100,worktrees=[],driftRoot=null}={}){const result={startedAt:new Date().toISOString(),locksRecovered:0,capsulesRemoved:0,evidenceRemoved:0,drift:null};const before=this.locks.list().length;await this.locks.recover();result.locksRecovered=Math.max(0,before-this.locks.list().length);result.capsulesRemoved=await this.contextBus.gc();let entries=[];try{entries=await fs.readdir(this.evidence.root,{withFileTypes:true})}catch{return result}const cutoff=Date.now()-evidenceRetentionDays*86400000;const runs=[];for(const e of entries){if(!e.isDirectory())continue;const p=path.join(this.evidence.root,e.name);try{const st=await fs.stat(p);runs.push({p,mtime:st.mtimeMs})}catch{}}runs.sort((a,b)=>b.mtime-a.mtime);for(const r of runs.slice(maxEvidenceRuns)){if(r.mtime<cutoff){await fs.rm(r.p,{recursive:true,force:true});result.evidenceRemoved++}}for(const w of worktrees){if(!w?.worktree||!w?.repoRoot)continue;try{await git(['worktree','remove','--force',w.worktree],w.repoRoot);result.worktreesRemoved=(result.worktreesRemoved||0)+1}catch{}}
   for(const w of worktrees){if(w?.repoRoot)try{await git(['worktree','prune'],w.repoRoot)}catch{}}
   if(driftRoot) result.drift=await scanDrift(path.resolve(driftRoot));
   result.finishedAt=new Date().toISOString();return result}
}
module.exports={MaintenanceManager};