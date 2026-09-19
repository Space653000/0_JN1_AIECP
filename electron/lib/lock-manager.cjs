'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const id=()=>crypto.randomBytes(8).toString('hex');
const now=()=>new Date().toISOString();
class LockManager{
 constructor(root,{leaseMs=900000}={}){this.root=path.resolve(root);this.file=path.join(this.root,'locks.json');this.leaseMs=leaseMs;this.state={schema:'aecp.locks/v1',locks:{}};}
 async init(){await fs.mkdir(this.root,{recursive:true});try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;await this.persist();}await this.recover();return this.state;}
 async persist(){const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify(this.state,null,2));await fs.rename(tmp,this.file);}
 async recover(){const t=Date.now();for(const [k,v] of Object.entries(this.state.locks)){if(Date.parse(v.expiresAt)<=t)delete this.state.locks[k];}await this.persist();}
 async acquire(key,owner,{leaseMs=this.leaseMs,meta={}}={}){await this.recover();const x=this.state.locks[key];if(x&&x.owner!==owner)throw new Error('Lock busy: '+key);const token=x?.token||id();this.state.locks[key]={key,owner,token,meta,acquiredAt:x?.acquiredAt||now(),expiresAt:new Date(Date.now()+leaseMs).toISOString()};await this.persist();return this.state.locks[key];}
 async renew(key,owner,token){const x=this.state.locks[key];if(!x||x.owner!==owner||x.token!==token)throw new Error('Lock ownership mismatch.');x.expiresAt=new Date(Date.now()+this.leaseMs).toISOString();await this.persist();return x;}
 async release(key,owner,token){const x=this.state.locks[key];if(!x)return false;if(x.owner!==owner||x.token!==token)throw new Error('Lock ownership mismatch.');delete this.state.locks[key];await this.persist();return true;}
 list(){return Object.values(this.state.locks);}
}
module.exports={LockManager};