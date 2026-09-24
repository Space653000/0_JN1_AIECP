'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {
  WindowsUiAdapter,
  runPowerShell,
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

test('PowerShell JSON retains CJK and emoji across split UTF-8 chunks',async()=>{
  let invoked='';
  const fakeSpawn=(_executable,args)=>{
    invoked=Buffer.from(args.at(-1),'base64').toString('utf16le');
    const child=new EventEmitter();
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    queueMicrotask(()=>{
      const data=Buffer.from('{"title":"繁體中文 日本語 한글 😀"}','utf8');
      const split=data.indexOf(Buffer.from('😀','utf8'))+2;
      child.stdout.write(data.subarray(0,split));child.stdout.end(data.subarray(split));
      child.stderr.end();child.emit('close',0);
    });
    return child;
  };
  const result=await runPowerShell("'read-only'",{spawnImpl:fakeSpawn});
  assert.equal(JSON.parse(result.stdout).title,'繁體中文 日本語 한글 😀');
  assert.match(invoked,/\[Console\]::OutputEncoding=\[Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(invoked,/\$OutputEncoding=\[Text\.UTF8Encoding\]::new\(\$false\)/);
});

test('Windows PowerShell emits CJK and emoji JSON in UTF-8 under the active code page', {skip:process.platform!=='win32'},async()=>{
  const result=await runPowerShell("[pscustomobject]@{title='繁體中文 日本語 한글 😀'} | ConvertTo-Json -Compress");
  assert.equal(JSON.parse(result.stdout).title,'繁體中文 日本語 한글 😀');
});
