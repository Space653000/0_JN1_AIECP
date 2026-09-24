'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {auditMatrix}=require('../scripts/traceability-audit.cjs');

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aecp-traceability-'));
  for(const dir of ['Blueprint','tests','.ai/WORK_ORDERS'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'Blueprint','sample.md'),'# Sample\n## 1. Rule\nMust verify.\n');
  fs.writeFileSync(path.join(root,'tests','sample.test.cjs'),"test('verifies rule',()=>{});\n");
  fs.writeFileSync(path.join(root,'.ai','WORK_ORDERS','0007.md'),'**狀態：** OPEN\n');
  const item={id:'SAMPLE-1',source:{file:'Blueprint/sample.md',section:'## 1. Rule'},text:'Must verify.',
    status:'IMPLEMENTED',evidence:[{file:'tests/sample.test.cjs',kind:'test',name:'verifies rule'}],note:''};
  return {root,item,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

function inspect(mutator,options={}){
  const f=fixture();
  try{mutator(f);return auditMatrix({schema:'aecp.traceability/v2',items:[f.item]},{root:f.root,...options});}
  finally{f.cleanup();}
}

test('valid traceability item passes',()=>{
  assert.equal(inspect(()=>{}).passed,true);
});
test('missing evidence file fails',()=>{
  assert.equal(inspect(({item})=>{item.evidence[0].file='tests/missing.test.cjs';}).passed,false);
});
test('IMPLEMENTED without test evidence fails',()=>{
  assert.equal(inspect(({item})=>{item.evidence=[];}).passed,false);
});
test('test name absent from test declaration fails',()=>{
  assert.equal(inspect(({item})=>{item.evidence[0].name='nonexistent';}).passed,false);
});
test('GAP without work order fails',()=>{
  assert.equal(inspect(({item})=>{item.status='GAP';item.evidence=[];}).passed,false);
});
test('GAP pointing to CLOSED work order fails',()=>{
  const report=inspect(({item,root})=>{
    item.status='GAP';item.evidence=[];item.workOrder='0007';
    fs.writeFileSync(path.join(root,'.ai','WORK_ORDERS','0007.md'),'**狀態：** CLOSED\n');
  });
  assert.equal(report.passed,false);
  assert.ok(report.errors.some(e=>e.includes('CLOSED')));
});
test('unknown status fails',()=>{
  assert.equal(inspect(({item})=>{item.status='CERTIFIED';}).passed,false);
});
test('CONFIRMED_GAP requires located absence evidence and a repair note',()=>{
  assert.equal(inspect(({item})=>{item.status='CONFIRMED_GAP';item.workOrder='UNASSIGNED';item.evidence=[];item.note='';}).passed,false);
  assert.equal(inspect(({item})=>{item.status='CONFIRMED_GAP';item.workOrder='UNASSIGNED';
    item.evidence=[{file:'Blueprint/sample.md',symbol:'missingSymbol'}];item.note='Expected handler missing';}).passed,false);
  assert.equal(inspect(({item})=>{item.status='CONFIRMED_GAP';item.workOrder='UNASSIGNED';
    item.evidence=[{file:'Blueprint/sample.md',line:2,description:'No implementation of this rule here'}];
    item.note='Add the missing behavior to the implementation.';}).passed,true);
});
test('MANUAL needs a named acceptance protocol and missing section warns before strict mode',()=>{
  const report=inspect(({item})=>{item.status='MANUAL';item.evidence=[];
    item.protocol={file:'.ai/ACCEPTANCE.md',section:'### 6.1 Visual'};});
  assert.equal(report.passed,true);assert.ok(report.warnings.some(x=>x.includes('protocol section not found')));
  assert.equal(inspect(({item})=>{item.status='MANUAL';item.evidence=[];}).passed,false);
});
test('--strict rejects every remaining GAP',()=>{
  const report=inspect(({item})=>{item.status='GAP';item.evidence=[];item.workOrder='UNASSIGNED';},{strict:true});
  assert.equal(report.passed,false);assert.ok(report.errors.some(x=>x.includes('strict')));
});
test('more than three citations of one test warn and require explicit covered IDs',()=>{
  const f=fixture();
  try{
    const items=Array.from({length:4},(_,i)=>({...f.item,id:`SAMPLE-${i+1}`,evidence:[{...f.item.evidence[0]}]}));
    const first=auditMatrix({schema:'aecp.traceability/v2',items},{root:f.root});
    assert.equal(first.passed,false);assert.ok(first.warnings.some(x=>x.includes('shared test')));
    for(const item of items)item.evidence[0].covers=items.map(x=>x.id);
    assert.equal(auditMatrix({schema:'aecp.traceability/v2',items},{root:f.root}).passed,true);
  }finally{f.cleanup();}
});
