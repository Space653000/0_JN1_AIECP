'use strict';
const {spawn}=require('node:child_process');
// Runs one fixed program with an argv array (never a shell string). `tool` is only ever 'git' or 'gh'.
function exec(tool,args,{cwd,timeoutMs=30000}={}){return new Promise((resolve,reject)=>{const c=spawn(tool,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';const t=setTimeout(()=>{try{c.kill()}catch{}},timeoutMs);c.stdout.on('data',b=>o+=b);c.stderr.on('data',b=>e+=b);c.on('error',err=>{clearTimeout(t);reject(err)});c.on('close',code=>{clearTimeout(t);if(code!==0)reject(new Error((e||o||tool+' failed').slice(-4000)));else resolve(o.trim());});});}
// Local repository steps are git; only the GitHub API steps are gh. There is deliberately no merge capability here.
class GitHubGateway{
 constructor({repo,cwd,run}={}){this.repo=repo;this.cwd=cwd;this.run=run||exec;}
 gh(args){return this.run('gh',args,{cwd:this.cwd});}
 git(args){return this.run('git',args,{cwd:this.cwd});}
 async auth(){return this.gh(['auth','status']);}
 async currentSha(){return this.git(['rev-parse','HEAD']);}
 async createBranch(branch){const sha=await this.currentSha();await this.gh(['api','repos/'+this.repo+'/git/refs','-f','ref=refs/heads/'+branch,'-f','sha='+sha]);return branch;}
 async commitAll(message){await this.git(['add','-A']);await this.git(['commit','-m',message]);return this.currentSha();}
 async push(branch){return this.git(['push','-u','origin',branch]);}
 async createPR({branch,base='main',title,body,draft=true}){return this.gh(['pr','create','--repo',this.repo,'--head',branch,'--base',base,'--title',title,'--body',body||'',...(draft?['--draft']:[])]);}
 async checks(branch){return this.gh(['pr','checks',branch,'--repo',this.repo,'--json','name,state,bucket,workflow']);}
 async workflowRuns(sha){return this.gh(['run','list','--repo',this.repo,'--commit',sha,'--json','databaseId,status,conclusion,name,url,headSha']);}
}
module.exports={GitHubGateway};
