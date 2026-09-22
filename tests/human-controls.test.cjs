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
  assert.match(main,/ipcMain\.handle\('workspace:select'/);
  assert.match(main,/dialog\.showOpenDialog\(mainWindow,[\s\S]*properties:\s*\['openDirectory',\s*'createDirectory'\]/);
  assert.match(main,/if \(!workspace\) throw new Error\('Choose a Workspace first\.'/);
  assert.match(app,/Choose a Workspace/);
  assert.match(app,/one explicit local folder boundary/);
  assert.doesNotMatch(main,/workspace:select[\s\S]{0,1200}(?:C:\\\\|[A-Z]:\\\\|\/Users\/|\/home\/).*readdir/i);
});

test('clipboard bridge remains explicit user-triggered rather than background-polled',()=>{
  const main=read('electron/main.cjs');
  const app=read('ui/app.js');
  assert.match(main,/ipcMain\.handle\('clipboard:read'/);
  assert.match(main,/ipcMain\.handle\('clipboard:write'/);
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

test('Execution Mode recommendation is factual and keeps Full MCP gated on remote readiness',()=>{
  const app=read('ui/app.js');
  assert.match(app,/Web Safe Bridge/);
  assert.match(app,/Local Autonomous/);
  assert.match(app,/Official Full MCP/);
  assert.match(app,/ready:\s*status\.localWorkers\.length\s*>\s*0/);
  assert.match(app,/ready:\s*Boolean\(status\.remoteMcp\)/);
  assert.match(app,/End-to-end tunnel\/app health must still pass before write mode is enabled/);
  assert.match(app,/No ChatGPT DOM scraping/);
});
