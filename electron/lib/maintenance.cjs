'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {scan:scanDrift}=require('./drift-scanner.cjs');
const {audit:auditAdapters}=require('./adapter-security-audit.cjs');
const {scan:scanDependencies}=require('./dependency-drift-scanner.cjs');

function git(args,cwd){return new Promise((resolve,reject)=>{const p=spawn('git',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',b=>o+=b);p.stderr.on('data',b=>e+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(o.trim()):reject(new Error((e||o).trim()||'git failed')));});}

class MaintenanceManager{
 constructor({locks,evidence,contextBus}={}){this.locks=locks;this.evidence=evidence;this.contextBus=contextBus}
 async run({evidenceRetentionDays=30,maxEvidenceRuns=100,maxWorktreeCleanups=20,worktrees=[],driftRoot=null,driftRoots=[],dependencyRoots=[],dependencyScan=false}={}){
  const roots=[...new Set([...(driftRoots||[]),...(driftRoot?[driftRoot]:[])].filter(Boolean).map(x=>path.resolve(x)))];
  const result={startedAt:new Date().toISOString(),locksRecovered:0,capsulesRemoved:0,evidenceRemoved:0,worktreesRemoved:0,worktreesDeferred:0,drift:[],adapterSecurity:auditAdapters(),dependencyDrift:[]};
  const before=this.locks.list().length;
  await this.locks.recover();
  result.locksRecovered=Math.max(0,before-this.locks.list().length);
  result.capsulesRemoved=await this.contextBus.gc();
  let entries=[];
  try{entries=await fs.readdir(this.evidence.root,{withFileTypes:true})}catch{entries=[]}
  const cutoff=Date.now()-evidenceRetentionDays*86400000;
  const runs=[];
  for(const e of entries){
   if(!e.isDirectory())continue;
   const p=path.join(this.evidence.root,e.name);
   try{const st=await fs.stat(p);runs.push({p,mtime:st.mtimeMs})}catch{}
  }
  runs.sort((a,b)=>b.mtime-a.mtime);
  for(const r of runs.slice(maxEvidenceRuns)){
   if(r.mtime<cutoff){await fs.rm(r.p,{recursive:true,force:true});result.evidenceRemoved++}
  }
  // Bounded per pass: entries whose folder is gone and whose git registration is already cleared cost one listing per
  // repository, and at most maxWorktreeCleanups real removals are attempted; the rest waits for the next pass.
  const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
  const registered=new Map();
  const isRegistered=async w=>{
   const key=norm(w.repoRoot);
   if(!registered.has(key)){
    try{const out=await git(['worktree','list','--porcelain'],w.repoRoot);registered.set(key,new Set(String(out).split(/\r?\n/).filter(line=>line.startsWith('worktree ')).map(line=>norm(line.slice(9)))))}
    catch{registered.set(key,null)}
   }
   const known=registered.get(key);
   return known===null?true:known.has(norm(w.worktree));
  };
  const budget=Math.max(1,Number(maxWorktreeCleanups)||20);
  const touched=new Set();
  let attempted=0;
  for(const w of worktrees){
   if(!w?.worktree||!w?.repoRoot)continue;
   const exists=await fs.stat(w.worktree).then(()=>true,()=>false);
   if(!exists&&!(await isRegistered(w)))continue;
   if(attempted>=budget){result.worktreesDeferred++;continue}
   attempted++;touched.add(path.resolve(w.repoRoot));
   try{await git(['worktree','remove','--force',w.worktree],w.repoRoot);result.worktreesRemoved++}catch{}
  }
  for(const root of touched)try{await git(['worktree','prune'],root)}catch{}
  for(const root of roots){
   try{result.drift.push({root,...await scanDrift(root)})}
   catch(e){result.drift.push({root,ok:false,findings:[{severity:'ERROR',type:'SCAN_FAILED',message:String(e.message||e)}]})}
  }
  if(dependencyScan){for(const root of [...new Set((dependencyRoots||[]).filter(Boolean).map(x=>path.resolve(x)))]){try{result.dependencyDrift.push(await scanDependencies(root,{security:true,outdated:false}))}catch(e){result.dependencyDrift.push({root,ok:false,findings:[{severity:'ERROR',type:'DEPENDENCY_SCAN_FAILED',message:String(e.message||e)}]})}}}
  result.finishedAt=new Date().toISOString();
  return result
 }
}
module.exports={MaintenanceManager};
