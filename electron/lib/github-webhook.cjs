'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
// A workflow_run id correlates CI runs; a repository_dispatch may carry a versioned AECP event with its own correlation id.
// Anything unversioned or malformed is still accepted as an event, but never trusted as a correlation id.
function correlationOf(type,payload){
 if(payload?.workflow_run?.id)return String(payload.workflow_run.id);
 if(type==='repository_dispatch'){const p=payload?.client_payload;if(p&&p.schema==='aecp.event/v1'&&typeof p.correlationId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(p.correlationId))return p.correlationId;}
 return null;
}
class GitHubWebhookReceiver{
 constructor({secret,host='127.0.0.1',port=0,onEvent}={}){this.secret=secret;this.host=host;this.port=port;this.onEvent=onEvent;this.server=null;}
 verify(raw,signature){if(typeof signature!=='string'||!signature.startsWith('sha256='))return false;const expected=Buffer.from(crypto.createHmac('sha256',this.secret).update(raw).digest('hex'));const given=Buffer.from(signature.slice(7));if(given.length!==expected.length)return false;return crypto.timingSafeEqual(expected,given);}
 async start(){if(this.server)return this.info();if(!this.secret)throw new Error('GitHub webhook secret is required.');this.server=http.createServer(async(req,res)=>{if(req.method!=='POST'||req.url!=='/github/webhook'){res.writeHead(404);res.end();return}const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);if(!this.verify(raw,req.headers['x-hub-signature-256'])){res.writeHead(401);res.end('unauthorized');return}let payload;try{payload=JSON.parse(raw.toString('utf8'))}catch{res.writeHead(400);res.end('invalid json');return}const delivery=req.headers['x-github-delivery'];const type=req.headers['x-github-event'];try{await this.onEvent({externalId:String(delivery||''),idempotencyKey:'github:'+String(delivery||crypto.createHash('sha256').update(raw).digest('hex')),correlationId:correlationOf(type,payload),eventType:type,payload})}catch(e){res.writeHead(500);res.end(String(e.message||e));return}res.writeHead(202,{'content-type':'application/json'});res.end(JSON.stringify({accepted:true}))});await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,this.host,resolve)});return this.info()}
 info(){const a=this.server?.address();return{enabled:Boolean(this.server),host:this.host,port:a?.port||null,endpoint:'/github/webhook'}};
 async stop(){if(!this.server)return;await new Promise(r=>this.server.close(r));this.server=null}
}
module.exports={GitHubWebhookReceiver};