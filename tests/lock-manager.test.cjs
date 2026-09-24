'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {LockManager}=require('../electron/lib/lock-manager.cjs');

test('concurrent acquisition of one key has exactly one task owner',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-lock-race-'));
  try{
    const lm=new LockManager(root,{leaseMs:60000});
    await lm.init();
    const results=await Promise.allSettled(
      Array.from({length:20},(_,i)=>lm.acquire('repo:C:/work','task-'+i,{meta:{taskId:'task-'+i}}))
    );
    const fulfilled=results.filter(x=>x.status==='fulfilled');
    const rejected=results.filter(x=>x.status==='rejected');
    assert.equal(fulfilled.length,1);
    assert.equal(rejected.length,19);
    assert.ok(rejected.every(x=>x.reason?.code==='LOCK_BUSY'));
    const locks=lm.list();
    assert.equal(locks.length,1);
    assert.equal(locks[0].owner,fulfilled[0].value.owner);
    const persisted=JSON.parse(await fs.readFile(path.join(root,'locks.json'),'utf8'));
    assert.equal(Object.keys(persisted.locks).length,1);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('concurrent independent lock mutations persist without temp-file races or lost locks',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-lock-persist-'));
  try{
    const lm=new LockManager(root,{leaseMs:60000});
    await lm.init();
    const locks=await Promise.all(Array.from({length:30},(_,i)=>lm.acquire('repo:'+i,'task-'+i,{meta:{taskId:'task-'+i}})));
    assert.equal(lm.list().length,30);
    await Promise.all(locks.map(lock=>lm.renew(lock.key,lock.owner,lock.token)));
    const persisted=JSON.parse(await fs.readFile(path.join(root,'locks.json'),'utf8'));
    assert.equal(Object.keys(persisted.locks).length,30);
    await Promise.all(locks.map(lock=>lm.release(lock.key,lock.owner,lock.token)));
    assert.equal(lm.list().length,0);
    const finalState=JSON.parse(await fs.readFile(path.join(root,'locks.json'),'utf8'));
    assert.equal(Object.keys(finalState.locks).length,0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('expired lease recovery is explicit and persisted',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-lock-recover-'));
  try{
    const lm=new LockManager(root,{leaseMs:1000});
    await lm.init();
    const lock=await lm.acquire('repo','task',{leaseMs:1000});
    lm.state.locks[lock.key].expiresAt=new Date(Date.now()-1000).toISOString();
    await lm.persist();
    const removed=await lm.recover();
    assert.deepEqual(removed,['repo']);
    assert.equal(lm.list().length,0);
    const persisted=JSON.parse(await fs.readFile(path.join(root,'locks.json'),'utf8'));
    assert.equal(persisted.locks.repo,undefined);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('renew and release require exact task ownership token',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-lock-owner-'));
  try{
    const lm=new LockManager(root,{leaseMs:60000});
    await lm.init();
    const lock=await lm.acquire('repo','task-a');
    await assert.rejects(()=>lm.renew('repo','task-b',lock.token),e=>e?.code==='LOCK_OWNERSHIP_MISMATCH');
    await assert.rejects(()=>lm.release('repo','task-a','wrong-token'),e=>e?.code==='LOCK_OWNERSHIP_MISMATCH');
    assert.equal(lm.list().length,1);
    assert.equal(await lm.release('repo','task-a',lock.token),true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
