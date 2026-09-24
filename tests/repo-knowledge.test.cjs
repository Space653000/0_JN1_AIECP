'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {discoverRepoKnowledge,knowledgeManifest,formatKnowledge,FILE_LIMIT,TOTAL_LIMIT}=require('../electron/lib/repo-knowledge.cjs');
const {scan}=require('../electron/lib/drift-scanner.cjs');

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
  assert.match(formatKnowledge(k,{discoversAgentsMd:false}),/root instructions/);
  assert.doesNotMatch(formatKnowledge(k,{discoversAgentsMd:true}),/root instructions|service instructions/);
  assert.match(formatKnowledge(k,{discoversAgentsMd:true}),/sha256/);
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

test('drift scan warns on missing agent memory and verifier without writing target repo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-drift-knowledge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'README.md'),'# Test');
  const before=await fs.readdir(root);
  const result=await scan(root,{requiredFiles:['README.md']});
  assert.ok(result.findings.some(x=>x.type==='AGENTS_MD_MISSING'&&x.severity==='WARNING'));
  assert.ok(result.findings.some(x=>x.type==='VERIFICATION_COMMAND_MISSING'&&x.severity==='WARNING'));
  assert.deepEqual(await fs.readdir(root),before);
});

test('drift scan reports significant STATUS versus Blueprint/23 mtime without editing either',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-status-drift-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'.ai'));await fs.mkdir(path.join(root,'Blueprint'));
  const ai=path.join(root,'.ai','STATUS.md'),blueprint=path.join(root,'Blueprint','23_IMPLEMENTATION_STATUS.md');
  await fs.writeFile(ai,'status');await fs.writeFile(blueprint,'blueprint');
  const old=new Date(Date.now()-45*24*60*60*1000);await fs.utimes(blueprint,old,old);
  const before=await Promise.all([fs.readFile(ai,'utf8'),fs.readFile(blueprint,'utf8')]);
  const result=await scan(root,{requiredFiles:[]});
  assert.ok(result.findings.some(x=>x.type==='STATUS_BLUEPRINT_MTIME_DRIFT'&&x.severity==='WARNING'));
  assert.deepEqual(await Promise.all([fs.readFile(ai,'utf8'),fs.readFile(blueprint,'utf8')]),before);
});
