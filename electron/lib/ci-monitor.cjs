'use strict';
const {spawn}=require('node:child_process');
function gh(args,{cwd,timeoutMs=30000}={}){return new Promise((resolve,reject)=>{const c=spawn('gh',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';const t=setTimeout(()=>{try{c.kill()}catch{}},timeoutMs);c.stdout.on('data',b=>o+=b);c.stderr.on('data',b=>e+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(t);if(code!==0)reject(new Error((e||o||'gh failed').slice(-4000)));else resolve(o.trim());});});}
class CIMonitor{
 constructor({repo,cwd,pollMs=10000}={}){this.repo=repo;this.cwd=cwd;this.pollMs=pollMs;this.timer=null;this.running=false;}
 async runs(sha){const raw=await gh(['run','list','--repo',this.repo,'--commit',sha,'--limit','20','--json','databaseId,status,conclusion,name,url,headSha'],{cwd:this.cwd});return raw?JSON.parse(raw):[];}
 async wait(sha,{timeoutMs=1800000,onUpdate=async()=>{}}={}){const started=Date.now();this.running=true;try{for(;;){const runs=await this.runs(sha);await onUpdate({sha,runs});const relevant=runs.filter(x=>x.headSha===sha);if(relevant.length&&relevant.every(x=>x.status==='completed'))return{passed:relevant.every(x=>x.conclusion==='success'),runs:relevant};if(Date.now()-started>timeoutMs)throw new Error('CI monitor timed out.');await new Promise(r=>setTimeout(r,this.pollMs));}}finally{this.running=false;}}
}
module.exports={CIMonitor};