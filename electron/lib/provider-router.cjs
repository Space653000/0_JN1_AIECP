'use strict';
const {spawn}=require('node:child_process');
const PROVIDERS=Object.freeze({claude:{command:'claude',role:'planner-reviewer'},codex:{command:'codex',role:'builder'},gemini:{command:'gemini',role:'general'},opencode:{command:'opencode',role:'local-worker'},ollama:{command:'ollama',role:'local-model'}});
function run(command,args,{cwd,timeoutMs=180000,signal}={}){return new Promise((resolve,reject)=>{const c=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let o='',e='';const t=setTimeout(()=>{try{c.kill()}catch{}},timeoutMs);c.stdout.on('data',b=>o+=b);c.stderr.on('data',b=>e+=b);c.on('error',reject);c.on('close',code=>{clearTimeout(t);resolve({code,stdout:o,stderr:e});});if(signal)signal.addEventListener('abort',()=>{try{c.kill()}catch{}},{once:true});});}
class ProviderRouter{
 constructor(registry=PROVIDERS){this.registry=registry;}
 resolve(role,preferred){const ids=preferred?[preferred]:Object.keys(this.registry);for(const id of ids){const p=this.registry[id];if(p&&(p.role===role||role==='general'||(role==='planner-reviewer'&&p.role==='planner-reviewer')))return{id,...p};}return null;}
 async execute(role,args,opts={}){const p=this.resolve(role,opts.provider);if(!p)throw new Error('No provider for role: '+role);return{...await run(p.command,args,opts),provider:p.id};}
}
module.exports={ProviderRouter,PROVIDERS};