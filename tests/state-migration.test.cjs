'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {migrateState}=require('../electron/lib/state-migration.cjs');

test('legacy schema-less state migrates explicitly to v1',()=>{
 const result=migrateState({currentWorkspaceId:'ws-1',workspaces:[{id:'ws-1'}]},1);
 assert.equal(result.mode,'READ_WRITE');
 assert.equal(result.migrated,true);
 assert.equal(result.sourceVersion,0);
 assert.equal(result.state.schemaVersion,1);
 assert.deepEqual(result.state.tasks,[]);
 assert.deepEqual(result.state.providers,[]);
});

test('current state remains writable without migration',()=>{
 const result=migrateState({schemaVersion:1,currentWorkspaceId:null,workspaces:[],tasks:[],providers:[]},1);
 assert.equal(result.mode,'READ_WRITE');
 assert.equal(result.migrated,false);
});

test('unknown newer state enters read-only recovery without destructive downgrade',()=>{
 const source={schemaVersion:9,futureField:{must:'survive'},workspaces:[],tasks:[],providers:[]};
 const result=migrateState(source,1);
 assert.equal(result.mode,'READ_ONLY_RECOVERY');
 assert.equal(result.migrated,false);
 assert.deepEqual(result.state.futureField,{must:'survive'});
 assert.equal(result.state.schemaVersion,9);
});
