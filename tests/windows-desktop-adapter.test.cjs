'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  WindowsDesktopAdapter,
  ALLOWED_BROWSERS,
  normalizePid,
  normalizeSide,
  listScript,
  dockScript
}=require('../electron/lib/windows-desktop-adapter.cjs');

test('desktop adapter accepts only allowlisted browser process IDs and fixed dock sides',()=>{
 assert.equal(normalizePid(1234),1234);
 assert.equal(normalizeSide('left'),'left');
 assert.equal(normalizeSide('RIGHT'),'right');
 assert.throws(()=>normalizePid('not-a-pid'),/valid browser process ID/);
 assert.throws(()=>normalizeSide('center'),/left or right/);
 const list=listScript();
 assert.match(list,/MainWindowHandle/);
 for(const name of ALLOWED_BROWSERS) assert.match(list,new RegExp(name));
 assert.doesNotMatch(list,/MainWindowTitle/);
 const dock=dockScript(1234,'right');
 assert.match(dock,/Get-Process -Id 1234/);
 assert.match(dock,/MoveWindow/);
 assert.doesNotMatch(dock,/Invoke-Expression|iex\b/i);
});

test('Windows desktop adapter enumerates browser windows without reading DOM or titles', { skip: process.platform!=='win32' }, async()=>{
 const windows=await new WindowsDesktopAdapter().listBrowserWindows();
 assert.ok(Array.isArray(windows));
 for(const item of windows){
  assert.ok(ALLOWED_BROWSERS.includes(item.process.toLowerCase()));
  assert.ok(Number.isInteger(item.pid)&&item.pid>0);
  assert.equal(Object.hasOwn(item,'title'),false);
 }
});
