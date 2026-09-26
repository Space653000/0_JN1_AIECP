'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {redactSensitive,redactText}=require('./redaction.cjs');
const {writeImmutable}=require('./evidence-manager.cjs');
const execFileAsync=promisify(execFile);
const BLUEPRINT_LIMIT=24*1024;
const DIFF_LIMIT=64*1024;

function sha(value){return crypto.createHash('sha256').update(value).digest('hex');}
function boundedText(value,limit){
  const bytes=Buffer.from(redactText(value));
  if(bytes.length<=limit)return {content:bytes.toString(),bytes:bytes.length,truncated:false};
  return {content:bytes.subarray(0,limit).toString('utf8')+'\n[TRUNCATED]',bytes:bytes.length,truncated:true};
}
async function safeFile(root,relative){
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))return null;
  const absolute=path.resolve(root,relative);
  const physical=await fs.realpath(absolute).catch(()=>null);
  const physicalRoot=await fs.realpath(root);
  if(!physical||!physical.startsWith(physicalRoot+path.sep)||!(await fs.stat(physical)).isFile())return null;
  return physical;
}
async function blueprintContext(root,refs=[]){
  const primary=await safeFile(root,'.ai/BLUEPRINT.md')?'.ai/BLUEPRINT.md':'Blueprint/INDEX.md';
  const names=[primary,...(Array.isArray(refs)?refs.slice(0,16):[])];
  const files=[];let remaining=BLUEPRINT_LIMIT;
  for(const name of [...new Set(names)]){
    const absolute=await safeFile(root,name);
    if(!absolute){files.push({path:name,missing:true});continue;}
    const raw=await fs.readFile(absolute,'utf8');
    const item=boundedText(raw,remaining);
    files.push({path:name,sha256:sha(raw),bytes:item.bytes,truncated:item.truncated,content:item.content});
    remaining=Math.max(0,remaining-Buffer.byteLength(item.content));
  }
  return {limitBytes:BLUEPRINT_LIMIT,files};
}
async function git(root,args){
  const {stdout}=await execFileAsync('git',args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024,timeout:30000});
  return String(stdout);
}
async function diffContext(worktree,knownUntracked=[]){
  const porcelain=await git(worktree,['status','--porcelain','-z']);
  const untrackedFiles=[...new Set([...knownUntracked,...porcelain.split('\0').filter(line=>line.startsWith('?? ')).map(line=>redactText(line.slice(3)))])];
  await git(worktree,['add','-N','.']);
  const names=(await git(worktree,['diff','--name-only','-z','HEAD'])).split('\0').filter(Boolean);
  const files=[];let remaining=DIFF_LIMIT,additions=0,deletions=0,patchBytes=0,hasBinary=false;
  for(const name of names){
    const numstat=await git(worktree,['diff','--numstat','HEAD','--',name]);
    const binary=/^-\s+-\s/.test(numstat);
    const counts=numstat.match(/^(\d+)\s+(\d+)\s/);
    if(counts){additions+=Number(counts[1]);deletions+=Number(counts[2]);}
    if(binary){
      hasBinary=true;
      const current=await fs.stat(path.join(worktree,name)).catch(()=>null);
      const oldSize=current?null:Number((await git(worktree,['cat-file','-s',`HEAD:${name}`])).trim());
      files.push({path:redactText(name),binary:true,bytes:current?.size??oldSize,content:null});continue;
    }
    const raw=await git(worktree,['diff','--no-ext-diff','--unified=3','HEAD','--',name]);
    const bytes=Buffer.byteLength(raw);
    patchBytes+=bytes;
    const excerpt=boundedText(raw,remaining);
    files.push({path:redactText(name),binary:false,bytes,truncated:excerpt.truncated||remaining===0,content:excerpt.content});
    remaining=Math.max(0,remaining-Buffer.byteLength(excerpt.content));
  }
  const omitted=files.filter(f=>f.binary||f.truncated||!f.content).map(({path,bytes,binary})=>({path,bytes,binary}));
  const currentCommit=(await git(worktree,['rev-parse','HEAD'])).trim();
  return {limitBytes:DIFF_LIMIT,changedFiles:files.map(f=>f.path),files,omitted,
    stats:{changedFiles:files.map(f=>f.path),additions,deletions,untrackedFiles,
      patchBytes:hasBinary?null:patchBytes,baseCommit:currentCommit,currentCommit}};
}
async function buildReviewInput({sourceRoot,worktree,runRoot,runId,task,plan,verification,iteration}){
  const blueprint=await blueprintContext(sourceRoot,task.blueprint_refs);
  const diff=await diffContext(worktree,task.untrackedFiles||[]);
  const input=redactSensitive({schema:'aecp.review-input/v1',taskId:task.id,runId:runId||path.basename(runRoot),iteration,
    blueprint,plan,diff,verification});
  const data=JSON.stringify(input,null,2)+'\n';
  const saved=await writeImmutable(runRoot,`review-input-${String(task.id).replace(/[^a-zA-Z0-9_-]/g,'_')}-${iteration}.json`,data);
  return {input,file:saved.file,sha256:saved.sha256};
}

module.exports={blueprintContext,diffContext,buildReviewInput,BLUEPRINT_LIMIT,DIFF_LIMIT};
