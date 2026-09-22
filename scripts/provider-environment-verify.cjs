'use strict';

const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {ProviderRouter,PROVIDERS}=require('../electron/lib/provider-router.cjs');
const {runHarness}=require('../electron/lib/harness.cjs');
const {CodexWorkerRuntime,WORKER_IDS}=require('../electron/lib/codex-worker-runtime.cjs');
const {PEGA_PROVIDER_ID,PEGA_WORKER_ID,PEGA_BASE_URL,PEGA_ENV_KEY,makePegaProvider}=require('../electron/lib/pega-provider.cjs');

const mode=String(process.env.AECP_PROVIDER_VERIFY_MODE||'').trim();
const sourceRoot=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const outputPath=path.resolve(process.env.AECP_PROVIDER_EVIDENCE_PATH||path.join(sourceRoot,'artifacts','provider-environment-evidence.json'));
const modelInput=String(process.env.AECP_PROVIDER_VERIFY_MODEL||'').trim();
const ollamaModel=modelInput.replace(/^ollama\//i,'');
const openCodeModel=modelInput?(/^ollama\//i.test(modelInput)?modelInput:`ollama/${modelInput}`):'';
const localCommand=String(process.env.AECP_PROVIDER_VERIFY_LOCAL_COMMAND||'').trim();
const localArgsRaw=String(process.env.AECP_PROVIDER_VERIFY_LOCAL_ARGS_JSON||'[]').trim();
const timeoutMs=Math.max(30000,Math.min(60*60*1000,Number(process.env.AECP_PROVIDER_VERIFY_TIMEOUT_MS||900000)));
const officialModel=String(process.env.AECP_PROVIDER_VERIFY_OFFICIAL_MODEL||'').trim();
const pegaModel=String(process.env.AECP_PROVIDER_VERIFY_PEGA_MODEL||'').trim();
const pegaWireApi=String(process.env.AECP_PROVIDER_VERIFY_PEGA_WIRE_API||'responses').trim().toLowerCase();
const pegaApiKey=String(process.env[PEGA_ENV_KEY]||'');
const codexWorkerRoot=path.resolve(process.env.AECP_PROVIDER_VERIFY_CODEX_ROOT||path.join(os.homedir(),'.aecp-provider-evidence-workers'));
const VALID_MODES=new Set(['ollama','opencode-ollama','canonical-local','local-command','codex-official','codex-pega','multi-codex','all']);

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


async function buildRealCodexRouter({official=false,pega=false}={}){
  const runtime=new CodexWorkerRuntime(codexWorkerRoot);
  const registry={};
  const profiles={};
  if(official){
    const profile=await runtime.prepareOfficial({model:officialModel||null});
    const inspection=await runtime.inspect(WORKER_IDS.OFFICIAL);
    if(!inspection.authPresent)throw Object.assign(new Error('Codex OFFICIAL isolated CODEX_HOME is not authenticated.'),{code:'OFFICIAL_AUTH_REQUIRED'});
    profiles.official=profile;
    registry['openai-official']={
      id:'openai-official',command:'codex',roles:['builder'],mode:'codex-cli',
      network:true,credential:false,requiresCredential:false,requiresAuthFiles:true,authPresent:true,
      workerId:WORKER_IDS.OFFICIAL,workerName:'Codex OFFICIAL',providerName:'OpenAI Official',
      defaultModel:officialModel||null,codexHome:profile.codexHome,runtimeEnv:{...profile.env},kind:'codex-worker'
    };
  }
  if(pega){
    if(!pegaModel)throw Object.assign(new Error('Explicit PEGA model is required.'),{code:'PEGA_MODEL_REQUIRED'});
    if(!['responses','chat'].includes(pegaWireApi))throw Object.assign(new Error('PEGA wire API must be responses or chat.'),{code:'PEGA_WIRE_API_INVALID'});
    if(!pegaApiKey)throw Object.assign(new Error('PEGA credential is required from the environment.'),{code:'PEGA_AUTH_REQUIRED'});
    const profile=await runtime.prepareCustom({
      workerId:PEGA_WORKER_ID,workerName:'Codex PEGA',providerId:PEGA_PROVIDER_ID,providerName:'PEGA',
      baseUrl:PEGA_BASE_URL,model:pegaModel,wireApi:pegaWireApi,envKey:PEGA_ENV_KEY,apiKey:pegaApiKey
    });
    profiles.pega=profile;
    registry[PEGA_PROVIDER_ID]=makePegaProvider({
      model:pegaModel,wireApi:pegaWireApi,apiKey:pegaApiKey,codexHome:profile.codexHome,runtimeEnv:{...profile.env}
    });
  }
  return {runtime,profiles,router:new ProviderRouter(registry)};
}

async function codexSmoke(router,{provider,model,workerId,cwd,token,credentialApproved=false,onSpawn=null}){
  const health=await router.health(provider,{model:model||null,networkApproved:true,credentialApproved,timeoutMs:30000});
  if(health.status!=='READY')throw Object.assign(new Error('Codex worker health not ready'),{code:'CODEX_'+workerId+'_'+health.status});
  const result=await router.execute('builder','Reply with exactly this token and nothing else: '+token,{
    provider,model:model||null,cwd,timeoutMs,networkApproved:true,credentialApproved,onSpawn
  });
  if(result.code!==0||!String(result.stdout).includes(token)){
    throw Object.assign(new Error('Codex worker real smoke token missing'),{code:'CODEX_'+workerId+'_SMOKE_FAILED'});
  }
  return {
    workerId,provider,providerName:result.providerName||health.providerName||provider,
    model:result.model||model||null,health:health.status,
    codexHomeSha256:sha(result.codexHome||health.codexHome||''),outputSha256:sha(result.stdout),
    timedOut:Boolean(result.timedOut),aborted:Boolean(result.aborted)
  };
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


  if(mode==='codex-official'){
    await check('codex-official.real-smoke',async()=>{
      const built=await buildRealCodexRouter({official:true});
      const temp=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-codex-official-real-'));
      try{
        return await codexSmoke(built.router,{
          provider:'openai-official',model:officialModel||null,workerId:WORKER_IDS.OFFICIAL,cwd:temp,
          token:'AECP_CODEX_OFFICIAL_REAL_OK',credentialApproved:false
        });
      }finally{await fs.rm(temp,{recursive:true,force:true});}
    });
  }

  if(mode==='codex-pega'){
    await check('codex-pega.real-smoke',async()=>{
      const built=await buildRealCodexRouter({pega:true});
      const temp=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-codex-pega-real-'));
      try{
        const result=await codexSmoke(built.router,{
          provider:PEGA_PROVIDER_ID,model:pegaModel,workerId:PEGA_WORKER_ID,cwd:temp,
          token:'AECP_CODEX_PEGA_REAL_OK',credentialApproved:true
        });
        return {...result,baseUrlSha256:sha(PEGA_BASE_URL),wireApi:pegaWireApi};
      }finally{await fs.rm(temp,{recursive:true,force:true});}
    });
  }

  if(mode==='multi-codex'){
    await check('codex.multi-worker-real-concurrency',async()=>{
      const built=await buildRealCodexRouter({official:true,pega:true});
      if(path.resolve(built.profiles.official.codexHome)===path.resolve(built.profiles.pega.codexHome)){
        throw Object.assign(new Error('OFFICIAL and PEGA CODEX_HOME unexpectedly match.'),{code:'CODEX_HOME_NOT_ISOLATED'});
      }
      const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-codex-multi-real-'));
      const officialCwd=path.join(root,'official'),pegaCwd=path.join(root,'pega');
      await Promise.all([fs.mkdir(officialCwd,{recursive:true}),fs.mkdir(pegaCwd,{recursive:true})]);
      const spawns={};
      const started=Date.now();
      try{
        const results=await Promise.all([
          codexSmoke(built.router,{
            provider:'openai-official',model:officialModel||null,workerId:WORKER_IDS.OFFICIAL,cwd:officialCwd,
            token:'AECP_CODEX_OFFICIAL_PARALLEL_OK',credentialApproved:false,
            onSpawn:pid=>{spawns.official={pid,at:Date.now()};}
          }),
          codexSmoke(built.router,{
            provider:PEGA_PROVIDER_ID,model:pegaModel,workerId:PEGA_WORKER_ID,cwd:pegaCwd,
            token:'AECP_CODEX_PEGA_PARALLEL_OK',credentialApproved:true,
            onSpawn:pid=>{spawns.pega={pid,at:Date.now()};}
          })
        ]);
        if(!spawns.official?.pid||!spawns.pega?.pid||spawns.official.pid===spawns.pega.pid){
          throw Object.assign(new Error('Distinct concurrent Codex worker processes were not observed.'),{code:'CODEX_PROCESS_ISOLATION_FAILED'});
        }
        return {
          state:'PASS',workers:results,distinctCodexHomes:results[0].codexHomeSha256!==results[1].codexHomeSha256,
          distinctProcesses:true,spawnDeltaMs:Math.abs(spawns.official.at-spawns.pega.at),
          durationMs:Date.now()-started,pegaWireApi
        };
      }finally{await fs.rm(root,{recursive:true,force:true});}
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
