'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
class MaintenanceManager{
 constructor({locks,evidence,contextBus}={}){this.locks=locks;this.evidence=evidence;this.contextBus=contextBus}
 async run({evidenceRetentionDays=30,maxEvidenceRuns=100}={}){const result={startedAt:new Date().toISOString(),locksRecovered:0,capsulesRemoved:0,evidenceRemoved:0};const before=this.locks.list().length;await this.locks.recover();result.locksRecovered=Math.max(0,before-this.locks.list().length);result.capsulesRemoved=await this.contextBus.gc();let entries=[];try{entries=await fs.readdir(this.evidence.root,{withFileTypes:true})}catch{return result}const cutoff=Date.now()-evidenceRetentionDays*86400000;const runs=[];for(const e of entries){if(!e.isDirectory())continue;const p=path.join(this.evidence.root,e.name);try{const st=await fs.stat(p);runs.push({p,mtime:st.mtimeMs})}catch{}}runs.sort((a,b)=>b.mtime-a.mtime);for(const r of runs.slice(maxEvidenceRuns)){if(r.mtime<cutoff){await fs.rm(r.p,{recursive:true,force:true});result.evidenceRemoved++}}result.finishedAt=new Date().toISOString();return result}
}
module.exports={MaintenanceManager};