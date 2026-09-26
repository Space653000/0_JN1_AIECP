'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {STATES}=require('../electron/lib/harness.cjs');
const {NOTIFICATION_RULES,notifications}=require('../ui/dashboard-projection.js');

test('every emitted Control Plane and Harness event has an explicit notification decision',()=>{
  const lib=path.join(__dirname,'..','electron','lib');
  const sources=[...fs.readdirSync(lib).filter(n=>n.endsWith('.cjs')).map(n=>path.join(lib,n)),path.join(__dirname,'..','electron','main.cjs')];
  const emitted=new Set();
  for(const file of sources){
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/\bthis\.event\(\s*(['"`])([^'"`]+)\1/g))emitted.add(match[2]);
    const calls=[...source.matchAll(/\bthis\.event\(\s*/g)];
    const literals=[...source.matchAll(/\bthis\.event\(\s*(['"`])/g)];
    assert.equal(calls.length,literals.length,`${path.basename(file)} has an unclassified dynamic this.event call`);
    if(path.basename(file)==='harness.cjs'){
      for(const match of source.matchAll(/\bemit\(\s*'([^']+)'/g))emitted.add(match[1]);
      assert.match(source,/emit\(`state\.\$\{state\.toLowerCase\(\)\}`/);
      for(const state of STATES)emitted.add(`state.${state.toLowerCase()}`);
    }
  }
  // The ledger receives this event directly, without ControlPlane.event().
  emitted.add('external.received');
  const rules=new Map(NOTIFICATION_RULES.map(x=>[x.type,x.category]));
  assert.deepEqual([...emitted].filter(x=>!rules.has(x)).sort(),[],`unclassified emitted events`);
  assert.deepEqual([...rules.keys()].filter(x=>!emitted.has(x)).sort(),[],`orphan notification rules`);
});

test('real CI, task, approval and policy event names project to their required categories',()=>{
  const expected={
    'ci.failed_rework':'ERROR','ci.failed_max_iterations':'ERROR','task.failed':'ERROR',
    'delivery.blocked':'ERROR','mission.cancelled':'ERROR','approval.requested':'ACTION REQUIRED',
    'ci.passed':'SUCCESS','task.accepted':'SUCCESS','task.finished':'SUCCESS',
    'delivery.merged':'SUCCESS','task.recovery_rework':'WARNING','ci.waiting':'INFO',
    'task.waiting_for_lock':'WARNING','policy.violation':'CRITICAL'
  };
  for(const [type,category] of Object.entries(expected)){
    const result=notifications([{id:type,type,at:'2026-09-24T00:00:00Z'}]);
    assert.equal(result[0]?.category,category,type);
  }
});
