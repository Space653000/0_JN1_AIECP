'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
class ContextBus{
 constructor(root){this.dir=path.join(path.resolve(root),'capsules');}
 async init(){await fs.mkdir(this.dir,{recursive:true});}
 async write(kind,payload,{ttlMs=86400000,maxBytes=131072}={}){const x={schema:'aecp.capsule/v1',id:'cap-'+crypto.randomBytes(6).toString('hex'),kind,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+ttlMs).toISOString(),payload};const s=JSON.stringify(x);if(Buffer.byteLength(s)>maxBytes)throw new Error('Context capsule exceeds bounded size.');x.sha256=crypto.createHash('sha256').update(s).digest('hex');await fs.writeFile(path.join(this.dir,x.id+'.json'),JSON.stringify(x,null,2));return x;}
 async read(id){return JSON.parse(await fs.readFile(path.join(this.dir,id+'.json'),'utf8'));}
 async gc(){const files=await fs.readdir(this.dir).catch(()=>[]);let n=0;for(const f of files.filter(x=>x.endsWith('.json'))){const p=path.join(this.dir,f);try{const x=JSON.parse(await fs.readFile(p,'utf8'));if(Date.parse(x.expiresAt)<Date.now()){await fs.rm(p);n++;}}catch{}}return n;}
}
module.exports={ContextBus};