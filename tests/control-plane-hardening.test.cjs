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
 const p=new SecurityPolicy({allowRoots:['C:\work'],maxRisk:'YELLOW'});
 assert.equal(p.check({action:'MERGE',path:'C:\work',approved:false}).requiresApproval,true);
 assert.equal(p.check({action:'WRITE',path:'C:\other',approved:true}).allowed,false);
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
