'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');

const RESET_FILES=Object.freeze(['state.json','credentials.json','provider-usage.json','restore-request.json']);
const RESET_DIRS=Object.freeze(['runtime','evidence','autonomy','harness','workers','updates','restore-staging']);

function owned(root,relative){
  const base=path.resolve(root);
  const target=path.resolve(base,relative);
  if(target===base||!target.startsWith(base+path.sep))throw new Error('AECP data operation escaped the owned data root.');
  return target;
}

async function removeOwned(root,relative,{recursive=false}={}){
  const target=owned(root,relative);
  await fs.rm(target,{recursive,force:true});
  return target;
}

async function clearEvidence(root){
  const base=path.resolve(root);
  const targets=['evidence',path.join('runtime','evidence')];
  const removed=[];
  for(const relative of targets){
    removed.push(await removeOwned(base,relative,{recursive:true}));
    await fs.mkdir(owned(base,relative),{recursive:true});
  }
  return {schema:'aecp.data-operation/v1',operation:'clear-evidence',removed:targets,workspaceFilesTouched:false};
}

function removeWorkspaceBinding(state,workspaceId){
  const id=String(workspaceId||state?.currentWorkspaceId||'');
  if(!id)return {state,removed:false,workspaceFilesTouched:false};
  const next={
    ...state,
    workspaces:Array.isArray(state?.workspaces)?state.workspaces.filter(item=>item.id!==id):[],
    currentWorkspaceId:state?.currentWorkspaceId===id?null:state?.currentWorkspaceId
  };
  return {state:next,removed:(state?.workspaces||[]).some(item=>item.id===id),workspaceFilesTouched:false};
}

async function clearCredentials(root){
  await removeOwned(root,'credentials.json');
  return {schema:'aecp.data-operation/v1',operation:'clear-credentials',removed:['credentials.json'],workspaceFilesTouched:false};
}

async function resetActiveState(root){
  const removed=[];
  for(const file of RESET_FILES){
    await removeOwned(root,file);
    removed.push(file);
  }
  for(const dir of RESET_DIRS){
    await removeOwned(root,dir,{recursive:true});
    removed.push(dir);
  }
  return {
    schema:'aecp.data-operation/v1',
    operation:'reset-active-state',
    removed,
    preserved:['pre-restore'],
    workspaceFilesTouched:false
  };
}

module.exports={RESET_FILES,RESET_DIRS,owned,clearEvidence,removeWorkspaceBinding,clearCredentials,resetActiveState};
