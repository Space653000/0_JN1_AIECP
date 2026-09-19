'use strict';

const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');

function runNpm(args,cwd,timeoutMs=120000){
 return new Promise((resolve,reject)=>{
  const p=spawn(process.platform==='win32'?'npm.cmd':'npm',['--no-fund',...args],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';const timer=setTimeout(()=>{try{p.kill()}catch{};reject(new Error('npm drift scan timed out.'))},timeoutMs);
  p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
  p.on('error',e=>{clearTimeout(timer);reject(e)});
  p.on('close',code=>{clearTimeout(timer);resolve({code,stdout:out,stderr:err})});
 });
}

async function scan(root,{security=true,outdated=false}={}){
 const result={root:path.resolve(root),ok:true,security:null,outdated:null,findings:[],scannedAt:new Date().toISOString()};
 try{await fs.access(path.join(root,'package.json'))}catch{return {...result,skipped:true,reason:'package.json not found'}}

 if(security){
  try{
   const r=await runNpm(['audit','--json'],root);
   let data=null;try{data=JSON.parse(r.stdout)}catch{}
   const vulnerabilities=data?.metadata?.vulnerabilities||{};
   result.security={code:r.code,vulnerabilities};
   const high=Number(vulnerabilities.high||0)+Number(vulnerabilities.critical||0);
   if(high>0){result.ok=false;result.findings.push({severity:'ERROR',type:'HIGH_OR_CRITICAL_NPM_VULNERABILITY',count:high,vulnerabilities})}
  }catch(e){result.findings.push({severity:'WARN',type:'SECURITY_SCAN_UNAVAILABLE',message:String(e.message||e)})}
 }
 if(outdated){
  try{
   const r=await runNpm(['outdated','--json'],root);
   let data={};try{data=JSON.parse(r.stdout||'{}')}catch{}
   result.outdated={code:r.code,packages:data};
   const count=Object.keys(data||{}).length;
   if(count>0)result.findings.push({severity:'INFO',type:'DEPENDENCIES_OUTDATED',count});
  }catch(e){result.findings.push({severity:'WARN',type:'OUTDATED_SCAN_UNAVAILABLE',message:String(e.message||e)})}
 }
 return result;
}

module.exports={scan};
