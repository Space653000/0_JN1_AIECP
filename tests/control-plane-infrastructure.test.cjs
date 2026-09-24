'use strict';
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs/promises');
const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');
const {LockManager}=require('../electron/lib/lock-manager.cjs');
const {ContextBus}=require('../electron/lib/context-bus.cjs');
const {EvidenceManager}=require('../electron/lib/evidence-manager.cjs');

(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aepc-'));
  const p=new SecurityPolicy({allowRoots:[root]});
  assert.equal(p.check({action:'READ',path:path.join(root,'x')}).allowed,true);
  assert.equal(p.check({action:'PUSH',path:path.join(root,'x')}).requiresApproval,true);
  const lm=new LockManager(path.join(root,'locks'),{leaseMs:1000});
  await lm.init(); const l=await lm.acquire('repo','test'); assert.equal(l.owner,'test');
  await assert.rejects(()=>lm.acquire('repo','other'));
  await lm.release('repo','test',l.token);
  const ev=new EvidenceManager(root); await ev.init(); const evidence=await ev.write('run','result.json',{ok:true}); assert.equal(evidence.bytes>0,true);
  const bus=new ContextBus(root); await bus.init(); const cap=await bus.write('test',{hello:'world'}); assert.equal((await bus.read(cap.id)).payload.hello,'world');
  await fs.rm(root,{recursive:true,force:true});
  console.log('control-plane infrastructure tests passed');
})().catch(e=>{console.error(e);process.exit(1);});