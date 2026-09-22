'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {
  resolveKnownCommand,
  resolveNodeExecutable,
  parseNodeCmdShim
}=require('../electron/lib/command-resolver.cjs');

function fakeFs(existing,files={}){
  const set=new Set(existing.map(x=>path.win32.normalize(x).toLowerCase()));
  return {
    exists(value){return set.has(path.win32.normalize(String(value)).toLowerCase());},
    read(value){const key=path.win32.normalize(String(value)).toLowerCase();if(!(key in files))throw new Error('missing');return files[key];}
  };
}

test('Windows npm uses npm_execpath with node.exe instead of cmd shell',()=>{
  const node='C:\\Program Files\\nodejs\\node.exe';
  const npm='C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const fs=fakeFs([node,npm]);
  const result=resolveKnownCommand('npm',['run','verify'],{
    platform:'win32',
    env:{npm_node_execpath:node,npm_execpath:npm},
    execPath:node,
    exists:fs.exists,
    read:fs.read,
    where:()=>[]
  });
  assert.equal(result.command,node);
  assert.deepEqual(result.args,[npm,'run','verify']);
  assert.equal(result.source,'npm-execpath');
});

test('standard npm-style cmd shim is parsed to node plus JS entrypoint',()=>{
  const shim='C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd';
  const script='C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
  const node='C:\\Program Files\\nodejs\\node.exe';
  const source=[
    '@ECHO off',
    'SET dp0=%~dp0',
    '"%dp0%\\node.exe"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*'
  ].join('\r\n');
  const key=path.win32.normalize(shim).toLowerCase();
  const fs=fakeFs([shim,script,node],{[key]:source});
  const parsed=parseNodeCmdShim(shim,{read:fs.read,exists:fs.exists,nodeExecutable:node});
  assert.equal(parsed.command,node);
  assert.deepEqual(parsed.argsPrefix,[script]);

  const resolved=resolveKnownCommand('codex',['exec','PROMPT & must stay an argv value'],{
    platform:'win32',
    env:{npm_node_execpath:node},
    execPath:'C:\\AECP\\AECP.exe',
    exists:fs.exists,
    read:fs.read,
    where:(name)=>name==='codex'?[shim]:name==='node'?[node]:[]
  });
  assert.equal(resolved.command,node);
  assert.deepEqual(resolved.args,[script,'exec','PROMPT & must stay an argv value']);
  assert.equal(resolved.source,'npm-cmd-shim');
});

test('native Windows CLI executable stays direct',()=>{
  const exe='C:\\Tools\\opencode.exe';
  const fs=fakeFs([exe]);
  const result=resolveKnownCommand('opencode',['--version'],{
    platform:'win32',
    env:{},
    execPath:'C:\\AECP\\AECP.exe',
    exists:fs.exists,
    read:fs.read,
    where:(name)=>name==='opencode'?[exe]:[]
  });
  assert.equal(result.command,exe);
  assert.deepEqual(result.args,['--version']);
  assert.equal(result.source,'native');
});

test('arbitrary registered local command is never reinterpreted as npm shim',()=>{
  const input='C:\\Company\\worker.cmd';
  const result=resolveKnownCommand(input,['TASK & not shell syntax'],{
    platform:'win32',
    env:{},
    execPath:'C:\\AECP\\AECP.exe',
    exists:()=>true,
    read:()=>{throw new Error('must not inspect arbitrary command');},
    where:()=>{throw new Error('must not search arbitrary command');}
  });
  assert.equal(result.command,input);
  assert.deepEqual(result.args,['TASK & not shell syntax']);
  assert.equal(result.source,'direct');
});

test('resolver fails closed instead of enabling shell when a known shim cannot be resolved',()=>{
  const result=resolveKnownCommand('claude',['hello'],{
    platform:'win32',
    env:{},
    execPath:'C:\\AECP\\AECP.exe',
    exists:()=>false,
    read:()=>{throw new Error('missing');},
    where:()=>[]
  });
  assert.equal(result.command,'claude');
  assert.deepEqual(result.args,['hello']);
  assert.equal(result.source,'unresolved');
});

test('node executable resolution prefers explicit npm node path',()=>{
  const node='C:\\Node\\node.exe';
  const fs=fakeFs([node]);
  assert.equal(resolveNodeExecutable({
    env:{npm_node_execpath:node},
    execPath:'C:\\AECP\\AECP.exe',
    exists:fs.exists,
    where:()=>[]
  }),node);
});
