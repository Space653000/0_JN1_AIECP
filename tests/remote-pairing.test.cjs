'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {RemoteGateway}=require('../electron/lib/remote-gateway.cjs');

test('remote gateway supports one-time pairing and revocation',async()=>{
 const gateway=new RemoteGateway({status:async()=>({ok:true}),replay:async()=>[]});
 const info=await gateway.start();
 const http=require('node:http');
 const request=(pathName,headers={})=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:info.port,path:pathName,headers},res=>{
   let d='';res.on('data',b=>d+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(d)}));
  });req.on('error',reject);req.end();
 });
 const pair=await request('/pair/start',{authorization:'Bearer '+info.token});
 assert.equal(pair.status,200);
 const claimed=await request('/pair/claim?code='+pair.body.code+'&device=test-phone');
 assert.equal(claimed.status,200);
 assert.equal(claimed.body.scope,'READ_ONLY');
 const status=await request('/api/status',{authorization:'Bearer '+claimed.body.token});
 assert.equal(status.status,200);
 assert.equal(gateway.revokeDevice(claimed.body.token),true);
 const denied=await request('/api/status',{authorization:'Bearer '+claimed.body.token});
 assert.equal(denied.status,401);
 await gateway.stop();
});

test('remote gateway refuses non-loopback exposure without explicit enablement and TLS', () => {
 assert.throws(
  () => new RemoteGateway({status:async()=>({}),replay:async()=>[],host:'0.0.0.0'}),
  /allowRemote=true/
 );
 assert.throws(
  () => new RemoteGateway({status:async()=>({}),replay:async()=>[],host:'0.0.0.0',allowRemote:true}),
  /requires TLS/
 );
});

test('TLS remote gateway serves paired read-only status over HTTPS', async (t) => {
 const {spawnSync}=require('node:child_process');
 const fs=require('node:fs');
 const fsp=require('node:fs/promises');
 const os=require('node:os');
 const path=require('node:path');
 const https=require('node:https');
 const probe=spawnSync('openssl',['version'],{encoding:'utf8'});
 if(probe.status!==0){t.skip('openssl unavailable on this runner');return}
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'aecp-tls-'));
 t.after(async()=>fsp.rm(dir,{recursive:true,force:true}));
 const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
 const generated=spawnSync('openssl',[
  'req','-x509','-newkey','rsa:2048','-nodes','-sha256',
  '-subj','/CN=localhost','-keyout',key,'-out',cert,'-days','1'
 ],{encoding:'utf8'});
 assert.equal(generated.status,0,generated.stderr||generated.stdout);

 const gateway=new RemoteGateway({
  status:async()=>({runs:[{id:'r1'}],tasks:[{id:'t1'}],approvals:[]}),
  replay:async()=>[{type:'event'}],
  host:'127.0.0.1',
  tls:{key:fs.readFileSync(key),cert:fs.readFileSync(cert)}
 });
 const info=await gateway.start();
 assert.equal(info.protocol,'https');
 assert.equal(info.secure,true);

 const request=(pathName,headers={})=>new Promise((resolve,reject)=>{
  const req=https.request({
   host:'127.0.0.1',port:info.port,path:pathName,headers,rejectUnauthorized:false
  },res=>{
   let d='';res.on('data',b=>d+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(d)}));
  });
  req.on('error',reject);req.end();
 });

 try{
  const pair=await request('/pair/start',{authorization:'Bearer '+info.token});
  assert.equal(pair.status,200);
  const claimed=await request('/pair/claim?code='+pair.body.code+'&device=tls-phone');
  assert.equal(claimed.status,200);
  const tasks=await request('/api/tasks',{authorization:'Bearer '+claimed.body.token});
  assert.equal(tasks.status,200);
  assert.equal(tasks.body.tasks[0].id,'t1');
  const post=await new Promise((resolve,reject)=>{
   const req=https.request({host:'127.0.0.1',port:info.port,path:'/api/tasks',method:'POST',rejectUnauthorized:false,headers:{authorization:'Bearer '+claimed.body.token}},res=>{
    let d='';res.on('data',b=>d+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(d)}));
   });req.on('error',reject);req.end();
  });
  assert.equal(post.status,405);
 } finally {
  await gateway.stop();
 }
});

test('approval-only paired device can decide existing approvals but cannot submit tasks', async () => {
 const decisions=[];
 const gateway=new RemoteGateway({
  status:async()=>({runs:[],tasks:[],approvals:[{id:'a1',state:'WAITING'}]}),
  replay:async()=>[],
  approve:async(id,ctx)=>{decisions.push({action:'approve',id,ctx});return{id,state:'APPROVED'};},
  reject:async(id,ctx)=>{decisions.push({action:'reject',id,ctx});return{id,state:'REJECTED'};}
 });
 const info=await gateway.start();
 const http=require('node:http');
 const request=(pathName,{headers={},method='GET'}={})=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:info.port,path:pathName,headers,method},res=>{
   let d='';res.on('data',b=>d+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(d)}));
  });req.on('error',reject);req.end();
 });
 try{
  const readPair=await request('/pair/start?scope=READ_ONLY',{headers:{authorization:'Bearer '+info.token}});
  const readClaim=await request('/pair/claim?code='+readPair.body.code+'&device=read-phone');
  const readDenied=await request('/api/approvals/a1/approve',{
   method:'POST',
   headers:{authorization:'Bearer '+readClaim.body.token,'x-aecp-request-id':'read-attempt-001'}
  });
  assert.equal(readDenied.status,403);

  const approvalPair=await request('/pair/start?scope=APPROVAL_ONLY',{headers:{authorization:'Bearer '+info.token}});
  const approvalClaim=await request('/pair/claim?code='+approvalPair.body.code+'&device=approval-phone');
  assert.equal(approvalClaim.body.scope,'APPROVAL_ONLY');

  const missingReplayKey=await request('/api/approvals/a1/approve',{
   method:'POST',
   headers:{authorization:'Bearer '+approvalClaim.body.token}
  });
  assert.equal(missingReplayKey.status,400);

  const approved=await request('/api/approvals/a1/approve',{
   method:'POST',
   headers:{authorization:'Bearer '+approvalClaim.body.token,'x-aecp-request-id':'approve-a1-001'}
  });
  assert.equal(approved.status,200);
  assert.equal(approved.body.approval.state,'APPROVED');
  assert.equal(decisions[0].ctx.deviceId,'approval-phone');

  const taskWrite=await request('/api/tasks',{
   method:'POST',
   headers:{authorization:'Bearer '+approvalClaim.body.token,'x-aecp-request-id':'task-write-001'}
  });
  assert.equal(taskWrite.status,405);
 } finally {
  await gateway.stop();
 }
});
