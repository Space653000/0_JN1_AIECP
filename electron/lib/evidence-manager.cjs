'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
async function sha256(file){return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');}
class EvidenceManager{
 constructor(root){this.root=path.resolve(root);}
 async init(){await fs.mkdir(this.root,{recursive:true});}
 async write(runId,name,value){const dir=path.join(this.root,runId);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name);await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2));const st=await fs.stat(file);return{file,sha256:await sha256(file),bytes:st.size};}
 async appendEvent(runId,event){const dir=path.join(this.root,runId);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'events.jsonl');await fs.appendFile(file,JSON.stringify(event)+'\n');return{file,sha256:await sha256(file)};}
 async manifest(runId,items=[]){const out=[];for(const item of items){out.push({...item,sha256:await sha256(path.resolve(item.file))});}return this.write(runId,'manifest.json',{schema:'aecp.evidence/v1',runId,createdAt:new Date().toISOString(),items:out});}
}
module.exports={EvidenceManager};