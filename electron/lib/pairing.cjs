'use strict';

const crypto=require('node:crypto');

class PairingManager{
 constructor({ttlMs=5*60*1000,tokenTtlMs=24*60*60*1000}={}){
  this.ttlMs=ttlMs;this.tokenTtlMs=tokenTtlMs;this.pending=new Map();this.devices=new Map();
 }
 create(){
  const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  const id=crypto.randomBytes(12).toString('hex');
  this.pending.set(code,{id,expiresAt:Date.now()+this.ttlMs});
  return {code,pairingId:id,expiresAt:new Date(Date.now()+this.ttlMs).toISOString()};
 }
 claim(code,deviceId){
  this.gc();
  const pending=this.pending.get(String(code));
  if(!pending||pending.expiresAt<Date.now())throw new Error('Pairing code is invalid or expired.');
  this.pending.delete(String(code));
  const token=crypto.randomBytes(32).toString('hex');
  const record={deviceId:String(deviceId||pending.id),token,scope:'READ_ONLY',createdAt:new Date().toISOString(),expiresAt:Date.now()+this.tokenTtlMs,revoked:false};
  this.devices.set(record.token,record);
  return {...record,expiresAt:new Date(record.expiresAt).toISOString()};
 }
 authenticate(token){
  this.gc();
  const d=this.devices.get(String(token));
  return d&&!d.revoked&&d.expiresAt>Date.now()?{...d}:null;
 }
 revoke(token){
  const d=this.devices.get(String(token));
  if(!d)return false;
  d.revoked=true;return true;
 }
 revokeDeviceId(deviceId){
  const id=String(deviceId||'');
  let changed=false;
  for(const d of this.devices.values()){
   if(d.deviceId===id&&!d.revoked){d.revoked=true;changed=true;}
  }
  return changed;
 }
 list(){
  this.gc();
  return [...this.devices.values()].map(d=>({deviceId:d.deviceId,scope:d.scope,createdAt:d.createdAt,expiresAt:new Date(d.expiresAt).toISOString(),revoked:d.revoked}));
 }
 gc(){
  const now=Date.now();
  for(const [code,p] of this.pending)if(p.expiresAt<=now)this.pending.delete(code);
  for(const [token,d] of this.devices)if(d.expiresAt<=now||d.revoked)this.devices.delete(token);
 }
}
module.exports={PairingManager};
