'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
class RemoteGateway{
 constructor({status,replay,port=0}={}){this.status=status;this.replay=replay;this.port=port;this.server=null;this.token=crypto.randomBytes(24).toString('hex')}
 async start(){if(this.server)return this.info();this.server=http.createServer(async(req,res)=>{const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};if(req.method!=='GET'){send(405,{error:'read-only'});return}const auth=req.headers.authorization||'';if(auth!=='Bearer '+this.token){send(401,{error:'unauthorized'});return}try{if(req.url==='/health'){send(200,{ok:true,readOnly:true});return}if(req.url==='/api/status'){send(200,await this.status());return}if(req.url==='/api/events'){send(200,await this.replay(null,500));return}send(404,{error:'not found'})}catch(e){send(500,{error:String(e.message||e)})}});await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,'127.0.0.1',resolve)});return this.info()}
 info(){const a=this.server?.address();return{enabled:Boolean(this.server),host:'127.0.0.1',port:a?.port||null,readOnly:true,token:this.token}}
 async stop(){if(!this.server)return;await new Promise(r=>this.server.close(()=>r()));this.server=null}
}
module.exports={RemoteGateway};