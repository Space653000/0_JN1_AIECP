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
const {WorkerRegistry}=require('../electron/lib/worker-registry.cjs');

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
const expectedArch=String(process.env.AECP_PROVIDER_VERIFY_EXPECTED_ARCH||'any').trim().toLowerCase();
const VALID_MODES=new Set(['ollama','opencode-ollama','canonical-local','local-command','codex-official','codex-pega','multi-codex','codex-fault-isolation','all']);
const VALID_ARCHES=new Set(['any','x64','arm64']);

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
  expectedArch,
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
    evidence.checks.push({id,status:'FAIL',durationMs:Date.now()-started,error:safeError(error),...(error.safeEvidence?{details:error.safeEvidence}:{})});
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


async function buildRealCodexRouter({official=false,pega=false,root=codexWorkerRoot,allowUnauthenticatedOfficial=false}={}){
  const runtime=new CodexWorkerRuntime(root);
  const registry={};
  const profiles={};
  if(official){
    const profile=await runtime.prepareOfficial({model:officialModel||null});
    const inspection=await runtime.inspect(WORKER_IDS.OFFICIAL);
    if(!inspection.authPresent&&!allowUnauthenticatedOfficial)throw Object.assign(new Error('Codex OFFICIAL isolated CODEX_HOME is not authenticated.'),{code:'OFFICIAL_AUTH_REQUIRED'});
    profiles.official=profile;
    registry['openai-official']={
      id:'openai-official',command:'codex',roles:['builder'],mode:'codex-cli',
      network:true,credential:false,requiresCredential:false,requiresAuthFiles:true,authPresent:inspection.authPresent,
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
  if(result.workerId!==workerId)throw Object.assign(new Error('Provider silently selected another Worker.'),{code:'WORKER_FALLBACK_DETECTED'});
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


async function codexEditSmoke(router,{provider,model,workerId,cwd,token,credentialApproved=false,onSpawn=null}){
  const health=await router.health(provider,{model:model||null,networkApproved:true,credentialApproved,timeoutMs:30000});
  if(health.status!=='READY')throw Object.assign(new Error('Codex worker health not ready'),{code:'CODEX_'+workerId+'_'+health.status});
  const result=await router.execute('builder','Create a file named worker_result.txt in the current directory containing exactly '+token+'. Do not modify any other file.',{
    provider,model:model||null,cwd,timeoutMs,networkApproved:true,credentialApproved,onSpawn
  });
  if(result.workerId!==workerId)throw Object.assign(new Error('Provider silently selected another Worker.'),{code:'WORKER_FALLBACK_DETECTED'});
  if(result.code!==0)throw Object.assign(new Error('Codex worker real edit failed'),{code:'CODEX_'+workerId+'_EDIT_FAILED'});
  const fileVerifier=await verifyExpectedFile(cwd,'worker_result.txt',token);
  return {
    workerId,provider,providerName:result.providerName||health.providerName||provider,
    model:result.model||model||null,health:health.status,
    codexHomeSha256:sha(result.codexHome||health.codexHome||''),
    worktreeSha256:sha(path.resolve(cwd)),
    fileSha256:fileVerifier.sha256,fileVerifier,
    timedOut:Boolean(result.timedOut),aborted:Boolean(result.aborted)
  };
}

async function verifyExpectedFile(cwd,fileName,expected){
  const file=path.join(cwd,fileName);
  const stat=await fs.lstat(file);
  if(!stat.isFile())throw Object.assign(new Error('Expected worker output is not a regular file.'),{code:'FILE_VERIFY_NOT_REGULAR'});
  const actual=(await fs.readFile(file,'utf8')).trim();
  if(actual!==expected)throw Object.assign(new Error('Worker output failed independent file verification.'),{code:'FILE_VERIFY_MISMATCH'});
  return {path:fileName,sha256:sha(actual),expectedSha256Match:true};
}

async function makeSingleWorktree(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-provider-single-worktree-'));
  const repo=path.join(root,'repo');
  const worktree=path.join(root,'worker-worktree');
  try{
    await fs.mkdir(repo,{recursive:true});
    await fs.writeFile(path.join(repo,'README.md'),'# AECP provider file verification fixture\n','utf8');
    await git(repo,['init']);
    await git(repo,['config','user.name','AECP Provider Evidence']);
    await git(repo,['config','user.email','aecp-provider-evidence@example.invalid']);
    await git(repo,['add','.']);
    await git(repo,['commit','-m','baseline']);
    await git(repo,['worktree','add','-b','evidence-worker',worktree,'HEAD']);
    return {root,worktree};
  }catch(error){await fs.rm(root,{recursive:true,force:true});throw error;}
}

async function makeCodexParallelWorktrees(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-codex-parallel-worktrees-'));
  const repo=path.join(root,'repo');
  const officialWorktree=path.join(root,'official-worktree');
  const pegaWorktree=path.join(root,'pega-worktree');
  await fs.mkdir(repo,{recursive:true});
  await fs.writeFile(path.join(repo,'README.md'),'# AECP multi Codex environment fixture\n','utf8');
  await git(repo,['init']);
  await git(repo,['config','user.name','AECP Provider Evidence']);
  await git(repo,['config','user.email','aecp-provider-evidence@example.invalid']);
  await git(repo,['add','.']);
  await git(repo,['commit','-m','baseline']);
  await git(repo,['worktree','add','-b','evidence-official',officialWorktree,'HEAD']);
  await git(repo,['worktree','add','-b','evidence-pega',pegaWorktree,'HEAD']);
  return {root,repo,officialWorktree,pegaWorktree};
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

async function authDigests(home){
  const found=[];
  for(const name of ['auth.json','credentials.json']){
    const file=path.join(home,name);
    try{
      const content=await fs.readFile(file);
      found.push({name,size:content.length,sha256:crypto.createHash('sha256').update(content).digest('hex')});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return found;
}

async function configDigest(home){
  return crypto.createHash('sha256').update(await fs.readFile(path.join(home,'config.toml'))).digest('hex');
}

async function observeFaultWorker(router,{provider,workerId,model,cwd,token,credentialApproved=false,env={}}){
  const health=await router.health(provider,{model:model||null,networkApproved:true,credentialApproved,timeoutMs:30000});
  const observation={workerId,health:health.status,status:'FAIL',noFallback:true,code:null,codexHomeSha256:sha(health.codexHome||'')};
  if(health.status!=='READY'){
    observation.code='HEALTH_'+health.status;
    return observation;
  }
  try{
    const result=await router.execute('builder','Reply with exactly this token and nothing else: '+token,{
      provider,model:model||null,cwd,timeoutMs,networkApproved:true,credentialApproved,env
    });
    observation.noFallback=result.workerId===workerId;
    observation.codexHomeSha256=sha(result.codexHome||health.codexHome||'');
    if(!observation.noFallback){observation.code='WORKER_FALLBACK_DETECTED';return observation;}
    if(result.code===0&&String(result.stdout).includes(token)){
      observation.status='PASS';
      observation.code='OK';
    }else observation.code='WORKER_RUN_FAILED';
  }catch(error){observation.code=safeError(error).code;}
  return observation;
}

async function runFaultStage({name,router,registryRoot,officialHome,pegaHome,failWorker,pegaEnv={}}){
  const registry=new WorkerRegistry(registryRoot);
  await registry.init();
  for(const [id,providerId,home] of [
    [WORKER_IDS.OFFICIAL,'openai-official',officialHome],
    [PEGA_WORKER_ID,PEGA_PROVIDER_ID,pegaHome]
  ]){
    await registry.register({id,name:id,providerId,runtime:'codex-cli',codexHome:home});
    await registry.acquire(id,{runId:name,taskId:name});
  }
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-fault-stage-'));
  try{
    const [official,pega]=await Promise.all([
      observeFaultWorker(router,{provider:'openai-official',workerId:WORKER_IDS.OFFICIAL,model:officialModel||null,cwd,
        token:'AECP_FAULT_OFFICIAL_OK'}),
      observeFaultWorker(router,{provider:PEGA_PROVIDER_ID,workerId:PEGA_WORKER_ID,model:pegaModel,cwd,
        token:'AECP_FAULT_PEGA_OK',credentialApproved:true,env:pegaEnv})
    ]);
    for(const item of [official,pega]){
      if(item.status==='PASS')await registry.release(item.workerId,{resultState:'PASS'});
      else await registry.fail(item.workerId,item.code||'FAILED');
      item.registryState=registry.get(item.workerId).runtimeState;
    }
    const failed=failWorker===WORKER_IDS.OFFICIAL?official:pega;
    const healthy=failWorker===WORKER_IDS.OFFICIAL?pega:official;
    const pass=failed.status==='FAIL'&&failed.workerId===failWorker&&failed.noFallback&&
      ['FAILED','UNKNOWN'].includes(failed.registryState)&&healthy.status==='PASS'&&healthy.health==='READY'&&
      healthy.registryState==='IDLE'&&healthy.noFallback&&officialHome!==pegaHome;
    return {stage:name,expectedFailure:failWorker,official,pega,distinctHomes:officialHome!==pegaHome,pass};
  }finally{await fs.rm(cwd,{recursive:true,force:true});}
}

async function main(){
  if(!VALID_MODES.has(mode))throw Object.assign(new Error('AECP_PROVIDER_VERIFY_MODE is invalid.'),{code:'MODE_INVALID'});
  if(!VALID_ARCHES.has(expectedArch))throw Object.assign(new Error('AECP_PROVIDER_VERIFY_EXPECTED_ARCH is invalid.'),{code:'ARCH_INVALID'});
  if(expectedArch!=='any'&&process.arch!==expectedArch){
    throw Object.assign(new Error('Runtime architecture does not match the required evidence architecture.'),{code:'ARCH_MISMATCH'});
  }
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
      const fixture=await makeSingleWorktree();
      try{
        const result=await router.execute('builder',`Create worker_result.txt in the current directory containing exactly ${token}. Do not change any other file.`,{
          provider:'real-local-command',cwd:fixture.worktree,timeoutMs
        });
        if(result.code!==0)throw Object.assign(new Error('Local command invocation failed'),{code:'LOCAL_COMMAND_SMOKE_FAILED'});
        const fileVerifier=await verifyExpectedFile(fixture.worktree,'worker_result.txt',token);
        return {provider:'real-local-command',outputSha256:sha(result.stdout),fileVerifier};
      }finally{await fs.rm(fixture.root,{recursive:true,force:true});}
    });
  }


  if(mode==='codex-official'||mode==='all'){
    await check('codex-official.real-smoke',async()=>{
      const built=await buildRealCodexRouter({official:true});
      const fixture=await makeSingleWorktree();
      try{
        return await codexEditSmoke(built.router,{
          provider:'openai-official',model:officialModel||null,workerId:WORKER_IDS.OFFICIAL,cwd:fixture.worktree,
          token:'AECP_CODEX_OFFICIAL_REAL_OK',credentialApproved:false
        });
      }finally{await fs.rm(fixture.root,{recursive:true,force:true});}
    });
  }

  if(mode==='codex-pega'||mode==='all'){
    await check('codex-pega.real-smoke',async()=>{
      const built=await buildRealCodexRouter({pega:true});
      const fixture=await makeSingleWorktree();
      try{
        const result=await codexEditSmoke(built.router,{
          provider:PEGA_PROVIDER_ID,model:pegaModel,workerId:PEGA_WORKER_ID,cwd:fixture.worktree,
          token:'AECP_CODEX_PEGA_REAL_OK',credentialApproved:true
        });
        return {...result,baseUrlSha256:sha(PEGA_BASE_URL),wireApi:pegaWireApi};
      }finally{await fs.rm(fixture.root,{recursive:true,force:true});}
    });
  }

  if(mode==='multi-codex'||mode==='all'){
    await check('codex.multi-worker-real-concurrency',async()=>{
      const built=await buildRealCodexRouter({official:true,pega:true});
      if(path.resolve(built.profiles.official.codexHome)===path.resolve(built.profiles.pega.codexHome)){
        throw Object.assign(new Error('OFFICIAL and PEGA CODEX_HOME unexpectedly match.'),{code:'CODEX_HOME_NOT_ISOLATED'});
      }
      const fixture=await makeCodexParallelWorktrees();
      const spawns={};
      const started=Date.now();
      try{
        if(path.resolve(fixture.officialWorktree)===path.resolve(fixture.pegaWorktree)){
          throw Object.assign(new Error('OFFICIAL and PEGA worktrees unexpectedly match.'),{code:'CODEX_WORKTREE_NOT_ISOLATED'});
        }
        const results=await Promise.all([
          codexEditSmoke(built.router,{
            provider:'openai-official',model:officialModel||null,workerId:WORKER_IDS.OFFICIAL,cwd:fixture.officialWorktree,
            token:'AECP_CODEX_OFFICIAL_PARALLEL_OK',credentialApproved:false,
            onSpawn:pid=>{spawns.official={pid,at:Date.now()};}
          }),
          codexEditSmoke(built.router,{
            provider:PEGA_PROVIDER_ID,model:pegaModel,workerId:PEGA_WORKER_ID,cwd:fixture.pegaWorktree,
            token:'AECP_CODEX_PEGA_PARALLEL_OK',credentialApproved:true,
            onSpawn:pid=>{spawns.pega={pid,at:Date.now()};}
          })
        ]);
        if(!spawns.official?.pid||!spawns.pega?.pid||spawns.official.pid===spawns.pega.pid){
          throw Object.assign(new Error('Distinct concurrent Codex worker processes were not observed.'),{code:'CODEX_PROCESS_ISOLATION_FAILED'});
        }
        const distinctCodexHomes=results[0].codexHomeSha256!==results[1].codexHomeSha256;
        const distinctWorktrees=results[0].worktreeSha256!==results[1].worktreeSha256;
        if(!distinctCodexHomes)throw Object.assign(new Error('Codex home hashes are not isolated.'),{code:'CODEX_HOME_HASH_COLLISION'});
        if(!distinctWorktrees)throw Object.assign(new Error('Worktree hashes are not isolated.'),{code:'CODEX_WORKTREE_HASH_COLLISION'});
        return {
          state:'PASS',workers:results,distinctCodexHomes,distinctWorktrees,
          distinctProcesses:true,spawnDeltaMs:Math.abs(spawns.official.at-spawns.pega.at),
          durationMs:Date.now()-started,pegaWireApi
        };
      }finally{await fs.rm(fixture.root,{recursive:true,force:true});}
    });
  }

  if(mode==='codex-fault-isolation'){
    const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-codex-fault-isolation-'));
    try{
      const real=await buildRealCodexRouter({official:true,pega:true});
      const officialHome=real.profiles.official.codexHome;
      const pegaHome=real.profiles.pega.codexHome;
      const expectedPegaConfig=await configDigest(pegaHome);
      const pegaAuthBefore=await authDigests(pegaHome);
      let stageA,stageB,authBeforeB,authAfterB,pegaAuthAfterA,pegaAuthAfterB,pegaConfigAfterA,pegaConfigAfterB;
      await check('codex.fault-isolation',async()=>{
        stageA=await runFaultStage({name:'pega-failure',router:real.router,registryRoot:path.join(scratch,'registry-a'),
          officialHome,pegaHome,failWorker:PEGA_WORKER_ID,pegaEnv:{[PEGA_ENV_KEY]:'AECP_INVALID_ISOLATION_KEY'}});
        pegaAuthAfterA=await authDigests(pegaHome);
        pegaConfigAfterA=await configDigest(pegaHome);
        authBeforeB=await authDigests(officialHome);
        const faultRoot=path.join(scratch,'empty-official');
        const faulty=await buildRealCodexRouter({official:true,root:faultRoot,allowUnauthenticatedOfficial:true});
        const stageBRouter=new ProviderRouter({...faulty.router.registry,...real.router.registry,
          'openai-official':faulty.router.registry['openai-official']});
        stageB=await runFaultStage({name:'official-failure',router:stageBRouter,registryRoot:path.join(scratch,'registry-b'),
          officialHome:faulty.profiles.official.codexHome,pegaHome,failWorker:WORKER_IDS.OFFICIAL});
        authAfterB=await authDigests(officialHome);
        pegaAuthAfterB=await authDigests(pegaHome);
        pegaConfigAfterB=await configDigest(pegaHome);
        const protection={
          realOfficialAuthUnchangedInStageB:JSON.stringify(authBeforeB)===JSON.stringify(authAfterB),
          pegaAuthAbsentThroughout:[pegaAuthBefore,pegaAuthAfterA,pegaAuthAfterB].every(items=>items.length===0),
          pegaConfigMatchesPrepared:[pegaConfigAfterA,pegaConfigAfterB].every(digest=>digest===expectedPegaConfig),
          distinctRealHomes:officialHome!==pegaHome,
          scratchOfficialHomeDistinct:faulty.profiles.official.codexHome!==officialHome,
          noFallback:stageA.official.noFallback&&stageA.pega.noFallback&&stageB.official.noFallback&&stageB.pega.noFallback
        };
        const data={stages:[stageA,stageB],protection,
          realOfficialHomeSha256:sha(officialHome),realPegaHomeSha256:sha(pegaHome),
          authBeforeStageB:authBeforeB,authAfterStageB:authAfterB,
          pegaConfigSha256:expectedPegaConfig,safeBridge:{status:'OPERATOR_REQUIRED'}};
        if(!stageA.pass||!stageB.pass||Object.values(protection).some(value=>value!==true)){
          throw Object.assign(new Error('Fault isolation or home protection failed.'),{code:'FAULT_ISOLATION_FAILED',safeEvidence:data});
        }
        return data;
      });
      await check('recovery',async()=>{
        const [official,pega]=await Promise.all([
          real.router.health('openai-official',{model:officialModel||null,networkApproved:true,timeoutMs:30000}),
          real.router.health(PEGA_PROVIDER_ID,{model:pegaModel,networkApproved:true,credentialApproved:true,timeoutMs:30000})
        ]);
        if(official.status!=='READY'||pega.status!=='READY')throw Object.assign(new Error('Workers did not recover to READY.'),{code:'RECOVERY_NOT_READY'});
        return {official:{workerId:WORKER_IDS.OFFICIAL,health:official.status},pega:{workerId:PEGA_WORKER_ID,health:pega.status}};
      });
    }finally{await fs.rm(scratch,{recursive:true,force:true});}
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

if(require.main===module)main().catch(async error=>{
  evidence.summary.failed++;
  evidence.fatal=safeError(error);
  try{await fs.mkdir(path.dirname(outputPath),{recursive:true});await fs.writeFile(outputPath,JSON.stringify(evidence,null,2)+'\n','utf8');}catch{}
  process.stderr.write(JSON.stringify({fatal:evidence.fatal,output:outputPath},null,2)+'\n');
  process.exitCode=1;
});

module.exports={codexEditSmoke,verifyExpectedFile,runFaultStage};
