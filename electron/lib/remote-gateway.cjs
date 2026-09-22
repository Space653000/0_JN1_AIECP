'use strict';

const http=require('node:http');
const https=require('node:https');
const crypto=require('node:crypto');
const {PairingManager}=require('./pairing.cjs');

const LOOPBACK_HOSTS=new Set(['127.0.0.1','::1','localhost']);

function isLoopbackHost(host){return LOOPBACK_HOSTS.has(String(host||'').toLowerCase())}
function validTls(tls){return Boolean(tls && ((tls.key&&tls.cert)||tls.pfx))}

class RemoteGateway{
 constructor({status,replay,port=0,host='127.0.0.1',allowRemote=false,tls=null}={}){
  this.status=status;
  this.replay=replay;
  this.port=port;
  this.host=String(host||'127.0.0.1');
  this.allowRemote=Boolean(allowRemote);
  this.tls=tls;
  this.server=null;
  this.token=crypto.randomBytes(24).toString('hex');
  this.pairing=new PairingManager();
  if(!isLoopbackHost(this.host)&&!this.allowRemote)throw new Error('Non-loopback Remote Gateway binding requires explicit allowRemote=true.');
  if(!isLoopbackHost(this.host)&&!validTls(this.tls))throw new Error('Non-loopback Remote Gateway requires TLS key/certificate or PFX.');
 }

 async start(){
  if(this.server)return this.info({includeSecret:true});
  const handler=async(req,res)=>{
   const send=(code,data)=>{
    res.writeHead(code,{
     'content-type':'application/json; charset=utf-8',
     'cache-control':'no-store',
     'x-content-type-options':'nosniff',
     'referrer-policy':'no-referrer'
    });
    res.end(JSON.stringify(data));
   };
   if(req.method!=='GET'){send(405,{error:'read-only'});return}
   const scheme=validTls(this.tls)?'https':'http';
   const url=new URL(req.url,`${scheme}://${this.host}`);
   const auth=req.headers.authorization||'';
   const bearer=auth.startsWith('Bearer ')?auth.slice(7):'';
   const local=bearer===this.token;
   const paired=this.pairing.authenticate(bearer);

   if(url.pathname==='/pair/start'){
    if(!local){send(401,{error:'bootstrap authorization required'});return}
    send(200,this.pairing.create());return;
   }
   if(url.pathname==='/pair/claim'){
    try{send(200,this.pairing.claim(url.searchParams.get('code'),url.searchParams.get('device')))}
    catch(e){send(403,{error:String(e.message||e)})}
    return;
   }
   if(!local&&!paired){send(401,{error:'unauthorized'});return}

   try{
    if(url.pathname==='/health'){send(200,{ok:true,readOnly:true,secure:validTls(this.tls)});return}
    const snapshot=await this.status();
    if(url.pathname==='/api/status'){send(200,snapshot);return}
    if(url.pathname==='/api/runs'){send(200,{runs:snapshot?.runs||[]});return}
    if(url.pathname==='/api/tasks'){send(200,{tasks:snapshot?.tasks||[]});return}
    if(url.pathname==='/api/approvals'){send(200,{approvals:snapshot?.approvals||[]});return}
    if(url.pathname==='/api/events'){send(200,await this.replay(null,500));return}
    if(url.pathname==='/api/devices'){
     if(!local){send(403,{error:'bootstrap authorization required'});return}
     send(200,{devices:this.pairing.list()});return;
    }
    send(404,{error:'not found'});
   }catch(e){send(500,{error:String(e.message||e)})}
  };

  this.server=validTls(this.tls)?https.createServer(this.tls,handler):http.createServer(handler);
  await new Promise((resolve,reject)=>{
   this.server.once('error',reject);
   this.server.listen(this.port,this.host,resolve);
  });
  return this.info({includeSecret:true});
 }

 info({includeSecret=false}={}){
  const a=this.server?.address();
  return{
   enabled:Boolean(this.server),
   host:this.host,
   port:a?.port||null,
   protocol:validTls(this.tls)?'https':'http',
   secure:validTls(this.tls),
   remoteEnabled:!isLoopbackHost(this.host),
   readOnly:true,
   tokenPresent:true,
   pairing:true,
   token:includeSecret?this.token:undefined
  };
 }

 async stop(){if(!this.server)return;await new Promise(r=>this.server.close(()=>r()));this.server=null}
 revokeDevice(token){return this.pairing.revoke(token)}
 listDevices(){return this.pairing.list()}
}

module.exports={RemoteGateway,isLoopbackHost,validTls};
