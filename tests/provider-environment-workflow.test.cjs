'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('real provider evidence workflow is manual and pinned to the dedicated self-hosted runner label',()=>{
  const workflow=read('.github/workflows/provider-environment.yml');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/pull_request:/);
  assert.match(workflow,/runs-on:\s*\[self-hosted, Windows, aecp-provider\]/);
  assert.match(workflow,/ref:\s*\$\{\{ inputs\.source_ref \}\}/);
  assert.match(workflow,/persist-credentials:\s*false/);
  assert.match(workflow,/timeout-minutes:\s*120/);
});

test('real provider workflow requires explicit model and fixed local command only when relevant',()=>{
  const workflow=read('.github/workflows/provider-environment.yml');
  assert.match(workflow,/An explicit model is required for the selected real-provider mode/);
  assert.match(workflow,/A fixed local\/company worker command is required for local-command\/all mode/);
  assert.match(workflow,/AECP_PROVIDER_VERIFY_MODEL/);
  assert.match(workflow,/AECP_PROVIDER_VERIFY_LOCAL_COMMAND/);
  assert.match(workflow,/AECP_PROVIDER_VERIFY_LOCAL_ARGS_JSON/);
});

test('provider environment evidence is exact-source, privacy-bounded and uploaded even after failure',()=>{
  const workflow=read('.github/workflows/provider-environment.yml');
  assert.match(workflow,/git rev-parse HEAD/);
  assert.match(workflow,/Evidence source commit mismatch/);
  assert.match(workflow,/promptBodiesPersisted/);
  assert.match(workflow,/responseBodiesPersisted/);
  assert.match(workflow,/credentialsPersisted/);
  assert.match(workflow,/if:\s*always\(\)[\s\S]*Upload real provider evidence/);
  assert.match(workflow,/artifacts\/provider-environment-evidence\.json/);
});

test('real provider evidence runner exercises Ollama OpenCode local-command and canonical Harness paths',()=>{
  const script=read('scripts/provider-environment-verify.cjs');
  assert.match(script,/ollama\.real-smoke/);
  assert.match(script,/opencode\.ollama-real-edit/);
  assert.match(script,/local-command\.real-smoke/);
  assert.match(script,/canonical-harness\.ollama-opencode/);
  assert.match(script,/plannerProvider:'ollama'/);
  assert.match(script,/builderProvider:'opencode'/);
  assert.match(script,/reviewerProvider:'ollama'/);
  assert.match(script,/providerNetworkApproved:false/);
  assert.match(script,/providerCredentialApproved:false/);
  assert.match(script,/runHarness/);
});

test('real provider evidence persists hashes and states instead of model prompt or response bodies',()=>{
  const script=read('scripts/provider-environment-verify.cjs');
  assert.match(script,/outputSha256/);
  assert.match(script,/fileSha256/);
  assert.match(script,/patchSha256/);
  assert.match(script,/promptBodiesPersisted:false/);
  assert.match(script,/responseBodiesPersisted:false/);
  assert.match(script,/credentialsPersisted:false/);
  assert.doesNotMatch(script,/evidence\.checks\.push\([^\n]*stdout/);
  assert.doesNotMatch(script,/evidence\.checks\.push\([^\n]*stderr/);
});
