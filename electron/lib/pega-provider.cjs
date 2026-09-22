'use strict';

const PEGA_PROVIDER_ID='codex-pega';
const PEGA_WORKER_ID='codex-pega';
const PEGA_BASE_URL='https://aiapi.t-cyber.com/v1';
const PEGA_ENV_KEY='AECP_PEGA_API_KEY';
const PEGA_WIRE_APIS=Object.freeze(['responses','chat']);

function normalizePegaWireApi(value){
  const wire=String(value||'responses').trim().toLowerCase();
  if(!PEGA_WIRE_APIS.includes(wire))throw new Error('PEGA wire API must be "responses" or "chat".');
  return wire;
}

function makePegaProvider({model='',wireApi='responses',apiKey='',codexHome=''}={}){
  const selectedModel=String(model||'').trim().slice(0,200);
  return {
    id:PEGA_PROVIDER_ID,
    name:'PEGA',
    workerId:PEGA_WORKER_ID,
    workerName:'Codex PEGA',
    command:'codex',
    mode:'codex-cli',
    roles:['builder'],
    providerName:'PEGA',
    baseUrl:PEGA_BASE_URL,
    defaultModel:selectedModel||null,
    wireApi:normalizePegaWireApi(wireApi),
    envKey:PEGA_ENV_KEY,
    apiKey:String(apiKey||''),
    requiresCredential:true,
    network:true,
    credential:Boolean(apiKey),
    codexHome:String(codexHome||''),
    kind:'codex-worker'
  };
}

module.exports={
  PEGA_PROVIDER_ID,
  PEGA_WORKER_ID,
  PEGA_BASE_URL,
  PEGA_ENV_KEY,
  PEGA_WIRE_APIS,
  normalizePegaWireApi,
  makePegaProvider
};
