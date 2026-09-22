'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {
  RESET_FILES,RESET_DIRS,owned,clearEvidence,removeWorkspaceBinding,clearCredentials,resetActiveState
}=require('../electron/lib/local-data-manager.cjs');

test('owned rejects paths that escape the AECP data root',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-data-owned-'));
  try{
    assert.throws(()=>owned(root,'../outside'),/escaped/);
    assert.match(owned(root,'evidence'),/evidence$/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('clearEvidence removes only AECP evidence roots and does not touch Workspace files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-data-evidence-'));
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-workspace-protected-'));
  try{
    await fs.mkdir(path.join(root,'evidence','task-a'),{recursive:true});
    await fs.mkdir(path.join(root,'runtime','evidence','run-a'),{recursive:true});
    await fs.writeFile(path.join(root,'evidence','task-a','result.json'),'{}');
    await fs.writeFile(path.join(root,'runtime','evidence','run-a','result.json'),'{}');
    await fs.writeFile(path.join(workspace,'KEEP.txt'),'workspace-data');
    const result=await clearEvidence(root);
    assert.equal(result.workspaceFilesTouched,false);
    assert.deepEqual(await fs.readdir(path.join(root,'evidence')),[]);
    assert.deepEqual(await fs.readdir(path.join(root,'runtime','evidence')),[]);
    assert.equal(await fs.readFile(path.join(workspace,'KEEP.txt'),'utf8'),'workspace-data');
  }finally{
    await fs.rm(root,{recursive:true,force:true});
    await fs.rm(workspace,{recursive:true,force:true});
  }
});

test('removeWorkspaceBinding edits only local state and never accesses the bound folder',()=>{
  const state={
    currentWorkspaceId:'ws-a',
    workspaces:[
      {id:'ws-a',rootPath:'C:\\Users\\User\\ProjectA',name:'A'},
      {id:'ws-b',rootPath:'C:\\Users\\User\\ProjectB',name:'B'}
    ],
    tasks:[{id:'task-1'}],
    providers:[]
  };
  const result=removeWorkspaceBinding(state,'ws-a');
  assert.equal(result.removed,true);
  assert.equal(result.workspaceFilesTouched,false);
  assert.equal(result.state.currentWorkspaceId,null);
  assert.deepEqual(result.state.workspaces.map(x=>x.id),['ws-b']);
  assert.deepEqual(result.state.tasks,state.tasks);
});

test('clearCredentials removes only the AECP credential store',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-data-credentials-'));
  try{
    await fs.writeFile(path.join(root,'credentials.json'),'{"secret":"x"}');
    await fs.writeFile(path.join(root,'state.json'),'{"keep":true}');
    const result=await clearCredentials(root);
    assert.equal(result.workspaceFilesTouched,false);
    await assert.rejects(fs.access(path.join(root,'credentials.json')));
    assert.equal(await fs.readFile(path.join(root,'state.json'),'utf8'),'{"keep":true}');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('resetActiveState deletes only allowlisted AECP active state and preserves pre-restore plus unrelated files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-data-reset-'));
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-workspace-reset-protected-'));
  try{
    for(const file of RESET_FILES) await fs.writeFile(path.join(root,file),'x');
    for(const dir of RESET_DIRS){
      await fs.mkdir(path.join(root,dir),{recursive:true});
      await fs.writeFile(path.join(root,dir,'owned.txt'),'owned');
    }
    await fs.mkdir(path.join(root,'pre-restore','safe-copy'),{recursive:true});
    await fs.writeFile(path.join(root,'pre-restore','safe-copy','backup.txt'),'backup');
    await fs.writeFile(path.join(root,'KEEP-UNRELATED.txt'),'keep');
    await fs.writeFile(path.join(workspace,'KEEP-WORKSPACE.txt'),'workspace');

    const result=await resetActiveState(root);
    assert.equal(result.workspaceFilesTouched,false);
    assert.deepEqual(result.preserved,['pre-restore']);
    for(const file of RESET_FILES) await assert.rejects(fs.access(path.join(root,file)));
    for(const dir of RESET_DIRS) await assert.rejects(fs.access(path.join(root,dir)));
    assert.equal(await fs.readFile(path.join(root,'pre-restore','safe-copy','backup.txt'),'utf8'),'backup');
    assert.equal(await fs.readFile(path.join(root,'KEEP-UNRELATED.txt'),'utf8'),'keep');
    assert.equal(await fs.readFile(path.join(workspace,'KEEP-WORKSPACE.txt'),'utf8'),'workspace');
  }finally{
    await fs.rm(root,{recursive:true,force:true});
    await fs.rm(workspace,{recursive:true,force:true});
  }
});

test('main process data operations are native-confirmed and blocked while work is active',async()=>{
  const main=await fs.readFile(path.join(__dirname,'..','electron','main.cjs'),'utf8');
  const preload=await fs.readFile(path.join(__dirname,'..','electron','preload.cjs'),'utf8');
  const ui=await fs.readFile(path.join(__dirname,'..','ui','app.js'),'utf8');
  const html=await fs.readFile(path.join(__dirname,'..','ui','index.html'),'utf8');
  assert.match(main,/assertDataOperationIdle/);
  assert.match(main,/if \(harnessController\)/);
  assert.match(main,/if \(autonomyController\)/);
  assert.match(main,/controlPlane\?\.hasActiveWork/);
  assert.match(main,/dialog\.showMessageBox/);
  assert.match(main,/Workspace\/project files are never deleted/);
  assert.match(main,/data:clear-evidence/);
  assert.match(main,/data:remove-workspace/);
  assert.match(main,/data:clear-credentials/);
  assert.match(main,/data:reset-state/);
  assert.match(preload,/clearEvidence/);
  assert.match(preload,/removeWorkspaceBinding/);
  assert.match(preload,/clearStoredCredentials/);
  assert.match(preload,/resetLocalState/);
  assert.match(ui,/clearEvidenceData/);
  assert.match(ui,/removeWorkspaceBindingData/);
  assert.match(ui,/clearCredentialData/);
  assert.match(ui,/resetLocalStateData/);
  assert.match(html,/Local data controls/);
  assert.match(html,/Workspace files protected/);
});
