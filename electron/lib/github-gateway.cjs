'use strict';
const {spawn}=require('node:child_process');
function gh(args,{cwd,timeoutMs=30000}={}){return new Promise((resolve,reject)=>{const c=spawn('gh',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';const t=setTimeout(()=>{try{c.kill()}catch{}},timeoutMs);c.stdout.on('data',b=>o+=b);c.stderr.on('data',b=>e+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(t);if(code!==0)reject(new Error((e||o||'gh failed').slice(-4000)));else resolve(o.trim());});});}
class GitHubGateway{
 constructor({repo,cwd}={}){this.repo=repo;this.cwd=cwd;}
 async auth(){return gh(['auth','status'],{cwd:this.cwd});}
 async currentSha(){return gh(['rev-parse','HEAD'],{cwd:this.cwd});}
 async createBranch(branch,base='HEAD'){const sha=await this.currentSha();await gh(['api','repos/'+this.repo+'/git/refs','-f','ref=refs/heads/'+branch,'-f','sha='+sha],{cwd:this.cwd});return branch;}
 async commitAll(message){await gh(['add','-A'],{cwd:this.cwd});await gh(['commit','-m',message],{cwd:this.cwd});return this.currentSha();}
 async push(branch){return gh(['push','-u','origin',branch],{cwd:this.cwd});}
 async createPR({branch,base='main',title,body,draft=true}){return gh(['pr','create','--repo',this.repo,'--head',branch,'--base',base,'--title',title,'--body',body||'',...(draft?['--draft']:[])],{cwd:this.cwd});}
 async checks(branch){return gh(['pr','checks',branch,'--repo',this.repo,'--json','name,state,bucket,workflow'],{cwd:this.cwd});}
 async workflowRuns(sha){return gh(['run','list','--repo',this.repo,'--commit',sha,'--json','databaseId,status,conclusion,name,url,headSha'],{cwd:this.cwd});}
 async mergePR(number,method='squash'){return gh(['pr','merge',String(number),'--repo',this.repo,'--'+method,'--delete-branch'],{cwd:this.cwd});}
}
module.exports={GitHubGateway};