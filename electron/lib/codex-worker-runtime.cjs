'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const WORKER_SCHEMA='aecp.codex-worker/v1';
const WORKER_IDS=Object.freeze({OFFICIAL:'codex-official',PEGA:'codex-pega'});

function safeWorkerId(value){
  const id=String(value||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id))throw new Error('Invalid worker id.');
  return id;
}

// The isolated CODEX_HOME has no Windows sandbox setup of its own; without an explicit mode the
// workspace-write sandbox denies every write in the worktree. This keeps the sandbox (restricted token).
const WINDOWS_SANDBOX_TABLE=Object.freeze(['','[windows]','sandbox = "unelevated"']);

function tomlString(value){return JSON.stringify(String(value??''));}

function normalizeWireApi(value){
  const wire=String(value||'responses').trim().toLowerCase();
  if(!['responses','chat'].includes(wire))throw new Error('Codex wire API must be "responses" or "chat".');
  return wire;
}

async function writeAtomic(file,content){
  const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(4).toString('hex');
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(tmp,content,'utf8');
  await fs.rename(tmp,file);
}

class CodexWorkerRuntime{
  constructor(rootDir){this.rootDir=path.resolve(rootDir);}

  workerRoot(workerId){return path.join(this.rootDir,safeWorkerId(workerId));}
  codexHome(workerId){return path.join(this.workerRoot(workerId),'codex-home');}
  runtimeDir(workerId){return path.join(this.workerRoot(workerId),'runtime');}

  async prepareOfficial({model=null}={}){
    const workerId=WORKER_IDS.OFFICIAL;
    const codexHome=this.codexHome(workerId);
    const runtimeDir=this.runtimeDir(workerId);
    await Promise.all([fs.mkdir(codexHome,{recursive:true}),fs.mkdir(runtimeDir,{recursive:true})]);
    const config=[
      '# AECP-managed isolated Codex OFFICIAL worker.',
      '# Authentication/session files remain inside this CODEX_HOME only.',
      ...(model?['model = '+tomlString(model)]:[]),
      'approval_policy = "never"',
      'sandbox_mode = "workspace-write"',
      'cli_auth_credentials_store = "file"',
      ...WINDOWS_SANDBOX_TABLE,
      ''
    ].join('\n');
    await writeAtomic(path.join(codexHome,'config.toml'),config);
    return {
      schema:WORKER_SCHEMA,id:workerId,name:'Codex OFFICIAL',providerId:'openai-official',provider:'OpenAI Official',
      model:model||null,role:'builder',codexHome,runtimeDir,isolated:true,env:{CODEX_HOME:codexHome}
    };
  }

  async prepareCustom({workerId,workerName,providerId,providerName,baseUrl,model,wireApi='responses',envKey,apiKey=''}={}){
    const id=safeWorkerId(workerId);
    const selectedModel=String(model||'').trim();
    const selectedProviderId=safeWorkerId(providerId);
    if(!selectedModel)throw new Error('Custom Codex worker requires an explicit model.');
    const url=new URL(String(baseUrl||''));
    if(url.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname))throw new Error('Custom Codex provider must use HTTPS except loopback development.');
    if(url.username||url.password)throw new Error('Custom Codex provider URL must not embed credentials.');
    const key=String(envKey||'').trim();
    if(!/^[A-Z_][A-Z0-9_]*$/.test(key))throw new Error('Custom Codex provider env key is invalid.');
    const wire=normalizeWireApi(wireApi);
    const codexHome=this.codexHome(id);
    const runtimeDir=this.runtimeDir(id);
    await Promise.all([fs.mkdir(codexHome,{recursive:true}),fs.mkdir(runtimeDir,{recursive:true})]);
    const config=[
      '# AECP-managed isolated Codex worker.',
      '# Secrets are never written here; env_key points to an in-memory process environment value.',
      'model = '+tomlString(selectedModel),
      'model_provider = '+tomlString(selectedProviderId),
      'approval_policy = "never"',
      'sandbox_mode = "workspace-write"',
      '',
      '[model_providers.'+selectedProviderId+']',
      'name = '+tomlString(providerName||selectedProviderId),
      'base_url = '+tomlString(url.href.replace(/\/$/,'')),
      'wire_api = '+tomlString(wire),
      'env_key = '+tomlString(key),
      'requires_openai_auth = false',
      ...WINDOWS_SANDBOX_TABLE,
      ''
    ].join('\n');
    await writeAtomic(path.join(codexHome,'config.toml'),config);
    const env={CODEX_HOME:codexHome};
    if(apiKey)env[key]=String(apiKey);
    return {
      schema:WORKER_SCHEMA,id,name:String(workerName||id),providerId:selectedProviderId,provider:String(providerName||selectedProviderId),
      model:selectedModel,role:'builder',codexHome,runtimeDir,wireApi:wire,baseUrl:url.href.replace(/\/$/,''),isolated:true,env
    };
  }

  async inspect(workerId){
    const id=safeWorkerId(workerId);
    const codexHome=this.codexHome(id);
    const configPath=path.join(codexHome,'config.toml');
    const configPresent=await fs.stat(configPath).then(x=>x.isFile()).catch(()=>false);
    let authPresent=false;
    for(const name of ['auth.json','credentials.json']){
      if(await fs.stat(path.join(codexHome,name)).then(x=>x.isFile()).catch(()=>false)){authPresent=true;break;}
    }
    return {schema:WORKER_SCHEMA,id,codexHome,runtimeDir:this.runtimeDir(id),configPresent,authPresent};
  }
}

module.exports={WORKER_SCHEMA,WORKER_IDS,CodexWorkerRuntime,safeWorkerId,normalizeWireApi,tomlString};
