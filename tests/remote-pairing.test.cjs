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
