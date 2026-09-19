'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const {PairingManager}=require('./pairing.cjs');
class RemoteGateway{
 constructor({status,replay,port=0}={}){this.status=status;this.replay=replay;this.port=port;this.server=null;this.token=crypto.randomBytes(24).toString('hex');this.pairing=new PairingManager();}
 async start(){if(this.server)return this.info({includeSecret:true});this.server=http.createServer(async(req,res)=>{const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};if(req.method!=='GET'){send(405,{error:'read-only'});return}const url=new URL(req.url,'http://127.0.0.1');const auth=req.headers.authorization||'';const bearer=auth.startsWith('Bearer ')?auth.slice(7):'';const local=bearer===this.token;const paired=this.pairing.authenticate(bearer);if(url.pathname==='/pair/start'){if(!local){send(401,{error:'bootstrap authorization required'});return}send(200,this.pairing.create());return}if(url.pathname==='/pair/claim'){try{send(200,this.pairing.claim(url.searchParams.get('code'),url.searchParams.get('device')))}catch(e){send(403,{error:String(e.message||e)})}return}if(!local&&!paired){send(401,{error:'unauthorized'});return}try{if(url.pathname==='/health'){send(200,{ok:true,readOnly:true});return}if(url.pathname==='/api/status'){send(200,await this.status());return}if(url.pathname==='/api/events'){send(200,await this.replay(null,500));return}if(url.pathname==='/api/devices'){if(!local){send(403,{error:'bootstrap authorization required'});return}send(200,{devices:this.pairing.list()});return}send(404,{error:'not found'})}catch(e){send(500,{error:String(e.message||e)})}});await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,'127.0.0.1',resolve)});return this.info({includeSecret:true})}
 info({includeSecret=false}={}){const a=this.server?.address();return{enabled:Boolean(this.server),host:'127.0.0.1',port:a?.port||null,readOnly:true,tokenPresent:true,pairing:true,token:includeSecret?this.token:undefined}}
 async stop(){if(!this.server)return;await new Promise(r=>this.server.close(()=>r()));this.server=null}
 revokeDevice(token){return this.pairing.revoke(token)}
 listDevices(){return this.pairing.list()}
}
module.exports={RemoteGateway};