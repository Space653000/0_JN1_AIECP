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

function inspect(mutator){
  const f=fixture();
  try{mutator(f);return auditMatrix({schema:'aecp.traceability/v1',items:[f.item]},{root:f.root});}
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
