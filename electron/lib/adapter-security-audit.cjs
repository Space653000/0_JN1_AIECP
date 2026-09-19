'use strict';

const CAPABILITIES=Object.freeze(['READ','WRITE','EXECUTE','NETWORK','CREDENTIAL']);

const DEFAULT_ADAPTERS=Object.freeze([
  {id:'filesystem',kind:'tool',capabilities:{READ:'ALLOW',WRITE:'POLICY',EXECUTE:'DENY',NETWORK:'DENY',CREDENTIAL:'DENY'}},
  {id:'shell',kind:'tool',capabilities:{READ:'ALLOW',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'POLICY',CREDENTIAL:'DENY'}},
  {id:'git',kind:'tool',capabilities:{READ:'ALLOW',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'POLICY',CREDENTIAL:'DENY'}},
  {id:'github',kind:'external',capabilities:{READ:'POLICY',WRITE:'POLICY',EXECUTE:'DENY',NETWORK:'POLICY',CREDENTIAL:'REFERENCE_ONLY'}},
  {id:'browser',kind:'external',capabilities:{READ:'POLICY',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'POLICY',CREDENTIAL:'DENY'}},
  {id:'desktop',kind:'tool',capabilities:{READ:'POLICY',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'DENY',CREDENTIAL:'DENY'}},
  {id:'python',kind:'tool',capabilities:{READ:'ALLOW',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'DENY',CREDENTIAL:'DENY'}},
  {id:'local-compute',kind:'local',capabilities:{READ:'ALLOW',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'DENY',CREDENTIAL:'DENY'}},
  {id:'claude',kind:'provider',capabilities:{READ:'POLICY',WRITE:'DENY',EXECUTE:'DENY',NETWORK:'POLICY',CREDENTIAL:'REFERENCE_ONLY'}},
  {id:'codex',kind:'provider',capabilities:{READ:'POLICY',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'POLICY',CREDENTIAL:'REFERENCE_ONLY'}},
  {id:'gemini',kind:'provider',capabilities:{READ:'POLICY',WRITE:'DENY',EXECUTE:'DENY',NETWORK:'POLICY',CREDENTIAL:'REFERENCE_ONLY'}},
  {id:'opencode',kind:'provider',capabilities:{READ:'POLICY',WRITE:'POLICY',EXECUTE:'POLICY',NETWORK:'POLICY',CREDENTIAL:'REFERENCE_ONLY'}},
  {id:'ollama',kind:'provider',capabilities:{READ:'POLICY',WRITE:'DENY',EXECUTE:'DENY',NETWORK:'DENY',CREDENTIAL:'DENY'}},
  {id:'remote-gateway',kind:'gateway',capabilities:{READ:'POLICY',WRITE:'DENY',EXECUTE:'DENY',NETWORK:'LOOPBACK_ONLY',CREDENTIAL:'EPHEMERAL'}},
  {id:'github-webhook',kind:'external',capabilities:{READ:'POLICY',WRITE:'DENY',EXECUTE:'DENY',NETWORK:'INBOUND_SIGNED_ONLY',CREDENTIAL:'SECRET_REFERENCE'}}
]);

function audit(adapters=DEFAULT_ADAPTERS){
  const findings=[];
  const seen=new Set();
  for(const adapter of adapters){
    if(!adapter?.id){findings.push({severity:'ERROR',type:'MISSING_ADAPTER_ID'});continue;}
    if(seen.has(adapter.id))findings.push({severity:'ERROR',type:'DUPLICATE_ADAPTER',adapter:adapter.id});
    seen.add(adapter.id);
    for(const capability of CAPABILITIES){
      const decision=adapter.capabilities?.[capability];
      if(!decision)findings.push({severity:'ERROR',type:'MISSING_POLICY_DECISION',adapter:adapter.id,capability});
    }
  }
  return {
    ok:findings.every(x=>x.severity!=='ERROR'),
    capabilities:[...CAPABILITIES],
    adapters:adapters.map(a=>({id:a.id,kind:a.kind,capabilities:{...a.capabilities}})),
    findings
  };
}

module.exports={CAPABILITIES,DEFAULT_ADAPTERS,audit};
