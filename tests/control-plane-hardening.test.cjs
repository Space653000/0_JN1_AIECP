'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventLedger}=require('../electron/lib/event-ledger.cjs');
const {ResourceManager}=require('../electron/lib/resource-manager.cjs');
const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');
const {RemoteGateway}=require('../electron/lib/remote-gateway.cjs');

async function tmp(){return fs.mkdtemp(path.join(os.tmpdir(),'aecp-infra-'));}

test('event ledger deduplicates external events',async()=>{
 const root=await tmp(), ledger=new EventLedger(path.join(root,'events.jsonl')); await ledger.init();
 const a=await ledger.append({type:'ci.completed',idempotencyKey:'run:123',runId:'r1'});
 const b=await ledger.append({type:'ci.completed',idempotencyKey:'run:123',runId:'r1'});
 assert.equal(a.duplicate,false); assert.equal(b.duplicate,true);
});

test('resource manager discovers a git repository and binds task resources',async()=>{
 const root=await tmp();
 const {execFileSync}=require('node:child_process');
 execFileSync('git',['init','-q'],{cwd:root});
 const rm=new ResourceManager(path.join(root,'.aecp')); await rm.init();
 const repos=await rm.scan(root);
 assert.equal(repos.length,1);
 const task=rm.bindTask({}, {repositories:[repos[0].path]});
 assert.equal(task.resources.resourceCount,1);
});

test('security policy requires approval for merge and rejects outside root',()=>{
 const p=new SecurityPolicy({allowRoots:['C:\\work'],maxRisk:'YELLOW'});
 assert.equal(p.check({action:'MERGE',path:'C:\\work',approved:false}).requiresApproval,true);
 assert.equal(p.check({action:'WRITE',path:'C:\\other',approved:true}).allowed,false);
});

test('remote gateway is loopback and read-only',async()=>{
 const gateway=new RemoteGateway({status:async()=>({ok:true}),replay:async()=>[]});
 const info=await gateway.start();
 assert.equal(info.host,'127.0.0.1'); assert.equal(info.readOnly,true);
 const http=require('node:http');
 const request=(pathName,headers={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:info.port,path:pathName,headers},res=>{let d='';res.on('data',b=>d+=b);res.on('end',()=>resolve({status:res.statusCode,body:d}))});req.on('error',reject);req.end()});
 const denied=await request('/api/status'); assert.equal(denied.status,401);
 const ok=await request('/api/status',{authorization:'Bearer '+info.token}); assert.equal(ok.status,200);
 await gateway.stop();
});


test('GitHub webhook verifies HMAC and deduplicates delivery identity', async () => {
 const {GitHubWebhookReceiver}=require('../electron/lib/github-webhook.cjs');
 const secret='test-secret', received=[];
 const receiver=new GitHubWebhookReceiver({secret,onEvent:async e=>received.push(e)});
 const info=await receiver.start();
 const http=require('node:http'), crypto=require('node:crypto');
 const body=JSON.stringify({workflow_run:{id:123}});
 const sig='sha256='+crypto.createHmac('sha256',secret).update(body).digest('hex');
 const response=await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:info.port,path:'/github/webhook',method:'POST',headers:{'x-hub-signature-256':sig,'x-github-delivery':'delivery-1','x-github-event':'workflow_run','content-type':'application/json'}},res=>{let d='';res.on('data',b=>d+=b);res.on('end',()=>resolve({status:res.statusCode,body:d}))});req.on('error',reject);req.write(body);req.end()});
 assert.equal(response.status,202);assert.equal(received[0].idempotencyKey,'github:delivery-1');
 await receiver.stop();
});


test('maintenance manager can recover locks and garbage collect expired capsules', async () => {
 const {LockManager}=require('../electron/lib/lock-manager.cjs');
 const {ContextBus}=require('../electron/lib/context-bus.cjs');
 const {EvidenceManager}=require('../electron/lib/evidence-manager.cjs');
 const {MaintenanceManager}=require('../electron/lib/maintenance.cjs');
 const root=await tmp(), locks=new LockManager(path.join(root,'locks'),{leaseMs:1}); await locks.init();
 const l=await locks.acquire('x','owner'); await new Promise(r=>setTimeout(r,5));
 const bus=new ContextBus(root); await bus.init(); const cap=await bus.write('maintenance',{ok:true},{ttlMs:1}); await new Promise(r=>setTimeout(r,5));
 const evidence=new EvidenceManager(path.join(root,'evidence')); await evidence.init();
 const m=new MaintenanceManager({locks,evidence,contextBus:bus}); const result=await m.run({evidenceRetentionDays:0,maxEvidenceRuns:0});
 assert.equal(result.locksRecovered,1); assert.equal(result.capsulesRemoved>=1,true);
 await assert.rejects(()=>bus.read(cap.id));
});


test('failure recovery assistant only auto-eligible bounded low-risk classes',()=>{
 const {classifyFailure,recommend}=require('../electron/lib/failure-recovery.cjs');
 assert.equal(classifyFailure({error:'ECONNRESET while fetching'}),'TRANSIENT');
 assert.equal(recommend({error:'ECONNRESET while fetching'}).autoEligible,true);
 assert.equal(recommend({error:'permission denied for credential'}).action,'HUMAN_REQUIRED');
 assert.equal(recommend({error:'unknown compiler anomaly'}).autoEligible,false);
});


test('drift scanner detects missing authoritative files without mutating the workspace', async()=>{
 const {scan}=require('../electron/lib/drift-scanner.cjs');
 const root=await tmp();
 await fs.mkdir(path.join(root,'Blueprint'),{recursive:true});
 await fs.writeFile(path.join(root,'README.md'),'# AECP\\n');
 const result=await scan(root);
 assert.equal(result.ok,false);
 assert.equal(result.findings.some(x=>x.type==='MISSING_REQUIRED_FILE'&&x.path==='Blueprint/00_MASTER_BLUEPRINT.md'),true);
});
