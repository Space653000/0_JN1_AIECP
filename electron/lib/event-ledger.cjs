'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
class EventLedger{
 constructor(file){this.file=path.resolve(file);this.seen=new Map();}
 async init(){await fs.mkdir(path.dirname(this.file),{recursive:true});try{const lines=(await fs.readFile(this.file,'utf8')).split(/\r?\n/).filter(Boolean);for(const line of lines.slice(-10000)){try{const e=JSON.parse(line);if(e.idempotencyKey)this.seen.set(e.idempotencyKey,e.eventId)}catch{}}}catch(e){if(e.code!=='ENOENT')throw e;}}
 key(e){return e?.idempotencyKey||e?.externalId||null;}
 async append(event){const e={schema:'aecp.event-ledger/v1',eventId:event.eventId||id(),correlationId:event.correlationId||event.runId||null,at:event.at||now(),...event};const k=this.key(e);if(k&&this.seen.has(k))return{duplicate:true,eventId:this.seen.get(k)};await fs.appendFile(this.file,JSON.stringify(e)+'\n','utf8');if(k)this.seen.set(k,e.eventId);return{duplicate:false,event:e};}
 // Every external.received record still on disk (the last 10000 lines), so a crash between received and correlated can be repaired.
 async receivedRecords(){try{return (await fs.readFile(this.file,'utf8')).split(/\r?\n/).filter(Boolean).slice(-10000).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(e=>e&&e.type==='external.received');}catch(e){if(e.code==='ENOENT')return[];throw e;}}
 async has(key){return Boolean(key&&this.seen.has(key));}
}
module.exports={EventLedger};