'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const {runHarness}=require('../electron/lib/harness.cjs');

async function makeRepo(prefix){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),prefix));
  const repo=path.join(root,'repo');
  const runRoot=path.join(root,'run');
  await fs.mkdir(repo,{recursive:true});
  await exec('git',['init'],{cwd:repo});
  await exec('git',['config','user.email','test@example.com'],{cwd:repo});
  await exec('git',['config','user.name','AECP Test'],{cwd:repo});
  await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({
    name:'aecp-harness-bounds',version:'1.0.0',private:true,
    scripts:{verify:'node -e "process.exit(0)"'}
  },null,2)+'\n');
  await fs.writeFile(path.join(repo,'README.md'),'baseline\n');
  await exec('git',['add','.'],{cwd:repo});
  await exec('git',['commit','-m','base'],{cwd:repo});
  return {root,repo,runRoot};
}

function fakeRouter(onBuilder){
  return {
    capabilities(){return {process:false,network:false,credential:false};},
    async execute(role,_prompt,opts){
      if(role==='planner'){
        return {code:0,stdout:JSON.stringify({tasks:[{
          task_id:'T1',
          title:'Bounded task',
          objective:'Make the bounded change.',
          acceptance:'Deterministic verification passes.',
          dependencies:[],
          risk:'GREEN',
          verifier:'npm run verify'
        }]}),stderr:'',timedOut:false,aborted:false};
      }
      if(role==='builder'){
        if(onBuilder) await onBuilder(opts.cwd);
        return {code:0,stdout:'builder done',stderr:'',timedOut:false,aborted:false};
      }
      if(role==='reviewer'){
        return {code:0,stdout:JSON.stringify({result:'PASS',findings:[],required_changes:[]}),stderr:'',timedOut:false,aborted:false};
      }
      throw new Error('unexpected role '+role);
    }
  };
}

test('Harness stops before another provider call when maxTurns is exhausted',async(t)=>{
  const fixture=await makeRepo('aecp-harness-turn-budget-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const run=await runHarness({
    goal:'Make one bounded change.',
    done:'Verification passes.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:2,
    maxTurns:1,
    providerRouter:fakeRouter(),
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'BUDGET_EXHAUSTED', run.error || JSON.stringify(run, null, 2));
  assert.equal(run.providerCalls,1);
  assert.equal(run.maxTurns,1);
  assert.match(run.error,/Provider call budget exhausted/);
});

test('Harness refuses DONE when changed-file budget is exceeded after verified review',async(t)=>{
  const fixture=await makeRepo('aecp-harness-file-budget-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const run=await runHarness({
    goal:'Create two bounded files.',
    done:'Verification passes.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:1,
    maxTurns:5,
    maxChangedFiles:1,
    providerRouter:fakeRouter(async cwd=>{
      await fs.writeFile(path.join(cwd,'one.txt'),'one\n');
      await fs.writeFile(path.join(cwd,'two.txt'),'two\n');
    }),
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.tasks[0].state,'DONE', run.error || JSON.stringify(run, null, 2));
  assert.equal(run.state,'BUDGET_EXHAUSTED');
  assert.match(run.error,/Changed-file budget exceeded/);
});

test('Harness refuses DONE when verified patch exceeds maxPatchBytes',async(t)=>{
  const fixture=await makeRepo('aecp-harness-patch-budget-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const run=await runHarness({
    goal:'Create one large bounded file.',
    done:'Verification passes.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:1,
    maxTurns:5,
    maxPatchBytes:1024,
    maxChangedFiles:10,
    providerRouter:fakeRouter(async cwd=>{
      await fs.writeFile(path.join(cwd,'large.txt'),'x'.repeat(4096));
    }),
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'BUDGET_EXHAUSTED', run.error || JSON.stringify(run, null, 2));
  assert.match(run.error,/Patch budget exceeded/);
});
