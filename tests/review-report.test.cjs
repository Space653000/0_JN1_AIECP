'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {validateReviewReport,saveReviewReport,DIMENSIONS}=require('../electron/lib/review-report.cjs');
const context={taskId:'T1',runId:'RUN1',reviewer:{provider:'claude',model:'UNKNOWN'},verifierPassed:true};
function valid(){return {schema:'aecp.review/v1',task_id:'T1',run_id:'RUN1',reviewer:{provider:'claude',model:'UNKNOWN'},result:'PASS',...Object.fromEntries(DIMENSIONS.map(d=>[d,'PASS'])),findings:[],required_changes:[]};}
function check(value,overrides={}){return validateReviewReport(typeof value==='string'?value:JSON.stringify(value),{...context,...overrides});}

test('Review Report accepts a complete correlated six-dimension PASS only with verifier PASS',()=>{
  const result=check(valid());assert.equal(result.valid,true);assert.equal(result.report.result,'PASS');
});
test('legacy missing-dimension review and non-JSON are HUMAN_REQUIRED',()=>{
  assert.equal(check({result:'PASS',findings:[],required_changes:[]}).report.result,'HUMAN_REQUIRED');
  assert.equal(check('not JSON').report.result,'HUMAN_REQUIRED');
  assert.equal(check({...valid(),result:'UNKNOWN'}).report.result,'HUMAN_REQUIRED');
});
test('FAIL dimension contradicting PASS becomes REWORK',()=>{
  const report=check({...valid(),security:'FAIL'}).report;
  assert.equal(report.result,'REWORK');assert.match(report.findings.join(' '),/Contradiction/);
});
test('BLOCKED creates HUMAN_REQUIRED with its reason retained',()=>{
  const report=check({...valid(),result:'BLOCKED',findings:['Need architecture decision']}).report;
  assert.equal(report.result,'HUMAN_REQUIRED');assert.equal(report.originalResult,'BLOCKED');
  assert.match(report.findings.join(' '),/Need architecture decision/);
});
test('failed deterministic verifier prevents reviewer PASS',()=>{
  assert.equal(check(valid(),{verifierPassed:false}).report.result,'REWORK');
});
test('review report evidence is redacted and content-hashed',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-review-report-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const result=await saveReviewReport(root,{...valid(),findings:['SECRET=abcdef123456']},1);
  assert.equal(result.sha256.length,64);
  assert.doesNotMatch(await fs.readFile(result.file,'utf8'),/abcdef123456/);
});
