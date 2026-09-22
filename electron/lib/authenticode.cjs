'use strict';

const {spawn}=require('node:child_process');

function normalizeThumbprint(value){
 return String(value||'').replace(/[^a-f0-9]/gi,'').toUpperCase();
}

function psQuote(value){
 return "'" + String(value).replace(/'/g,"''") + "'";
}

function runPowerShell(script,{timeoutMs=30000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{
   windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='',settled=false,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},timeoutMs);
  child.stdout.on('data',b=>stdout+=b);
  child.stderr.on('data',b=>stderr+=b);
  child.on('error',error=>{
   if(settled)return;settled=true;clearTimeout(timer);reject(error);
  });
  child.on('close',code=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(code===0)return resolve(stdout.trim());
   const error=new Error((stderr||stdout||'Authenticode inspection failed').slice(-4000));
   error.code=timedOut?'AUTHENTICODE_TIMEOUT':'AUTHENTICODE_INSPECTION_FAILED';
   reject(error);
  });
 });
}

async function inspectAuthenticode(file,{runner=runPowerShell}={}){
 const script=[
  `$sig=Get-AuthenticodeSignature -LiteralPath ${psQuote(file)}`,
  '$obj=[ordered]@{',
  "Status=[string]$sig.Status;",
  "StatusMessage=[string]$sig.StatusMessage;",
  "SignerThumbprint=if($sig.SignerCertificate){[string]$sig.SignerCertificate.Thumbprint}else{''};",
  "SignerSubject=if($sig.SignerCertificate){[string]$sig.SignerCertificate.Subject}else{''};",
  "TimeStamperThumbprint=if($sig.TimeStamperCertificate){[string]$sig.TimeStamperCertificate.Thumbprint}else{''}",
  '}',
  '$obj|ConvertTo-Json -Compress'
 ].join(';');
 const raw=await runner(script);
 const parsed=JSON.parse(raw||'{}');
 return {
  status:String(parsed.Status||'Unknown'),
  statusMessage:String(parsed.StatusMessage||''),
  signerThumbprint:normalizeThumbprint(parsed.SignerThumbprint),
  signerSubject:String(parsed.SignerSubject||''),
  timeStamperThumbprint:normalizeThumbprint(parsed.TimeStamperThumbprint)
 };
}

async function verifyAuthenticode(file,{requiredThumbprint='',runner=runPowerShell}={}){
 const expected=normalizeThumbprint(requiredThumbprint);
 if(!expected){
  return {required:false,status:'NOT_REQUIRED',signerThumbprint:null,signerSubject:null,timeStamperThumbprint:null};
 }
 const info=await inspectAuthenticode(file,{runner});
 if(info.status.toLowerCase()!=='valid'){
  const error=new Error(`Installer Authenticode signature is not valid: ${info.status}${info.statusMessage?': '+info.statusMessage:''}`);
  error.code='AUTHENTICODE_INVALID';
  error.evidence=info;
  throw error;
 }
 if(info.signerThumbprint!==expected){
  const error=new Error(`Installer signer thumbprint mismatch. Expected ${expected}, got ${info.signerThumbprint||'(none)'}.`);
  error.code='AUTHENTICODE_SIGNER_MISMATCH';
  error.evidence=info;
  throw error;
 }
 return {required:true,...info};
}

module.exports={normalizeThumbprint,inspectAuthenticode,verifyAuthenticode};
