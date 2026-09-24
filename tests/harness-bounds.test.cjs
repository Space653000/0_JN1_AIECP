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

function fakeRouter(onBuilder,onRole){
  return {
    capabilities(role){return {process:false,network:false,credential:false,discoversAgentsMd:role==='builder'};},
    async execute(role,prompt,opts){
      if(onRole)onRole(role,prompt);
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
        const runId=prompt.match(/"run_id":"([^"]+)"/)?.[1];
        const provider=prompt.match(/"provider":"([^"]+)"/)?.[1];
        return {code:0,stdout:JSON.stringify({schema:'aecp.review/v1',task_id:'T1',run_id:runId,reviewer:{provider,model:'UNKNOWN'},result:'PASS',blueprint:'PASS',plan:'PASS',implementation:'PASS',tests:'PASS',security:'PASS',architecture:'PASS',findings:[],required_changes:[]}),stderr:'',timedOut:false,aborted:false};
      }
      throw new Error('unexpected role '+role);
    }
  };
}

test('Reviewer process failure escalates to HUMAN_REQUIRED without retrying',async t=>{
  for(const failure of [{code:9,timedOut:false},{code:1,timedOut:true}]){
    const fixture=await makeRepo('aecp-reviewer-failure-');
    t.after(()=>fs.rm(fixture.root,{recursive:true,force:true}));
    const base=fakeRouter(async cwd=>fs.writeFile(path.join(cwd,'change.txt'),'verified change\n'));
    let reviewerCalls=0;
    const router={...base,execute:async(role,prompt,opts)=>{
      if(role==='reviewer'){
        reviewerCalls++;
        return {...failure,stdout:'',stderr:'reviewer unavailable',aborted:false};
      }
      return base.execute(role,prompt,opts);
    }};
    const result=await runHarness({goal:'Make one verified change.',done:'Verification succeeds.',
      sourceRoot:fixture.repo,runRoot:fixture.runRoot,maxTasks:1,maxIterations:3,maxTurns:8,
      providerRouter:router,plannerProvider:'planner',builderProvider:'builder',reviewerProvider:'reviewer'});
    assert.equal(result.state,'HUMAN_REQUIRED');
    assert.equal(result.tasks[0].review.result,'HUMAN_REQUIRED');
    assert.equal(reviewerCalls,1);
  }
});

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
  assert.equal(run.state,'BUDGET_EXHAUSTED', run.error || JSON.stringify(run, null, 2));
  assert.match(run.error,/Changed-file budget exceeded/);
  assert.ok(run.events.some(event=>event.type==='task.review_passed'));
  assert.equal(run.events.some(event=>event.type==='task.accepted'),false);
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
  assert.ok(run.events.some(event=>event.type==='task.review_passed'));
  assert.equal(run.events.some(event=>event.type==='task.accepted'),false);
});


test('Harness emits task.accepted only after final patch budgets succeed',async(t)=>{
  const fixture=await makeRepo('aecp-harness-accept-after-patch-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const run=await runHarness({
    goal:'Create one small verified file.',
    done:'Verification passes.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:1,
    maxTurns:5,
    maxChangedFiles:5,
    maxPatchBytes:64*1024,
    providerRouter:fakeRouter(async cwd=>{
      await fs.writeFile(path.join(cwd,'small.txt'),'small\n');
    }),
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'DONE', run.error || JSON.stringify(run,null,2));
  const reviewIndex=run.events.findIndex(event=>event.type==='task.review_passed');
  const acceptedIndex=run.events.findIndex(event=>event.type==='task.accepted');
  assert.ok(reviewIndex>=0);
  assert.ok(acceptedIndex>reviewIndex);
  assert.match(run.events[acceptedIndex].data.patchSha256,/^[a-f0-9]{64}$/);
});


test('Harness persists the complete Goal Loop contract and checkpoint evidence',async(t)=>{
  const fixture=await makeRepo('aecp-harness-loop-contract-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const run=await runHarness({
    goal:'Create a small verified file.',
    done:'Verification passes.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    workspaceId:'ws-test',
    checkpointEvery:1,
    maxTasks:1,
    maxIterations:2,
    maxTurns:6,
    providerRouter:fakeRouter(async cwd=>fs.writeFile(path.join(cwd,'loop.txt'),'ok\n')),
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer',
    providerNetworkApproved:false,
    providerCredentialApproved:false
  });
  assert.equal(run.state,'DONE',run.error||JSON.stringify(run,null,2));
  assert.equal(run.loopContract.schema,'aecp.goal-loop/v1');
  assert.equal(run.executionContract.schema,'aecp.execution-contract/v1');
  assert.equal(run.executionContract.workspace.id,'ws-test');
  assert.equal(run.executionContract.transport,'full-harness');
  assert.deepEqual(run.executionContract.taskIds,run.tasks.map(task=>task.id));
  assert.match(run.executionContract.evidenceRef,/verified\.patch$/);
  assert.equal(run.loopContract.goal,'Create a small verified file.');
  assert.equal(run.loopContract.maxIterations,2);
  assert.equal(run.loopContract.workspaceId,'ws-test');
  assert.equal(run.loopContract.definitionOfDone,'Verification passes.');
  assert.equal(run.loopContract.checkpointEvery,1);
  assert.equal(run.loopContract.providerPolicy.builder.provider,'builder');
  assert.equal(run.loopContract.permissionPolicy.highRisk,'HUMAN_REQUIRED');
  assert.equal(run.loopContract.verificationPolicy.deterministicVerifierAuthoritative,true);
  assert.ok(run.loopContract.stopConditions.includes('NO_PROGRESS'));
  assert.ok(run.loopContract.stopConditions.includes('WALL_CLOCK_BUDGET'));
  assert.ok(run.checkpoints.length>=1);
  assert.equal(run.checkpoints[0].schema,'aecp.goal-loop-checkpoint/v1');
  assert.ok(run.events.some(event=>event.type==='loop.checkpoint'));
});

test('Harness stops repeated no-progress attempts before infinite rework',async(t)=>{
  const fixture=await makeRepo('aecp-harness-no-progress-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  await fs.writeFile(path.join(fixture.repo,'package.json'),JSON.stringify({
    name:'aecp-harness-no-progress',version:'1.0.0',private:true,
    scripts:{verify:'node -e "process.exit(1)"'}
  },null,2)+'\n');
  await exec('git',['add','package.json'],{cwd:fixture.repo});
  await exec('git',['commit','-m','make verifier fail deterministically'],{cwd:fixture.repo});
  const router={
    capabilities(){return {process:false,network:false,credential:false};},
    async execute(role,_prompt,opts){
      if(role==='planner') return {code:0,stdout:JSON.stringify({tasks:[{
        task_id:'T1',title:'No progress task',objective:'Try boundedly.',acceptance:'Verifier passes.',
        dependencies:[],risk:'GREEN',verifier:'npm run verify'
      }]}),stderr:'',timedOut:false,aborted:false};
      if(role==='builder'){
        await fs.writeFile(path.join(opts.cwd,'same.txt'),'same\n');
        return {code:0,stdout:'same',stderr:'',timedOut:false,aborted:false};
      }
      throw new Error('reviewer should not run while deterministic verification fails');
    }
  };
  const run=await runHarness({
    goal:'Stop when repeated attempts make no measurable progress.',
    done:'Never falsely report completion.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:5,
    maxTurns:10,
    maxNoProgressAttempts:2,
    providerRouter:router,
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'BLOCKED',run.error||JSON.stringify(run,null,2));
  assert.match(run.error,/No measurable progress/);
  assert.equal(run.noProgressAttempts,2);
  assert.equal(run.tasks[0].state,'BLOCKED');
  assert.equal(run.tasks[0].stopReason,'NO_PROGRESS_STOP');
  assert.equal(run.events.some(event=>event.type==='task.accepted'),false);
});

test('Harness enforces failed-attempt budget outside the model',async(t)=>{
  const fixture=await makeRepo('aecp-harness-failed-budget-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const router={
    capabilities(){return {process:false,network:false,credential:false};},
    async execute(role){
      if(role==='planner') return {code:0,stdout:JSON.stringify({tasks:[{
        task_id:'T1',title:'Failing worker',objective:'Stay bounded.',acceptance:'Verifier passes.',
        dependencies:[],risk:'GREEN',verifier:'npm run verify'
      }]}),stderr:'',timedOut:false,aborted:false};
      if(role==='builder') return {code:1,stdout:'',stderr:'worker failed',timedOut:false,aborted:false};
      throw new Error('unexpected reviewer call');
    }
  };
  const run=await runHarness({
    goal:'Bound failed attempts.',
    done:'Stop after the configured failed-attempt budget.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:4,
    maxTurns:10,
    maxFailedAttempts:1,
    providerRouter:router,
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'BUDGET_EXHAUSTED',run.error||JSON.stringify(run,null,2));
  assert.equal(run.failedAttempts,1);
  assert.match(run.error,/Failed-attempt budget exhausted/);
});

test('Harness enforces optional wall-clock budget before the next provider call',async(t)=>{
  const fixture=await makeRepo('aecp-harness-wall-clock-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const router={
    capabilities(){return {process:false,network:false,credential:false};},
    async execute(role){
      if(role==='planner'){
        await new Promise(resolve=>setTimeout(resolve,1100));
        return {code:0,stdout:JSON.stringify({tasks:[{
          task_id:'T1',title:'Wall clock task',objective:'Respect time.',acceptance:'Verifier passes.',
          dependencies:[],risk:'GREEN',verifier:'npm run verify'
        }]}),stderr:'',timedOut:false,aborted:false};
      }
      throw new Error('builder must not run after wall-clock expiry');
    }
  };
  const run=await runHarness({
    goal:'Respect a wall-clock budget.',
    done:'Stop before Builder after time expires.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:2,
    maxTurns:5,
    maxWallClockMs:1000,
    providerRouter:router,
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'BUDGET_EXHAUSTED',run.error||JSON.stringify(run,null,2));
  assert.match(run.error,/Wall-clock budget exhausted/);
  assert.equal(run.providerCalls,1);
});


test('Harness enforces provider-reported cost budget without estimating missing provider prices',async(t)=>{
  const fixture=await makeRepo('aecp-harness-provider-cost-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const router={
    capabilities(){return {process:false,network:true,credential:false};},
    async execute(role){
      assert.equal(role,'planner');
      return {
        code:0,
        stdout:JSON.stringify({tasks:[{
          task_id:'T1',title:'Must not dispatch',objective:'Stop on budget.',acceptance:'No builder call.',
          dependencies:[],risk:'GREEN',verifier:'npm run verify'
        }]}),
        stderr:'',
        timedOut:false,
        aborted:false,
        usage:{cost_usd:0.75}
      };
    }
  };
  const run=await runHarness({
    goal:'Respect provider-reported cost.',
    done:'Stop when provider-reported cost exceeds the configured budget.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:2,
    maxTurns:5,
    maxProviderReportedCost:0.5,
    providerRouter:router,
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'BUDGET_EXHAUSTED',run.error||JSON.stringify(run,null,2));
  assert.equal(run.providerCalls,1);
  assert.equal(run.providerReportedCost,0.75);
  assert.match(run.error,/Provider-reported cost budget exhausted/);
});

test('Harness enforces local-compute budget using measured local provider time',async(t)=>{
  const fixture=await makeRepo('aecp-harness-local-compute-');
  t.after(async()=>fs.rm(fixture.root,{recursive:true,force:true}));
  const router={
    capabilities(){return {process:false,network:false,credential:false};},
    async execute(role){
      assert.equal(role,'planner');
      await new Promise(resolve=>setTimeout(resolve,1100));
      return {
        code:0,
        stdout:JSON.stringify({tasks:[{
          task_id:'T1',title:'Must not dispatch',objective:'Stop on local compute.',acceptance:'No builder call.',
          dependencies:[],risk:'GREEN',verifier:'npm run verify'
        }]}),
        stderr:'',
        timedOut:false,
        aborted:false
      };
    }
  };
  const run=await runHarness({
    goal:'Respect local compute budget.',
    done:'Stop when measured local compute exceeds the configured budget.',
    sourceRoot:fixture.repo,
    runRoot:fixture.runRoot,
    maxTasks:1,
    maxIterations:2,
    maxTurns:5,
    maxLocalComputeMs:1000,
    providerRouter:router,
    plannerProvider:'planner',
    builderProvider:'builder',
    reviewerProvider:'reviewer'
  });
  assert.equal(run.state,'BUDGET_EXHAUSTED',run.error||JSON.stringify(run,null,2));
  assert.equal(run.providerCalls,1);
  assert.ok(run.localComputeMs>=1000);
  assert.match(run.error,/Local compute budget exhausted/);
});

test('Harness gives user context priority, routes knowledge by provider capability and stores content-free manifest',async t=>{
  const fixture=await makeRepo('aecp-harness-knowledge-');
  t.after(()=>fs.rm(fixture.root,{recursive:true,force:true}));
  await fs.writeFile(path.join(fixture.repo,'AGENTS.md'),'Use project verification.\n');
  await exec('git',['add','AGENTS.md'],{cwd:fixture.repo});
  await exec('git',['commit','-m','agents'],{cwd:fixture.repo});
  const calls=[];
  const router=fakeRouter(async worktree=>fs.writeFile(path.join(worktree,'README.md'),'changed\n'),(role,prompt)=>calls.push({role,prompt}));
  const run=await runHarness({goal:'Verify knowledge routing.',done:'One verified change.',context:'Human instruction comes first.',
    sourceRoot:fixture.repo,runRoot:fixture.runRoot,maxTasks:1,maxIterations:1,maxTurns:3,providerRouter:router,
    plannerProvider:'planner',builderProvider:'builder',reviewerProvider:'reviewer'});
  assert.equal(run.state,'DONE',run.error||JSON.stringify(run,null,2));
  const planner=calls.find(x=>x.role==='planner').prompt;
  assert.ok(planner.indexOf('Human instruction comes first.')<planner.indexOf('REPOSITORY KNOWLEDGE'));
  assert.match(planner,/Use project verification/);
  const builder=calls.find(x=>x.role==='builder').prompt;
  assert.match(builder,/AGENTS.md/);assert.match(builder,/sha256/);
  assert.doesNotMatch(builder,/Use project verification/);
  assert.match(calls.find(x=>x.role==='reviewer').prompt,/Use project verification/);
  assert.equal(run.repoKnowledge.manifest.files[0].path,'AGENTS.md');
  assert.doesNotMatch(await fs.readFile(run.repoKnowledge.file,'utf8'),/Use project verification/);
});
