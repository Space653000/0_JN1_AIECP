'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {
 createBackup,validateBackup,writeBackup,stageRestore,applyPendingRestore,safeRelative
}=require('../electron/lib/backup-manager.cjs');

test('backup excludes credentials and verifies every file hash',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-backup-'));
 try{
  await fs.writeFile(path.join(root,'state.json'),'{"schemaVersion":1}');
  await fs.writeFile(path.join(root,'credentials.json'),'SECRET');
  await fs.mkdir(path.join(root,'runtime'),{recursive:true});
  await fs.writeFile(path.join(root,'runtime','control-plane.json'),'{"ok":true}');
  const backup=await createBackup(root,{appVersion:'0.3.0'});
  assert.ok(backup.files.some(f=>f.path==='state.json'));
  assert.ok(backup.files.some(f=>f.path==='runtime/control-plane.json'));
  assert.equal(backup.files.some(f=>f.path.includes('credentials.json')),false);
  assert.equal(validateBackup(backup).files.length,backup.files.length);
  backup.files[0].data=Buffer.from('tampered').toString('base64');
  assert.throws(()=>validateBackup(backup),/size mismatch|SHA-256 mismatch/);
 } finally {await fs.rm(root,{recursive:true,force:true})}
});

test('restore is staged, path-safe, and preserves a pre-restore copy',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-restore-'));
 const exportFile=path.join(root,'export.aecp-backup.json');
 try{
  await fs.writeFile(path.join(root,'state.json'),'old-state');
  await fs.mkdir(path.join(root,'runtime'),{recursive:true});
  await fs.writeFile(path.join(root,'runtime','control-plane.json'),'old-runtime');
  await writeBackup(root,exportFile,{appVersion:'0.3.0'});

  await fs.writeFile(path.join(root,'state.json'),'newer-state');
  const request=await stageRestore(root,exportFile);
  assert.match(request.id,/^restore-/);
  const applied=await applyPendingRestore(root);
  assert.equal(await fs.readFile(path.join(root,'state.json'),'utf8'),'old-state');
  assert.equal(await fs.readFile(path.join(applied.preRestoreBackup,'state.json'),'utf8'),'newer-state');
 } finally {await fs.rm(root,{recursive:true,force:true})}
});

test('backup restore rejects traversal and disallowed credential paths',()=>{
 assert.throws(()=>safeRelative('../outside'),/escapes/);
 assert.throws(()=>safeRelative('/absolute'),/invalid/);
 assert.throws(()=>safeRelative('credentials.json'),/disallowed/);
});
