'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {ResourceManager}=require('../electron/lib/resource-manager.cjs');
const {LockManager}=require('../electron/lib/lock-manager.cjs');
const {EventLedger}=require('../electron/lib/event-ledger.cjs');
const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');
const {MaintenanceManager}=require('../electron/lib/maintenance.cjs');
const {ContextBus}=require('../electron/lib/context-bus.cjs');
const {EvidenceManager}=require('../electron/lib/evidence-manager.cjs');
const {buildRecoveryPlan}=require('../electron/lib/failure-recovery.cjs');

async function tmp(){return fs.mkdtemp(path.join(os.tmpdir(),'aecp-e2e-'));}

test('canonical loop infrastructure is deterministic on a clean temporary Git repository',async()=>{
 const root=await tmp();
 execFileSync('git',['init','-q'],{cwd:root});
 execFileSync('git',['config','user.email','a@aecp.local'],{cwd:root});
 execFileSync('git',['config','user.name','AECP Test'],{cwd:root});
 await fs.writeFile(path.join(root,'README.md'),'# temporary\n');
 execFileSync('git',['add','.'],{cwd:root});
 execFileSync('git',['commit','-qm','initial'],{cwd:root});

 const resources=new ResourceManager(path.join(root,'.aecp-resources'));await resources.init();
 const repos=await resources.scan(root);assert.equal(repos.length,1);

 const locks=new LockManager(path.join(root,'.aecp-locks'));await locks.init();
 const evidence=new EvidenceManager(path.join(root,'.aecp-evidence'));await evidence.init();
 const context=new ContextBus(path.join(root,'.aecp-context'));await context.init();
 const maintenance=new MaintenanceManager({locks,evidence,contextBus:context});

 const policy=new SecurityPolicy({allowRoots:[root],maxRisk:'YELLOW'});
 assert.equal(policy.check({action:'READ',path:root}).allowed,true);
 assert.equal(policy.check({action:'WRITE',path:path.join(root,'work')}).allowed,true);
 assert.equal(policy.check({action:'MERGE',path:root}).requiresApproval,true);

 const lock=await locks.acquire('repo:'+root,'e2e');
 const eventLedger=new EventLedger(path.join(root,'.aecp-events.jsonl'));await eventLedger.init();
 await eventLedger.append({type:'task.queued',idempotencyKey:'task:e2e'});
 await eventLedger.append({type:'task.running',idempotencyKey:'task:e2e:running'});
 const evidenceFile=await evidence.write('mission-e2e','task-e2e.json',{verified:true,commit:'local'});
 assert.ok(evidenceFile);
 await locks.release(lock.key,'e2e',lock.token);

 const recovery=buildRecoveryPlan({error:'test failed: assertion mismatch',phase:'VERIFYING'});
 assert.equal(recovery.autoEligible,true);
 assert.equal(recovery.authority,'NO_NEW_PERMISSIONS');

 const maintenanceResult=await maintenance.run({evidenceRetentionDays:30,maxEvidenceRuns:100,driftRoots:[root]});
 assert.equal(maintenanceResult.adapterSecurity.ok,true);
 assert.ok(Array.isArray(maintenanceResult.drift));

 assert.equal((await eventLedger.append({type:'duplicate',idempotencyKey:'task:e2e'})).duplicate,true);
});
