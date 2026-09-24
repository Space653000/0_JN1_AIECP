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

test('Run timeline event buttons expose canonical event IDs and evidence by keyboard',()=>{
  const ui=read('ui/harness-console.js');
  const control=read('electron/lib/control-plane.cjs');
  assert.match(ui,/AECPDashboard\.timeline\(events/);
  assert.match(ui,/data-event-id/);
  assert.match(ui,/selectedEvent\.evidence\.sha256/);
  assert.match(ui,/aria-live="polite"/);
  assert.match(read('ui/index.html'),/dashboard-projection\.js/);
  assert.match(read('ui/styles.css'),/\.hc-event-button:focus-visible/);
  assert.match(control,/this\.event\('task\.event'/);
  assert.match(control,/eventSha256/);
});
test('Diff view renders canonical changed-file and verifier fields with UNKNOWN fallback',()=>{
  const ui=read('ui/harness-console.js');
  for(const field of ['diffView.changedFiles','diffView.additions','diffView.deletions','diffView.untrackedFiles','diffView.patchBytes','diffView.baseCommit','diffView.currentCommit','diffView.verifierStatus'])assert.ok(ui.includes(field));
  assert.match(read('ui/dashboard-projection.js'),/UNKNOWN/);
});
test('Review view renders six dimensions and textual human-required warning',()=>{
  const ui=read('ui/harness-console.js');
  assert.match(ui,/AECPDashboard\.reviewView\(focusTask\)/);
  assert.match(ui,/REVIEW_DIMENSIONS/);
  assert.match(ui,/⚠ /);
  assert.match(ui,/HUMAN_REQUIRED/);
});
test('GitHub view renders all nine Blueprint fields from projection',()=>{
  const ui=read('ui/harness-console.js');
  for(const field of ['branch','base','commit','pr','ciStatus','workflow','artifacts','release','lastEvent'])assert.ok(ui.includes('githubView.'+field));
  assert.match(ui,/AECPDashboard\.githubView\(focusTask,events\)/);
});
test('Notification view uses event projection and presentation-only read state',()=>{
  const ui=read('ui/harness-console.js');
  assert.match(ui,/AECPDashboard\.notifications\(events/);
  assert.match(ui,/presentation-only; never written to Control Plane/);
  assert.match(ui,/data-read-notification/);
  assert.match(ui,/href=\\?"#hcApprovals/);
  assert.match(ui,/⚠ /);
});
test('Progress overview renders five named phases and UNKNOWN instead of fake mission progress',()=>{
  const ui=read('ui/harness-console.js');
  assert.match(ui,/AECPDashboard\.progressView\(runs,tasks/);
  assert.match(ui,/PROGRESS_PHASES/);
  assert.match(ui,/No mission is UNKNOWN/);
  assert.match(ui,/<progress value=/);
  assert.match(ui,/typeof pct==='number'\?pct\+'%':'UNKNOWN'/);
});
test('new Dashboard labels exist in both English and Traditional Chinese',()=>{
  const {DICTIONARIES}=require('../ui/i18n.js');
  for(const key of ['dashboard.timeline','dashboard.diff','dashboard.review','dashboard.github','dashboard.notifications','dashboard.progress',
    'dashboard.progress.planning','dashboard.progress.implementation','dashboard.progress.testing','dashboard.progress.review','dashboard.progress.acceptance']){
    assert.ok(DICTIONARIES.en[key],key+' missing en');assert.ok(DICTIONARIES['zh-TW'][key],key+' missing zh-TW');
  }
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
  const dashboard=read('ui/harness-console.js');
  for(const term of ['Worker Runtime','Provider: ','Model: ','Role: ','Task: ','Runtime: ','Repository: ','Worktree: ','Verify: ','Heartbeat: ','Cancel: ','Health ']){
    assert.ok(dashboard.includes(term), 'missing dashboard worker field: '+term);
  }
  assert.ok(dashboard.includes('snapshot.workers'));
  assert.ok(dashboard.includes('data-builder-worker'));
  assert.ok(dashboard.includes('builderWorkers'));
  assert.ok(dashboard.includes('data-cancel-task'));
  assert.ok(dashboard.includes('window.aecp.cancelTask'));
  assert.ok(dashboard.includes('Other workers and tasks will keep running'));
});


test('V3.0 readiness panel separates repository runtime readiness from real provider environment evidence',()=>{
  const ui=read('ui/harness-console.js');
  for(const term of [
    'V3.0 Multi-Worker Readiness',
    'WORKER REGISTRY',
    'CODEX_HOME ISOLATION',
    'PARALLEL RUNTIME',
    'OFFICIAL HEALTH',
    'PEGA HEALTH',
    'REAL PROVIDER EVIDENCE',
    'ENVIRONMENT GATE'
  ]){
    assert.ok(ui.includes(term), 'missing V3 readiness field: '+term);
  }
  assert.match(ui,/workers\.find\(w=>w\.id==='codex-official'\)/);
  assert.match(ui,/workers\.find\(w=>w\.id==='codex-pega'\)/);
  assert.match(ui,/officialWorker\?\.codexHome/);
  assert.match(ui,/pegaWorker\?\.codexHome/);
  assert.match(ui,/parallelWorktreesIsolated/);
  assert.match(ui,/never inferred from source tests or health alone/);
  assert.match(ui,/real OFFICIAL\/PEGA model execution remains an ENVIRONMENT gate/);
});
