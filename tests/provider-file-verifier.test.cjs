'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {codexEditSmoke}=require('../scripts/provider-environment-verify.cjs');

for(const [name,content,shouldPass] of [
  ['correct file','AECP_TEST_TOKEN',true],
  ['missing file',null,false],
  ['wrong file','OTHER_TOKEN',false]
]){
  test(`independent file verifier rejects worker claim with ${name}`,async()=>{
    const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-file-verifier-test-'));
    try{
      const router={
        health:async()=>({status:'READY',codexHome:path.join(cwd,'home')}),
        execute:async()=>{
          if(content!==null)await fs.writeFile(path.join(cwd,'worker_result.txt'),content);
          return {code:0,stdout:'worker says success',workerId:'codex-official',codexHome:path.join(cwd,'home')};
        }
      };
      const result=codexEditSmoke(router,{provider:'openai-official',model:'fixed',workerId:'codex-official',cwd,token:'AECP_TEST_TOKEN'});
      if(shouldPass){
        const evidence=await result;
        assert.equal(evidence.fileVerifier.expectedSha256Match,true);
        assert.equal(evidence.fileVerifier.path,'worker_result.txt');
      }else await assert.rejects(result);
    }finally{await fs.rm(cwd,{recursive:true,force:true});}
  });
}

test('fixed local worker produces independently verified evidence in a temporary worktree',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-fixed-worker-test-'));
  try{
    const worker=path.join(root,'worker.cjs');
    const output=path.join(root,'evidence.json');
    await fs.writeFile(worker,"require('node:fs').writeFileSync('worker_result.txt','AECP_LOCAL_COMMAND_REAL_SMOKE_OK');\n");
    const result=spawnSync(process.execPath,[path.join(__dirname,'..','scripts','provider-environment-verify.cjs')],{
      cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:30000,
      env:{...process.env,AECP_PROVIDER_VERIFY_MODE:'local-command',AECP_PROVIDER_VERIFY_LOCAL_COMMAND:'node',
        AECP_PROVIDER_VERIFY_LOCAL_ARGS_JSON:JSON.stringify([worker]),AECP_PROVIDER_EVIDENCE_PATH:output}
    });
    assert.equal(result.status,0,`${result.stderr}\n${await fs.readFile(output,'utf8')}`);
    const evidence=JSON.parse(await fs.readFile(output,'utf8'));
    const check=evidence.checks.find(item=>item.id==='local-command.real-smoke');
    assert.equal(check.status,'PASS');
    assert.equal(check.fileVerifier.expectedSha256Match,true);
    assert.equal(check.fileVerifier.path,'worker_result.txt');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
