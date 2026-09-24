'use strict';
const {spawn}=require('node:child_process');

function sh(args,{cwd,timeoutMs=60000}={}){
 return new Promise((resolve,reject)=>{
  const c=spawn(args[0],args.slice(1),{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let o='',e='',settled=false,timedOut=false;
  const t=setTimeout(()=>{timedOut=true;try{c.kill()}catch{}},timeoutMs);
  c.stdout.on('data',b=>o+=b);
  c.stderr.on('data',b=>e+=b);
  c.on('error',err=>{if(settled)return;settled=true;clearTimeout(t);reject(err);});
  c.on('close',code=>{
   if(settled)return;
   settled=true;clearTimeout(t);
   if(code===0)return resolve(o.trim());
   const err=new Error((e||o||'delivery command failed').slice(-4000));
   err.code=timedOut?'COMMAND_TIMEOUT':'COMMAND_FAILED';
   err.exitCode=code;
   reject(err);
  });
 });
}

class DeliveryManager{
 constructor({repo,cwd,runner=sh}={}){this.repo=repo;this.cwd=cwd;this.runner=runner;}

 async branch(worktree,branch){
  await this.runner(['git','fetch','origin',branch],{cwd:worktree}).catch(()=>{});
  await this.runner(['git','checkout','-B',branch],{cwd:worktree});
  return branch;
 }

 async commit(worktree,message){
  await this.runner(['git','add','-A'],{cwd:worktree});
  const status=await this.runner(['git','status','--porcelain'],{cwd:worktree});
  if(status)await this.runner(['git','commit','-m',message],{cwd:worktree});
  return this.runner(['git','rev-parse','HEAD'],{cwd:worktree});
 }

 async remoteBranchSha(worktree,branch){
  const raw=await this.runner(['git','ls-remote','--heads','origin',branch],{cwd:worktree}).catch(()=> '');
  return String(raw||'').trim().split(/\s+/)[0]||null;
 }

 async push(worktree,branch){
  const localSha=(await this.runner(['git','rev-parse','HEAD'],{cwd:worktree})).trim();
  try{
   return await this.runner(['git','push','-u','origin',branch],{cwd:worktree});
  }catch(error){
   const remoteSha=await this.remoteBranchSha(worktree,branch);
   if(remoteSha&&remoteSha===localSha){
    return `RECONCILED_REMOTE_PUSH ${branch} ${localSha}`;
   }
   throw error;
  }
 }

 async existingPR(worktree,branch){
  return this.runner(
   ['gh','pr','list','--repo',this.repo,'--head',branch,'--state','open','--json','url','-q','.[0].url'],
   {cwd:worktree}
  ).catch(()=> '');
 }

 async draftPR(worktree,{branch,title,body}){
  const existing=await this.existingPR(worktree,branch);
  if(existing)return existing;
  try{
   return await this.runner(
    ['gh','pr','create','--repo',this.repo,'--head',branch,'--base','main','--title',title,'--body',body||'','--draft'],
    {cwd:worktree}
   );
  }catch(error){
   const reconciled=await this.existingPR(worktree,branch);
   if(reconciled)return reconciled;
   throw error;
  }
 }
}

module.exports={DeliveryManager};
