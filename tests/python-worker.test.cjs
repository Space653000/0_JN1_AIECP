'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {PythonWorker,pythonSyntaxScript}=require('../electron/lib/python-worker.cjs');

test('Python worker script performs AST parsing rather than executing project code',()=>{
  const script=pythonSyntaxScript();
  assert.match(script,/ast\.parse/);
  assert.doesNotMatch(script,/exec\(/);
  assert.doesNotMatch(script,/subprocess/);
  assert.doesNotMatch(script,/socket/);
});

test('Python worker reports syntax evidence in a temporary Workspace', {skip:spawnSync('python',['--version'],{encoding:'utf8'}).status!==0}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-python-worker-'));
  try{
    await fs.writeFile(path.join(root,'good.py'),'value = 42\n','utf8');
    const worker=new PythonWorker();
    const good=await worker.syntaxScan(root);
    assert.equal(good.ok,true);
    assert.ok(good.files.includes('good.py'));

    await fs.writeFile(path.join(root,'bad.py'),'def broken(:\n    pass\n','utf8');
    const bad=await worker.syntaxScan(root);
    assert.equal(bad.ok,false);
    assert.ok(bad.errors.some((item)=>item.file==='bad.py'));
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
