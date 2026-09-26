'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('Workspace authorization is explicit and never silently expanded by first-run logic',()=>{
  const main=read('electron/main.cjs');
  const app=read('ui/app.js');
  assert.match(main,/ipc\.handle\('workspace:select'/);
  assert.match(main,/dialog\.showOpenDialog\(mainWindow,[\s\S]*properties:\s*\['openDirectory',\s*'createDirectory'\]/);
  assert.match(main,/if \(!workspace\) throw new Error\('Choose a Workspace first\.'/);
  assert.match(app,/Choose a Workspace/);
  assert.match(app,/one explicit local folder boundary/);
  assert.doesNotMatch(main,/workspace:select[\s\S]{0,1200}(?:C:\\\\|[A-Z]:\\\\|\/Users\/|\/home\/).*readdir/i);
});

test('clipboard bridge remains explicit user-triggered rather than background-polled',()=>{
  const main=read('electron/main.cjs');
  const app=read('ui/app.js');
  assert.match(main,/ipc\.handle\('clipboard:read'/);
  assert.match(main,/ipc\.handle\('clipboard:write'/);
  assert.match(app,/importFromClipboard/);
  assert.doesNotMatch(main,/setInterval\([\s\S]{0,500}clipboard/i);
  assert.doesNotMatch(app,/setInterval\([\s\S]{0,500}(?:readClipboard|clipboard)/i);
});

test('Goal Loop is visibly bounded and exposes deterministic terminal states',()=>{
  const app=read('ui/app.js');
  assert.match(app,/Maximum iterations:/);
  assert.match(app,/Checkpoint every:/);
  assert.match(app,/DONE, BLOCKED, NEEDS_APPROVAL, or NEXT_ITERATION/);
  assert.match(app,/Completion requires evidence against the Definition of Done/);
});

test('human pause cancel and emergency stop controls remain authoritative',()=>{
  const preload=read('electron/preload.cjs');
  const main=read('electron/main.cjs');
  const consoleUi=read('ui/harness-console.js');
  assert.match(preload,/pauseMission/);
  assert.match(preload,/cancelMission/);
  assert.match(main,/control-plane:pause/);
  assert.match(main,/control-plane:cancel/);
  assert.match(consoleUi,/STOP ALL/);
  assert.match(consoleUi,/hcEmergency/);
  assert.match(consoleUi,/cancelMission\(r\.id\)/);
});

test('Execution Mode recommendation is factual and never promotes generic MCP endpoint health to Official Full MCP',()=>{
  const app=read('ui/app.js');
  assert.match(app,/Web Safe Bridge/);
  assert.match(app,/Local Autonomous/);
  assert.match(app,/Official Full MCP/);
  assert.match(app,/ready:\s*status\.localWorkers\.length\s*>\s*0/);
  assert.match(app,/const officialMcpReady = false/);
  assert.match(app,/ready:\s*status\.officialMcpReady/);
  assert.match(app,/Remote MCP endpoint health passed, but Official Full MCP is still externally gated/);
  assert.match(app,/This alone never makes Official Full MCP ready/);
  assert.match(app,/const recommended = localWorkers\.length \? 'local-autonomous' : 'web-safe'/);
  assert.doesNotMatch(app,/recommended\s*=\s*remoteMcp\s*\?/);
  assert.match(app,/No ChatGPT DOM scraping/);
});


test('Goal Loop provides bounded task-shaped presets without bypassing approval policy',()=>{
  const app=read('ui/app.js');
  for(const id of ['research','build','debug','review','optimization','release']){
    assert.match(app,new RegExp(id+": \\{"));
  }
  assert.match(app,/data-action="apply-loop-preset"/);
  assert.match(app,/localStorage\.setItem\('aecp-goal-loop'/);
  assert.match(app,/maxIterations:/);
  assert.match(app,/checkpointEvery:/);
  assert.match(app,/signing\/Store\/publish owner gates are explicitly satisfied or HUMAN_REQUIRED/);
});


test('Add Repo is explicit and cannot widen the authorized Workspace boundary', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const app = read('ui/app.js');
  const html = read('ui/index.html');
  assert.match(main, /async function addWorkspaceRepository\(\)/);
  assert.match(main, /workspace:add-repo/);
  assert.match(main, /assertWithinRoot\(workspace\.rootPath, selected\)/);
  assert.match(main, /assertWithinRoot\(workspace\.rootPath, repoRoot\)/);
  assert.match(main, /Select the Git repository root itself/);
  assert.match(main, /manualRepositories/);
  assert.match(main, /buildWorkspace\(workspace\.rootPath, \{ \.\.\.workspace, manualRepositories: manual \}\)/);
  assert.match(preload, /addRepository/);
  assert.match(app, /addRepository/);
  assert.match(html, /id="addRepoButton"/);
});


test('first-run onboarding seeds one safe read-only task without auto-executing it',()=>{
  const html=read('ui/index.html');
  const app=read('ui/app.js');
  const main=read('electron/main.cjs');
  assert.match(html,/Safety summary/);
  assert.match(html,/GREEN = read-only local inspection/);
  assert.match(html,/RED = push, merge, delete, credentials, system changes/);
  assert.match(app,/const hadWorkspace = Boolean/);
  assert.match(app,/!hadWorkspace && state\.tasks\.length === 0/);
  assert.match(app,/await createSampleTask\(\)/);
  assert.match(main,/task:sample/);
  assert.doesNotMatch(app,/!hadWorkspace[\s\S]{0,300}executeTask/);
});


test('mutating local runtimes are mutually exclusive rather than racing the same Workspace',()=>{
  const main=read('electron/main.cjs');
  assert.match(main,/startHarness[\s\S]*if \(autonomyController\) throw new Error\('Stop the active autonomous run before starting Harness\.'/);
  assert.match(main,/startHarness[\s\S]*controlPlane\?\.hasActiveWork/);
  assert.match(main,/startAutonomy[\s\S]*if \(harnessController\) throw new Error\('Stop the active Harness run before starting bounded autonomy\.'/);
  assert.match(main,/startAutonomy[\s\S]*controlPlane\?\.hasActiveWork/);
});


test('Goal Loop exposes complete bounded budgets and passes them to Harness',()=>{
  const app=read('ui/app.js');
  for(const id of ['loopIterations','loopTurns','loopFailures','loopWallMinutes','loopProviderCost','loopLocalComputeMinutes','loopCheckpoint']){
    assert.match(app,new RegExp('id="' + id + '"'));
  }
  assert.match(app,/maxProviderReportedCost/);
  assert.match(app,/maxLocalComputeMs/);
  assert.match(app,/PROVIDER_COST_BUDGET/);
  assert.match(app,/LOCAL_COMPUTE_BUDGET/);
  assert.match(app,/Maximum agent\/tool turns/);
  assert.match(app,/Provider-reported cost budget/);
  assert.match(app,/Local compute budget/);
});
