'use strict';

const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const STATUSES=new Set(['IMPLEMENTED','PARTIAL','GAP','ENVIRONMENT','OWNER','DELIBERATE_NON_GOAL']);
const SHA_SAFE_PATH=/^[A-Za-z0-9_.\/-]+$/;

function withinRoot(root,file){
  if(typeof file!=='string'||!SHA_SAFE_PATH.test(file)||path.isAbsolute(file)||file.split('/').includes('..'))return null;
  const absolute=path.resolve(root,file);
  return absolute.startsWith(root+path.sep)?absolute:null;
}

function testNamePresent(body,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`\\b(?:test|it)\\s*\\(\\s*['\"\\x60]${escaped}['\"\\x60]`).test(body);
}

function requiredIds(root){
  const ids=[];
  const req=fs.readFileSync(path.join(root,'Blueprint','REQUIREMENTS.md'),'utf8');
  for(const match of req.matchAll(/^\s*-\s*\*\*(R[1-8]\.\d+)\*\*/gm))ids.push(match[1]);
  for(const [name,heading,prefix] of [
    ['18_BOUNDED_AUTONOMOUS_EXECUTION.md','## 13. Acceptance criteria','B18-13'],
    ['20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md','## 27. Acceptance criteria','B20-27'],
    ['21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md','## 10. Handoff rules','B21-10'],
    ['22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md','## 16. Acceptance','B22-16']
  ]){
    const body=fs.readFileSync(path.join(root,'Blueprint',name),'utf8').split(heading)[1]?.split(/^## /m)[0]||'';
    for(const match of body.matchAll(/^(\d+)\.\s/gm))ids.push(`${prefix}-${String(+match[1]).padStart(2,'0')}`);
  }
  return ids;
}

function auditMatrix(matrix,{root=ROOT,enforceCoverage=false}={}){
  const errors=[];const warnings=[];const counts=Object.fromEntries([...STATUSES].map(s=>[s,0]));
  const unresolved=[];const seen=new Set();
  if(matrix?.schema!=='aecp.traceability/v1'||!Array.isArray(matrix?.items))
    return {passed:false,errors:['invalid matrix schema/items'],warnings,counts,unresolved};
  for(const item of matrix.items){
    const id=item?.id||'<missing-id>';
    if(seen.has(id))errors.push(`${id}: duplicate id`);
    seen.add(id);
    if(typeof item?.id!=='string'||!item.id.trim())errors.push(`${id}: missing id`);
    if(!STATUSES.has(item?.status))errors.push(`${id}: unknown status`);
    else counts[item.status]++;
    if(typeof item?.text!=='string'||!item.text.trim())errors.push(`${id}: missing text`);
    const sourceFile=withinRoot(root,item?.source?.file);
    if(!sourceFile||!fs.existsSync(sourceFile)||typeof item.source.section!=='string'||!item.source.section.trim())
      errors.push(`${id}: missing source file/section`);
    else if(!fs.readFileSync(sourceFile,'utf8').includes(item.source.section))errors.push(`${id}: source section not found`);
    const evidence=Array.isArray(item?.evidence)?item.evidence:[];
    if(item?.status==='IMPLEMENTED'&&!evidence.some(e=>e.kind==='test'))errors.push(`${id}: IMPLEMENTED requires test evidence`);
    for(const entry of evidence){
      if(!['test','code'].includes(entry?.kind)||typeof entry?.name!=='string'||!entry.name.trim()){
        errors.push(`${id}: invalid evidence kind/name`);continue;
      }
      const file=withinRoot(root,entry.file);
      if(!file||!fs.existsSync(file)){errors.push(`${id}: missing evidence file ${entry.file||''}`);continue;}
      const body=fs.readFileSync(file,'utf8');
      if(entry.kind==='test'&&!testNamePresent(body,entry.name))errors.push(`${id}: test name not found: ${entry.name}`);
      if(entry.kind==='code'&&!new RegExp(`\\b${entry.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(body))
        errors.push(`${id}: code identifier not found: ${entry.name}`);
    }
    if(item?.status==='GAP'||item?.status==='PARTIAL'){
      unresolved.push({id,status:item.status,workOrder:item.workOrder||'<missing>'});
      if(typeof item.workOrder!=='string'||!item.workOrder)errors.push(`${id}: workOrder required`);
      else if(item.workOrder==='UNASSIGNED')warnings.push(`${id}: UNASSIGNED`);
      else{
        const orderFile=withinRoot(root,`.ai/WORK_ORDERS/${item.workOrder}.md`);
        if(!orderFile||!fs.existsSync(orderFile))errors.push(`${id}: work order not found`);
        else if(/\*\*狀態：\*\*\s*CLOSED\b/.test(fs.readFileSync(orderFile,'utf8')))
          errors.push(`${id}: unresolved item points to CLOSED work order`);
      }
    }
    if(item?.status==='ENVIRONMENT'||item?.status==='OWNER'){
      const ref=item.acceptanceRef;
      const allowed=ref?.file==='.ai/ACCEPTANCE.md'||/^Reports\/[^/]*RUNBOOK[^/]*\.md$/.test(ref?.file||'');
      const file=withinRoot(root,ref?.file);
      if(!allowed||!file||!fs.existsSync(file)||typeof ref.section!=='string'||
        !fs.readFileSync(file,'utf8').includes(ref.section))errors.push(`${id}: acceptance/runbook reference missing`);
    }
  }
  if(enforceCoverage){
    for(const id of requiredIds(root))if(!seen.has(id))errors.push(`${id}: required Blueprint clause missing from matrix`);
  }
  return {passed:errors.length===0,errors,warnings,counts,unresolved};
}

function main(){
  let report;
  try{report=auditMatrix(JSON.parse(fs.readFileSync(path.join(ROOT,'.ai','TRACEABILITY.json'),'utf8')),{enforceCoverage:true});}
  catch(error){process.stderr.write(`traceability audit cannot read matrix: ${error.code||'INVALID_JSON'}\n`);return 1;}
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report.passed?0:1;
}

if(require.main===module)process.exitCode=main();
module.exports={auditMatrix,testNamePresent,requiredIds};
