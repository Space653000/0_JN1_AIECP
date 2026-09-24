'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');
const {parseCommandCard,makeResultCapsule}=require('../electron/lib/protocol.cjs');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('B04-ELECTRON-L28 context isolation remains enabled',()=>{
  assert.match(read('electron/main.cjs'),/webPreferences:\s*\{[^}]*contextIsolation:\s*true/s);
});
test('B04-ELECTRON-L29 renderer Node integration remains disabled',()=>{
  assert.match(read('electron/main.cjs'),/webPreferences:\s*\{[^}]*nodeIntegration:\s*false/s);
});
test('B04-ELECTRON-L30 renderer sandbox remains enabled',()=>{
  assert.match(read('electron/main.cjs'),/webPreferences:\s*\{[^}]*sandbox:\s*true/s);
});
test('B04-ELECTRON-L31 remote module is not enabled',()=>{
  for(const file of ['electron/main.cjs','electron/preload.cjs'])assert.doesNotMatch(read(file),/enableRemoteModule|@electron\/remote/);
});
test('B04-ELECTRON-L32 preload exposes named IPC methods rather than generic invoke',()=>{
  const preload=read('electron/preload.cjs');
  assert.match(preload,/contextBridge\.exposeInMainWorld\('aecp'/);
  assert.doesNotMatch(preload,/\b(?:invoke|call):\s*\(/);
  assert.match(preload,/getControlPlaneStatus: \(\) => call\('control-plane:status'\)/);
});
test('B04-ELECTRON-L35 unsolicited windows are denied',()=>{
  assert.match(read('electron/main.cjs'),/setWindowOpenHandler\([\s\S]*?return \{ action: 'deny' \}/);
});
test('B04-ELECTRON-L36 external links require HTTPS before OS-browser opening',()=>{
  assert.match(read('electron/main.cjs'),/setWindowOpenHandler\(\(\{ url \}\) => \{\s*if \(\/\^https:\\\/\\\/\/i\.test\(url\)\) shell\.openExternal\(url\)/);
});
test('B04-ELECTRON-L37 remote ChatGPT origin receives no preload',()=>{
  const main=read('electron/main.cjs');
  assert.match(main,/preload: path\.join\(__dirname, 'preload\.cjs'\)/);
  assert.match(main,/await mainWindow\.loadFile\(path\.join\(__dirname, '\.\.', 'ui', 'index\.html'\)\)/);
  assert.doesNotMatch(main,/mainWindow\.loadURL\(['"]https:\/\/chatgpt\.com/);
});
test('B04-ELECTRON-L38 local UI has a restrictive Content Security Policy',()=>{
  const html=read('ui/index.html');
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/default-src 'self'/);
  assert.match(html,/connect-src 'none'/);
});
test('B04-RED-L65 deletion requires explicit approval',()=>{
  const policy=new SecurityPolicy({allowRoots:[root]});
  assert.equal(policy.check({action:'DELETE',path:root}).allowed,false);
  assert.equal(policy.check({action:'DELETE',path:root}).requiresApproval,true);
});
test('B04-RED-L67 credential use requires explicit approval',()=>{
  const policy=new SecurityPolicy({allowRoots:[root]});
  assert.equal(policy.check({action:'CREDENTIAL',path:root}).requiresApproval,true);
});
test('B04-RED-L68 outside-workspace paths remain denied even after approval',()=>{
  const policy=new SecurityPolicy({allowRoots:[root]});
  assert.equal(policy.check({action:'WRITE',path:path.dirname(root),approved:true}).allowed,false);
});
test('B04-RED-L69 system actions require explicit approval',()=>{
  const policy=new SecurityPolicy({allowRoots:[root]});
  assert.equal(policy.check({action:'SYSTEM',path:root}).requiresApproval,true);
});
test('B11-L44 Command Card requires both title and goal',()=>{
  const card={schema:'aecp.task/v1',title:'Inspect',goal:'Inspect the Workspace',action:{type:'inspect-workspace'}};
  assert.throws(()=>parseCommandCard(JSON.stringify({...card,title:''})),/title is required/);
  assert.throws(()=>parseCommandCard(JSON.stringify({...card,goal:''})),/goal is required/);
});
test('B11-8-L136 Command Card rejects input above 64 KiB',()=>{
  assert.throws(()=>parseCommandCard('x'.repeat(64*1024+1)),/too large/);
});
test('B11-8-L138 Result Capsule stays well below clipboard ceiling',()=>{
  const capsule=makeResultCapsule({taskId:'T1',status:'PASS',summary:'ok'});
  assert.equal(capsule.schema,'aecp.result/v1');
  assert.ok(Buffer.byteLength(JSON.stringify(capsule),'utf8')<32*1024);
});
