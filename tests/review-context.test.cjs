'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {buildReviewInput,blueprintContext,DIFF_LIMIT}=require('../electron/lib/review-context.cjs');

function git(root,...args){execFileSync('git',args,{cwd:root,windowsHide:true});}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-review-context-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  git(root,'init','-q');git(root,'config','user.email','test@aecp.local');git(root,'config','user.name','AECP Test');
  await fs.mkdir(path.join(root,'.ai'));
  await fs.writeFile(path.join(root,'.ai','BLUEPRINT.md'),'# Blueprint\nSECRET=abcdef123456\n');
  await fs.writeFile(path.join(root,'app.txt'),'before\n');
  git(root,'add','.');git(root,'commit','-qm','base');
  return root;
}

test('Reviewer input includes bounded redacted Blueprint full Plan actual diff and verification evidence',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'app.txt'),'after\n');
  await fs.writeFile(path.join(root,'new.txt'),'new content\n');
  const plan={schema:'aecp.plan/v1',tasks:[{id:'T1',dependencies:[]},{id:'T2',dependencies:['T1']} ]};
  const result=await buildReviewInput({sourceRoot:root,worktree:root,runRoot:path.join(root,'.run'),
    task:{id:'T2',blueprint_refs:['.ai/BLUEPRINT.md']},plan,verification:{passed:true,command:'npm test'},iteration:1});
  const prompt=JSON.stringify(result.input);
  assert.match(prompt,/Blueprint/);
  assert.match(prompt,/T1/);assert.match(prompt,/T2/);
  assert.match(prompt,/\+after/);assert.match(prompt,/new content/);
  assert.match(prompt,/npm test/);
  assert.doesNotMatch(prompt,/abcdef123456/);
  assert.match(prompt,/\[REDACTED\]/);
  assert.equal(result.input.diff.changedFiles.includes('new.txt'),true);
  assert.ok(result.input.diff.stats.additions>=2);
  assert.ok(result.input.diff.stats.deletions>=1);
  assert.ok(result.input.diff.stats.untrackedFiles.includes('new.txt'));
  assert.equal(result.input.diff.stats.baseCommit,result.input.diff.stats.currentCommit);
  assert.equal(result.sha256.length,64);
  assert.equal((await fs.readFile(result.file,'utf8')).includes('abcdef123456'),false);
});

test('Reviewer blueprint references reject traversal and symlink escape',async t=>{
  const root=await fixture(t);
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-review-outside-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(outside,'private.md'),'outside private');
  await fs.symlink(path.join(outside,'private.md'),path.join(root,'escape.md'));
  const found=await blueprintContext(root,['../private.md','escape.md']);
  assert.equal(found.files[1].missing,true);
  assert.equal(found.files[2].missing,true);
  assert.doesNotMatch(JSON.stringify(found),/outside private/);
});

test('Reviewer diff is truncated per file and names omitted material with byte sizes',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'app.txt'),'x'.repeat(DIFF_LIMIT+5000));
  const result=await buildReviewInput({sourceRoot:root,worktree:root,runRoot:path.join(root,'.run'),
    task:{id:'T1'},plan:{schema:'aecp.plan/v1',tasks:[{id:'T1'}]},verification:{passed:true},iteration:1});
  assert.equal(result.input.diff.files[0].truncated,true);
  assert.ok(result.input.diff.omitted.some(x=>x.path==='app.txt'&&x.bytes>DIFF_LIMIT));
});
