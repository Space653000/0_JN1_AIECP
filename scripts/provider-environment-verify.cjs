'use strict';

const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {ProviderRouter,PROVIDERS}=require('../electron/lib/provider-router.cjs');
const {runHarness}=require('../electron/lib/harness.cjs');

const mode=String(process.env.AECP_PROVIDER_VERIFY_MODE||'').trim();
const sourceRoot=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const outputPath=path.resolve(process.env.AECP_PROVIDER_EVIDENCE_PATH||path.join(sourceRoot,'artifacts','provider-environment-evidence.json'));
const modelInput=String(process.env.AECP_PROVIDER_VERIFY_MODEL||'').trim();
const ollamaModel=modelInput.replace(/^ollama\//i,'');
const openCodeModel=modelInput?(/^ollama\//i.test(modelInput)?modelInput:`ollama/${modelInput}`):'';
const localCommand=String(process.env.AECP_PROVIDER_VERIFY_LOCAL_COMMAND||'').trim();
const localArgsRaw=String(process.env.AECP_PROVIDER_VERIFY_LOCAL_ARGS_JSON||'[]').trim();
const timeoutMs=Math.max(30000,Math.min(60*60*1000,Number(process.env.AECP_PROVIDER_VERIFY_TIMEOUT_MS||900000)));
const VALID_MODES=new Set(['ollama','opencode-ollama','canonical-local','local-command','all']);

function sha(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function now(){return new Date().toISOString();}
function safeError(error){return {name:String(error?.name||'Error').slice(0,80),code:String(error?.code||'ERROR').slice(0,120)};}

function run(command,args,{cwd=sourceRoot,timeout=60000,env={}}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env:{...process.env,...env},windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',settled=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},Math.max(1000,timeout));
    child.stdout.on('data',b=>{if(stdout.length<2*1024*1024)stdout+=b.toString();});
    child.stderr.on('data',b=>{if(stderr.length<2*1024*1024)stderr+=b.toString();});
    child.on('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
    child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);resolve({code:Number.isInteger(code)?code:-1,stdout,stderr,timedOut});});
  });
}

async function git(cwd,args){
  const r=await run('git',args,{cwd,timeout:30000});
  if(r.code!==0)throw Object.assign(new Error('git command failed'),{code:'GIT_FAILED'});
  return r.stdout.trim();
}

async function sourceCommit(){
  try{return await git(sourceRoot,['rev-parse','HEAD']);}catch{return null;}
}

const evidence={
  schema:'aecp.provider-environment-evidence/v1',
  generatedAt:now(),
  sourceCommit:null,
  mode,
  platform:process.platform,
  arch:process.arch,
  node:process.version,
  model:modelInput||null,
  checks:[],
  summary:{requested:0,passed:0,failed:0},
  privacy:{promptBodiesPersisted:false,responseBodiesPersisted:false,credentialsPersisted:false}
};

async function check(id,fn){
  const started=Date.now();
  evidence.summary.requested++;
  try{
    const data=await fn();
    evidence.checks.push({id,status:'PASS',durationMs:Date.now()-started,...data});
    evidence.summary.passed++;
  }catch(error){
    evidence.checks.push({id,status:'FAIL',durationMs:Date.now()-started,error:safeError(error)});
    evidence.summary.failed++;
  }
}

function requireModel(){
  if(!modelInput)throw Object.assign(new Error('Explicit provider model is required.'),{code:'MODEL_REQUIRED'});
}

function localArgs(){
  let parsed;
  try{parsed=JSON.parse(localArgsRaw);}catch{throw Object.assign(new Error('Local args must be a JSON array.'),{code:'LOCAL_ARGS_INVALID'});}
  if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=='string'))throw Object.assign(new Error('Local args must be a JSON array of strings.'),{code:'LOCAL_ARGS_INVALID'});
  return parsed.slice(0,32);
}

async function makeHarnessFixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-real-provider-harness-'));
  const repo=path.join(root,'repo');
  const runRoot=path.join(root,'run');
  await fs.mkdir(repo,{recursive:true});
  const token='AECP_CANONICAL_LOCAL_PROVIDER_OK';
  await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({
    name:'aecp-provider-fixture',version:'1.0.0',private:true,
    scripts:{verify:'node verify.cjs'}
  },null,2)+'\n');
  await fs.writeFile(path.join(repo,'verify.cjs'),[
    "'use strict';",
    "const fs=require('node:fs');",
    `const expected=${JSON.stringify(token)};`,
    "const actual=fs.existsSync('solution.txt')?fs.readFileSync('solution.txt','utf8').trim():'';",
    "if(actual!==expected){console.error('solution.txt verification failed');process.exit(1);}",
    "console.log('AECP_FIXTURE_VERIFY_OK');"
  ].join('\n')+'\n');
  await fs.writeFile(path.join(repo,'README.md'),'# AECP provider fixture\n');
  await git(repo,['init']);
  await git(repo,['config','user.name','AECP Provider Evidence']);
  await git(repo,['config','user.email','aecp-provider-evidence@example.invalid']);
  await git(repo,['add','.']);
  await git(repo,['commit','-m','baseline']);
  return {root,repo,runRoot,token};
}

async function main(){
  if(!VALID_MODES.has(mode))throw Object.assign(new Error('AECP_PROVIDER_VERIFY_MODE is invalid.'),{code:'MODE_INVALID'});
  evidence.sourceCommit=await sourceCommit();
  const metrics=[];
  const registry={...PROVIDERS};
  if(localCommand){
    registry['real-local-command']={
      command:localCommand,
      args:localArgs(),
      roles:['builder'],
      mode:'local-command',
      network:false,
      credential:false
    };
  }
  const router=new ProviderRouter(registry,{metricsSink:async metric=>metrics.push(metric)});

  if(mode==='ollama'||mode==='all'){
    requireModel();
    await check('ollama.health',async()=>{
      const health=await router.health('ollama',{model:ollamaModel,timeoutMs:30000});
      if(health.status!=='READY')throw Object.assign(new Error('Ollama health not ready'),{code:`OLLAMA_${health.status}`});
      return {provider:'ollama',status:health.status,version:health.version||null};
    });
    await check('ollama.real-smoke',async()=>{
      const token='AECP_OLLAMA_REAL_SMOKE_OK';
      const result=await router.execute('reviewer',`Reply with exactly this token and nothing else: ${token}`,{
        provider:'ollama',model:ollamaModel,cwd:sourceRoot,timeoutMs
      });
      if(result.code!==0||!String(result.stdout).includes(token))throw Object.assign(new Error('Ollama smoke token missing'),{code:'OLLAMA_SMOKE_FAILED'});
      return {provider:'ollama',model:ollamaModel,outputSha256:sha(result.stdout)};
    });
  }

  if(mode==='opencode-ollama'||mode==='all'){
    requireModel();
    await check('opencode.health',async()=>{
      const health=await router.health('opencode',{model:openCodeModel,timeoutMs:30000});
      if(health.status!=='READY')throw Object.assign(new Error('OpenCode health not ready'),{code:`OPENCODE_${health.status}`});
      return {provider:'opencode',status:health.status,version:health.version||null};
    });
    await check('opencode.ollama-real-edit',async()=>{
      const temp=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-opencode-real-'));
      try{
        const token='AECP_OPENCODE_OLLAMA_REAL_OK';
        const result=await router.execute('builder',`Create a file named provider_verify.txt in the current directory containing exactly ${token}. Do not change any other file.`,{
          provider:'opencode',model:openCodeModel,cwd:temp,timeoutMs
        });
        if(result.code!==0)throw Object.assign(new Error('OpenCode invocation failed'),{code:'OPENCODE_EXEC_FAILED'});
        const actual=(await fs.readFile(path.join(temp,'provider_verify.txt'),'utf8')).trim();
        if(actual!==token)throw Object.assign(new Error('OpenCode deterministic file verification failed'),{code:'OPENCODE_EDIT_VERIFY_FAILED'});
        return {provider:'opencode',model:openCodeModel,fileSha256:sha(actual)};
      }finally{await fs.rm(temp,{recursive:true,force:true});}
    });
  }

  if(mode==='local-command'||mode==='all'){
    if(!localCommand)throw Object.assign(new Error('AECP_PROVIDER_VERIFY_LOCAL_COMMAND is required.'),{code:'LOCAL_COMMAND_REQUIRED'});
    await check('local-command.health',async()=>{
      const health=await router.health('real-local-command',{timeoutMs:30000});
      if(health.status!=='READY')throw Object.assign(new Error('Local command health not ready'),{code:`LOCAL_COMMAND_${health.status}`});
      return {provider:'real-local-command',status:health.status,resolvedCommandSha256:sha(health.resolvedCommand||localCommand)};
    });
    await check('local-command.real-smoke',async()=>{
      const token='AECP_LOCAL_COMMAND_REAL_SMOKE_OK';
      const result=await router.execute('builder',`Return this exact token: ${token}`,{
        provider:'real-local-command',cwd:sourceRoot,timeoutMs
      });
      if(result.code!==0||!String(result.stdout).includes(token))throw Object.assign(new Error('Local command smoke token missing'),{code:'LOCAL_COMMAND_SMOKE_FAILED'});
      return {provider:'real-local-command',outputSha256:sha(result.stdout)};
    });
  }

  if(mode==='canonical-local'||mode==='all'){
    requireModel();
    await check('canonical-harness.ollama-opencode',async()=>{
      const fixture=await makeHarnessFixture();
      try{
        const run=await runHarness({
          goal:`Create solution.txt containing exactly ${fixture.token}.`,
          done:`npm run verify passes and solution.txt contains exactly ${fixture.token}.`,
          sourceRoot:fixture.repo,
          runRoot:fixture.runRoot,
          maxIterations:3,
          maxTasks:1,
          plannerProvider:'ollama',
          plannerModel:ollamaModel,
          builderProvider:'opencode',
          builderModel:openCodeModel,
          reviewerProvider:'ollama',
          reviewerModel:ollamaModel,
          providerRouter:router,
          executionApproved:true,
          providerNetworkApproved:false,
          providerCredentialApproved:false,
          context:'This is an isolated AECP provider verification fixture. Make only the requested file change.'
        });
        if(run.state!=='DONE')throw Object.assign(new Error('Canonical Harness did not reach DONE'),{code:`HARNESS_${run.state}`});
        if(!run.patch?.file)throw Object.assign(new Error('Canonical Harness patch missing'),{code:'HARNESS_PATCH_MISSING'});
        const patch=await fs.readFile(run.patch.file);
        return {
          providers:run.providers,
          models:run.models,
          state:run.state,
          taskStates:run.tasks.map(t=>({id:t.id,state:t.state,iterations:t.iterations,verificationPassed:Boolean(t.verification?.passed),reviewResult:t.review?.result||null})),
          patchSha256:crypto.createHash('sha256').update(patch).digest('hex'),
          eventCount:run.events.length
        };
      }finally{await fs.rm(fixture.root,{recursive:true,force:true});}
    });
  }

  evidence.providerMetrics=metrics.map(metric=>({
    provider:metric.provider,
    role:metric.role,
    model:metric.model,
    success:metric.success,
    code:metric.code,
    timedOut:metric.timedOut,
    aborted:metric.aborted,
    latencyMs:metric.latencyMs,
    usage:metric.usage||null,
    recordedAt:metric.recordedAt
  }));
  await fs.mkdir(path.dirname(outputPath),{recursive:true});
  await fs.writeFile(outputPath,JSON.stringify(evidence,null,2)+'\n','utf8');
  process.stdout.write(JSON.stringify({schema:evidence.schema,sourceCommit:evidence.sourceCommit,mode:evidence.mode,summary:evidence.summary,output:path.relative(sourceRoot,outputPath)},null,2)+'\n');
  if(evidence.summary.failed)process.exitCode=1;
}

main().catch(async error=>{
  evidence.summary.failed++;
  evidence.fatal=safeError(error);
  try{await fs.mkdir(path.dirname(outputPath),{recursive:true});await fs.writeFile(outputPath,JSON.stringify(evidence,null,2)+'\n','utf8');}catch{}
  process.stderr.write(JSON.stringify({fatal:evidence.fatal,output:outputPath},null,2)+'\n');
  process.exitCode=1;
});
