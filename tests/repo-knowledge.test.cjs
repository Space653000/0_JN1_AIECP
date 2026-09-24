'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {discoverRepoKnowledge,knowledgeManifest,FILE_LIMIT,TOTAL_LIMIT}=require('../electron/lib/repo-knowledge.cjs');

test('repo knowledge discovers layered AGENTS, blueprint entry, scripts and decision names',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-repo-knowledge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'services','api'),{recursive:true});await fs.mkdir(path.join(root,'.ai'));
  await fs.mkdir(path.join(root,'docs','architecture'),{recursive:true});
  await fs.writeFile(path.join(root,'AGENTS.md'),'root instructions');
  await fs.writeFile(path.join(root,'services','AGENTS.md'),'service instructions');
  await fs.writeFile(path.join(root,'services','api','AGENTS.md'),'SECRET=abcdef123456\n'+'x'.repeat(FILE_LIMIT));
  await fs.writeFile(path.join(root,'.ai','BLUEPRINT.md'),'# Blueprint');
  await fs.writeFile(path.join(root,'docs','architecture','adr001.md'),'private decision body');
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{verify:'npm test',test:'node --test',check:'node --check a.js'}}));
  const k=await discoverRepoKnowledge(root,{targetPaths:['services/api/src/new.js']});
  assert.deepEqual(k.files.filter(x=>x.path.endsWith('AGENTS.md')).map(x=>x.path),['AGENTS.md','services/api/AGENTS.md','services/AGENTS.md']);
  assert.ok(k.files.some(x=>x.path==='.ai/BLUEPRINT.md'));
  assert.equal(k.verificationCommands.verify,'npm test');
  assert.deepEqual(k.decisions,['docs/architecture/adr001.md']);
  assert.ok(k.files.find(x=>x.path==='services/api/AGENTS.md').truncated);
  assert.ok(k.files.every(x=>Buffer.byteLength(x.included)<=FILE_LIMIT));
  assert.ok(k.files.reduce((a,x)=>a+Buffer.byteLength(x.included),0)<=TOTAL_LIMIT);
  assert.doesNotMatch(JSON.stringify(k),/abcdef123456|private decision body/);
  assert.doesNotMatch(JSON.stringify(knowledgeManifest(k)),/root instructions/);
});

test('repo knowledge rejects traversal and symlink escape without reading outside',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-knowledge-safe-'));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-knowledge-outside-'));
  t.after(()=>Promise.all([fs.rm(root,{recursive:true,force:true}),fs.rm(outside,{recursive:true,force:true})]));
  await fs.writeFile(path.join(outside,'AGENTS.md'),'outside secret');
  await fs.symlink(outside,path.join(root,'linked'),'junction');
  const k=await discoverRepoKnowledge(root,{targetPaths:['../escape.js','linked/task.js']});
  assert.ok(k.missing.some(x=>x.startsWith('REJECTED_PATH:')));
  assert.doesNotMatch(JSON.stringify(k),/outside secret/);
});
