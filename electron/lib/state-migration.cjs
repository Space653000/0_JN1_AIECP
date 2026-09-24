'use strict';

function array(value){return Array.isArray(value)?value:[];}

function migrateV0ToV1(input){
  return {
    ...input,
    schemaVersion:1,
    currentWorkspaceId:input?.currentWorkspaceId||null,
    workspaces:array(input?.workspaces),
    tasks:array(input?.tasks),
    providers:array(input?.providers)
  };
}

function migrateState(input,currentVersion=1){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Local state must be a JSON object.');
  const rawVersion=input.schemaVersion==null?0:Number(input.schemaVersion);
  if(!Number.isInteger(rawVersion)||rawVersion<0) throw new Error('Invalid local state schemaVersion.');
  if(rawVersion>currentVersion){
    return {
      mode:'READ_ONLY_RECOVERY',
      migrated:false,
      sourceVersion:rawVersion,
      targetVersion:currentVersion,
      reason:`State schema ${rawVersion} is newer than supported schema ${currentVersion}.`,
      state:{...input}
    };
  }
  let version=rawVersion;
  let state={...input};
  while(version<currentVersion){
    if(version===0){state=migrateV0ToV1(state);version=1;continue;}
    throw new Error(`No migration path from schema ${version} to ${version+1}.`);
  }
  state.workspaces=array(state.workspaces);
  state.tasks=array(state.tasks);
  state.providers=array(state.providers);
  state.currentWorkspaceId=state.currentWorkspaceId||null;
  return {
    mode:'READ_WRITE',
    migrated:rawVersion!==currentVersion,
    sourceVersion:rawVersion,
    targetVersion:currentVersion,
    reason:null,
    state
  };
}

module.exports={migrateState,migrateV0ToV1};
