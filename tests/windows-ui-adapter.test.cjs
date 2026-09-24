'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  WindowsUiAdapter,
  validatePid,
  validateBounds,
  isBrowserProcess,
  automationTreeScript,
  dockWindowScript
}=require('../electron/lib/windows-ui-adapter.cjs');
const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');

test('Windows UI adapter validates identifiers and bounds before PowerShell execution',()=>{
  assert.equal(validatePid('123'),123);
  assert.throws(()=>validatePid('x'),/valid positive process id/);
  assert.deepEqual(validateBounds({x:0,y:0,width:800,height:600}),{x:0,y:0,width:800,height:600});
  assert.throws(()=>validateBounds({x:0,y:0,width:10,height:10}),/outside the supported range/);
  assert.match(automationTreeScript(123,25),/UIAutomationClient/);
  assert.match(dockWindowScript(123,{x:10,y:20,width:800,height:600}),/MoveWindow/);
});

test('browser automation inspection is deny-by-default',()=>{
  assert.equal(isBrowserProcess('chrome.exe'),true);
  assert.equal(isBrowserProcess('msedge'),true);
  assert.equal(isBrowserProcess('Code'),false);
});

test('window docking requires explicit SYSTEM approval before platform execution',async()=>{
  const adapter=new WindowsUiAdapter({policy:new SecurityPolicy({allowRoots:[]})});
  await assert.rejects(
    ()=>adapter.dock(123,{x:0,y:0,width:800,height:600}),
    (error)=>error?.code==='APPROVAL_REQUIRED'&&error?.policy?.action==='SYSTEM'
  );
});

test('Windows runner can execute the read-only top-level window enumeration', {skip:process.platform!=='win32'}, async()=>{
  const adapter=new WindowsUiAdapter();
  const windows=await adapter.listWindows({timeoutMs:10000});
  assert.ok(Array.isArray(windows));
  for(const item of windows){
    assert.equal(typeof item.pid,'number');
    assert.equal(typeof item.processName,'string');
  }
});
