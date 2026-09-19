'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
function run(args,cwd){return new Promise((resolve,reject)=>{const p=spawn('git',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',b=>o+=b);p.stderr.on('data',b=>e+=b);p.on('error',reject);p.on('close',c=>c===0?resolve(o.trim()):reject(new Error((e||o).trim()||'git failed')));});}
async function gitRoot(p){try{return await run(['rev-parse','--show-toplevel'],p)}catch{return null}}
class ResourceManager{
 constructor(root){this.root=path.resolve(root);this.file=path.join(this.root,'resources.json');this.state={schema:'aecp.resources/v1',workspaces:{},repositories:{}};}
 async init(){await fs.mkdir(this.root,{recursive:true});try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;await this.persist()}return this.state}
 async persist(){const t=this.file+'.tmp';await fs.writeFile(t,JSON.stringify(this.state,null,2));await fs.rename(t,this.file)}
 async scan(root){const base=path.resolve(root),repos=[],seen=new Set();const add=async p=>{const r=await gitRoot(p);if(!r)return;const rp=path.resolve(r),key=rp.toLowerCase();if(seen.has(key))return;seen.add(key);let remote='';try{remote=await run(['remote','get-url','origin'],rp)}catch{}let branch='';try{branch=await run(['branch','--show-current'],rp)}catch{}repos.push({id:'repo-'+crypto.createHash('sha1').update(key).digest('hex').slice(0,12),path:rp,branch:branch||'(detached)',remote,updatedAt:new Date().toISOString()})};await add(base);let entries=[];try{entries=await fs.readdir(base,{withFileTypes:true})}catch{return repos}for(const e of entries){if(!e.isDirectory()||e.name.startsWith('.'))continue;await add(path.join(base,e.name));if(repos.length>=32)break}this.state.workspaces[base]={root:base,repositories:repos,updatedAt:new Date().toISOString()};for(const r of repos)this.state.repositories[r.id]=r;await this.persist();return repos}
 bindTask(task,{repositories=[]}={}){const refs=repositories.filter(Boolean).map(x=>path.resolve(x));task.resources={repositories:refs,resourceCount:refs.length};return task}
}
module.exports={ResourceManager};