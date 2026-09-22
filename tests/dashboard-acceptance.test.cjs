'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Command Center answers the eight Blueprint 22 novice questions from canonical state',()=>{
  const ui=read('ui/harness-console.js');
  assert.match(ui,/Project:/);
  assert.match(ui,/Mission Queue/);
  assert.match(ui,/Agent:/);
  assert.match(ui,/task\.state|t\.state/);
  assert.match(ui,/Verifier\/Test:/);
  assert.match(ui,/Changed:/);
  assert.match(ui,/Needs me:/);
  assert.match(ui,/Next:/);
  assert.match(ui,/runtime signals come from canonical state\/evidence/);
  assert.match(ui,/UNKNOWN instead of a green status/);
});

test('Dashboard exposes authoritative human controls and event/evidence projection',()=>{
  const ui=read('ui/harness-console.js');
  assert.match(ui,/STOP ALL/);
  assert.match(ui,/Pause/);
  assert.match(ui,/Resume/);
  assert.match(ui,/Cancel/);
  assert.match(ui,/Approval Queue/);
  assert.match(ui,/Live Event Stream/);
  assert.match(ui,/JOURNALED/);
  assert.match(ui,/eventProjection/);
  assert.match(ui,/Approve & Merge/);
});

test('Dashboard and shell accessibility provide keyboard focus text status and reduced motion',()=>{
  const html=read('ui/index.html');
  const css=read('ui/styles.css');
  const ui=read('ui/harness-console.js');
  assert.match(html,/class="skip-link"/);
  assert.match(html,/role="tablist"/);
  assert.match(html,/aria-live="polite"/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);
  assert.match(css,/data-motion="reduced"/);
  assert.match(ui,/RUNNING|QUEUED|APPROVAL|TASKS DONE|PROGRESS/);
  assert.match(ui,/READY|FAILED|BLOCKED|HUMAN_REQUIRED|UNKNOWN/);
});


test('Command Center projects canonical Multi-Worker identity, health and isolated cancellation controls', async () => {
  const dashboard=await fs.readFile(path.join(__dirname,'..','ui','harness-console.js'),'utf8');
  for(const term of ['Worker Runtime','Provider: ','Model: ','Role: ','Task: ','Runtime: ','Worktree: ','Verify: ','Heartbeat: ','Cancel: ','Health ']){
    assert.ok(dashboard.includes(term), 'missing dashboard worker field: '+term);
  }
  assert.ok(dashboard.includes('snapshot.workers'));
  assert.ok(dashboard.includes('data-builder-worker'));
  assert.ok(dashboard.includes('builderWorkers'));
  assert.ok(dashboard.includes('data-cancel-task'));
  assert.ok(dashboard.includes('window.aecp.cancelTask'));
  assert.ok(dashboard.includes('Other workers and tasks will keep running'));
});
