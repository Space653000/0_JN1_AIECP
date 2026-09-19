'use strict';
const {spawn}=require('node:child_process');
function sh(args,{cwd,timeoutMs=60000}={}){return new Promise((resolve,reject)=>{const c=spawn(args[0],args.slice(1),{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';const t=setTimeout(()=>{try{c.kill()}catch{}},timeoutMs);c.stdout.on('data',b=>o+=b);c.stderr.on('data',b=>e+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(t);code===0?resolve(o.trim()):reject(new Error((e||o).slice(-4000)));});});}
class DeliveryManager{
 constructor({repo,cwd}={}){this.repo=repo;this.cwd=cwd;}
 async branch(worktree,branch){await sh(['git','fetch','origin',branch],{cwd:worktree}).catch(()=>{});await sh(['git','checkout','-B',branch],{cwd:worktree});return branch;}
 async commit(worktree,message){await sh(['git','add','-A'],{cwd:worktree});const status=await sh(['git','status','--porcelain'],{cwd:worktree});if(status)await sh(['git','commit','-m',message],{cwd:worktree});return sh(['git','rev-parse','HEAD'],{cwd:worktree});}
 async push(worktree,branch){return sh(['git','push','-u','origin',branch],{cwd:worktree});}
 async draftPR(worktree,{branch,title,body}){const existing=await sh(['gh','pr','list','--repo',this.repo,'--head',branch,'--state','open','--json','url','-q','.[0].url'],{cwd:worktree}).catch(()=>'' );if(existing)return existing;return sh(['gh','pr','create','--repo',this.repo,'--head',branch,'--base','main','--title',title,'--body',body||'','--draft'],{cwd:worktree});}
}
module.exports={DeliveryManager};