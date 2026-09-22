'use strict';

const http=require('node:http');
const https=require('node:https');
const crypto=require('node:crypto');
const {PairingManager}=require('./pairing.cjs');

const LOOPBACK_HOSTS=new Set(['127.0.0.1','::1','localhost']);

function isLoopbackHost(host){return LOOPBACK_HOSTS.has(String(host||'').toLowerCase())}
function validTls(tls){return Boolean(tls && ((tls.key&&tls.cert)||tls.pfx))}

class RemoteGateway{
 constructor({status,replay,approve,reject,port=0,host='127.0.0.1',allowRemote=false,tls=null}={}){
  this.status=status;
  this.replay=replay;
  this.approve=approve;
  this.reject=reject;
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
   if(!['GET','POST'].includes(req.method||'')){send(405,{error:'method not allowed'});return}
   const scheme=validTls(this.tls)?'https':'http';
   const url=new URL(req.url,`${scheme}://${this.host}`);
   const auth=req.headers.authorization||'';
   const bearer=auth.startsWith('Bearer ')?auth.slice(7):'';
   const local=bearer===this.token;
   const paired=this.pairing.authenticate(bearer);

   if(url.pathname==='/pair/start'){
    if(!local){send(401,{error:'bootstrap authorization required'});return}
    try{send(200,this.pairing.create(url.searchParams.get('scope')||'READ_ONLY'))}
    catch(e){send(400,{error:String(e.message||e)})}
    return;
   }
   if(url.pathname==='/pair/claim'){
    try{send(200,this.pairing.claim(url.searchParams.get('code'),url.searchParams.get('device')))}
    catch(e){send(403,{error:String(e.message||e)})}
    return;
   }
   if(!local&&!paired){send(401,{error:'unauthorized'});return}

   if(req.method==='POST'){
    const match=url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
    if(!match){send(405,{error:'approval-only remote actions'});return}
    if(!local&&paired?.scope!=='APPROVAL_ONLY'){send(403,{error:'approval scope required'});return}
    const requestId=String(req.headers['x-aecp-request-id']||'').trim();
    if(!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)){send(400,{error:'x-aecp-request-id is required for replay-safe approval actions'});return}
    const approvalId=decodeURIComponent(match[1]);
    const action=match[2];
    const callback=action==='approve'?this.approve:this.reject;
    if(typeof callback!=='function'){send(503,{error:'approval action unavailable'});return}
    try{
     const result=await callback(approvalId,{requestId,deviceId:paired?.deviceId||'bootstrap',scope:paired?.scope||'BOOTSTRAP'});
     send(200,{ok:true,approval:result});
    }catch(e){send(409,{error:String(e.message||e)})}
    return;
   }

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
   readOnly:false,
   remoteActions:'approval-only',
   tokenPresent:true,
   pairing:true,
   token:includeSecret?this.token:undefined
  };
 }

 async stop(){if(!this.server)return;await new Promise(r=>this.server.close(()=>r()));this.server=null}
 revokeDevice(token){return this.pairing.revoke(token)}
 revokeDeviceId(deviceId){return this.pairing.revokeDeviceId(deviceId)}
 listDevices(){return this.pairing.list()}
}

module.exports={RemoteGateway,isLoopbackHost,validTls};
