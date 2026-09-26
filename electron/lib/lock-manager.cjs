'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const id=()=>crypto.randomBytes(8).toString('hex');
const now=()=>new Date().toISOString();

class LockManager{
  constructor(root,{leaseMs=900000}={}){
    this.root=path.resolve(root);
    this.file=path.join(this.root,'locks.json');
    this.leaseMs=leaseMs;
    this.state={schema:'aecp.locks/v1',locks:{}};
    this.queue=Promise.resolve();
    this.persistSequence=0;
  }

  async init(){
    await fs.mkdir(this.root,{recursive:true});
    try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}
    catch(e){
      if(e.code!=='ENOENT')throw e;
      await this._persistUnlocked();
    }
    await this.recover();
    return this.state;
  }

  _enqueue(work){
    const operation=this.queue.then(work,work);
    this.queue=operation.catch(()=>{});
    return operation;
  }

  async _persistUnlocked(){
    const tmp=this.file+'.tmp-'+process.pid+'-'+(++this.persistSequence);
    await fs.mkdir(this.root,{recursive:true});
    await fs.writeFile(tmp,JSON.stringify(this.state,null,2),'utf8');
    await fs.rename(tmp,this.file);
  }

  async persist(){
    return this._enqueue(()=>this._persistUnlocked());
  }

  async _recoverUnlocked(){
    const t=Date.now();
    const removed=[];
    const released=[];
    for(const [key,value] of Object.entries(this.state.locks||{})){
      if(!Number.isFinite(Date.parse(value?.expiresAt))||Date.parse(value.expiresAt)<=t){
        // A stale lock never disappears silently: keep who held it, why it went and when (no metadata, so no secrets).
        released.push({key,owner:String(value?.owner||''),reason:'EXPIRED',expiredAt:Number.isFinite(Date.parse(value?.expiresAt))?value.expiresAt:null,releasedAt:now()});
        delete this.state.locks[key];
        removed.push(key);
      }
    }
    if(removed.length){
      this.state.released=[...(Array.isArray(this.state.released)?this.state.released:[]),...released].slice(-100);
      await this._persistUnlocked();
    }
    Object.defineProperty(removed,'released',{value:released,enumerable:false});
    return removed;
  }

  async recover(){
    return this._enqueue(()=>this._recoverUnlocked());
  }

  async acquire(key,owner,{leaseMs=this.leaseMs,meta={}}={}){
    return this._enqueue(async()=>{
      await this._recoverUnlocked();
      const lockKey=String(key||'');
      const lockOwner=String(owner||'');
      if(!lockKey||!lockOwner)throw new Error('Lock key and owner are required.');
      const current=this.state.locks[lockKey];
      if(current&&current.owner!==lockOwner)throw Object.assign(new Error('Lock busy: '+lockKey),{code:'LOCK_BUSY',key:lockKey,owner:current.owner});
      const token=current?.token||id();
      const value={
        key:lockKey,
        owner:lockOwner,
        token,
        meta:{...meta},
        acquiredAt:current?.acquiredAt||now(),
        expiresAt:new Date(Date.now()+Math.max(1000,Number(leaseMs)||this.leaseMs)).toISOString()
      };
      this.state.locks[lockKey]=value;
      await this._persistUnlocked();
      return {...value,meta:{...value.meta}};
    });
  }

  async renew(key,owner,token){
    return this._enqueue(async()=>{
      const current=this.state.locks[String(key||'')];
      if(!current||current.owner!==String(owner||'')||current.token!==String(token||'')){
        throw Object.assign(new Error('Lock ownership mismatch.'),{code:'LOCK_OWNERSHIP_MISMATCH'});
      }
      current.expiresAt=new Date(Date.now()+this.leaseMs).toISOString();
      await this._persistUnlocked();
      return {...current,meta:{...(current.meta||{})}};
    });
  }

  async release(key,owner,token){
    return this._enqueue(async()=>{
      const lockKey=String(key||'');
      const current=this.state.locks[lockKey];
      if(!current)return false;
      if(current.owner!==String(owner||'')||current.token!==String(token||'')){
        throw Object.assign(new Error('Lock ownership mismatch.'),{code:'LOCK_OWNERSHIP_MISMATCH'});
      }
      delete this.state.locks[lockKey];
      await this._persistUnlocked();
      return true;
    });
  }

  list(){
    return Object.values(this.state.locks||{}).map(item=>({...item,meta:{...(item.meta||{})}}));
  }
}

module.exports={LockManager};
