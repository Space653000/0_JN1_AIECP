'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');

function numericOnly(value, depth=0){
  if(depth>4||value==null)return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='object'||Array.isArray(value))return null;
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(!/token|cost|price|credit|cached|reasoning|input|output|prompt|completion|total/i.test(key))continue;
    const v=numericOnly(item,depth+1);
    if(v!==null&&(typeof v!=='object'||Object.keys(v).length))out[key]=v;
  }
  return Object.keys(out).length?out:null;
}

function normalizeMetric(metric={}){
  return {
    schema:'aecp.provider-usage/v1',
    provider:String(metric.provider||'').slice(0,120),
    role:String(metric.role||'').slice(0,80),
    model:metric.model==null?null:String(metric.model).slice(0,240),
    success:Boolean(metric.success),
    code:typeof metric.code==='number'?metric.code:String(metric.code??'').slice(0,80),
    timedOut:Boolean(metric.timedOut),
    aborted:Boolean(metric.aborted),
    latencyMs:Math.max(0,Math.min(24*60*60*1000,Number(metric.latencyMs||0))),
    usage:numericOnly(metric.usage),
    recordedAt:/^\d{4}-\d{2}-\d{2}T/.test(String(metric.recordedAt||''))?String(metric.recordedAt):new Date().toISOString()
  };
}

function addNumeric(target, value, prefix=''){
  if(value==null)return;
  if(typeof value==='number'){
    if(prefix)target[prefix]=(target[prefix]||0)+value;
    return;
  }
  if(typeof value!=='object'||Array.isArray(value))return;
  for(const [key,item] of Object.entries(value)){
    addNumeric(target,item,prefix?prefix+'.'+key:key);
  }
}

class ProviderUsageStore{
  constructor(file,{maxRecords=2000}={}){
    this.file=file;
    this.maxRecords=Math.max(100,Math.min(10000,Number(maxRecords||2000)));
    this.queue=Promise.resolve();
    this.sequence=0;
  }

  async load(){
    try{
      const parsed=JSON.parse(await fs.readFile(this.file,'utf8'));
      return {
        schema:'aecp.provider-usage-store/v1',
        records:Array.isArray(parsed?.records)?parsed.records.map(normalizeMetric):[]
      };
    }catch(error){
      if(error?.code==='ENOENT')return {schema:'aecp.provider-usage-store/v1',records:[]};
      throw error;
    }
  }

  async write(state){
    await fs.mkdir(path.dirname(this.file),{recursive:true});
    const tmp=`${this.file}.tmp-${process.pid}-${++this.sequence}`;
    await fs.writeFile(tmp,JSON.stringify({schema:'aecp.provider-usage-store/v1',updatedAt:new Date().toISOString(),records:state.records},null,2)+'\n','utf8');
    await fs.rename(tmp,this.file);
  }

  async append(metric){
    const safe=normalizeMetric(metric);
    if(!safe.provider)throw new Error('Provider usage metric requires provider id.');
    const operation=this.queue.then(async()=>{
      const state=await this.load();
      state.records.push(safe);
      if(state.records.length>this.maxRecords)state.records.splice(0,state.records.length-this.maxRecords);
      await this.write(state);
      return safe;
    },async()=>{
      const state=await this.load();
      state.records.push(safe);
      if(state.records.length>this.maxRecords)state.records.splice(0,state.records.length-this.maxRecords);
      await this.write(state);
      return safe;
    });
    this.queue=operation.catch(()=>{});
    return operation;
  }

  async summaries(){
    await this.queue.catch(()=>{});
    const state=await this.load();
    const out={};
    for(const record of state.records){
      const item=out[record.provider]||(out[record.provider]={
        provider:record.provider,
        requests:0,
        successes:0,
        failures:0,
        totalLatencyMs:0,
        averageLatencyMs:0,
        lastLatencyMs:0,
        lastModel:null,
        lastRole:null,
        lastRecordedAt:null,
        numericTotals:{}
      });
      item.requests++;
      if(record.success)item.successes++;else item.failures++;
      item.totalLatencyMs+=record.latencyMs;
      item.lastLatencyMs=record.latencyMs;
      item.lastModel=record.model;
      item.lastRole=record.role;
      item.lastRecordedAt=record.recordedAt;
      addNumeric(item.numericTotals,record.usage);
    }
    for(const item of Object.values(out)){
      item.averageLatencyMs=item.requests?Math.round(item.totalLatencyMs/item.requests):0;
    }
    return out;
  }
}

module.exports={ProviderUsageStore,normalizeMetric,numericOnly};
