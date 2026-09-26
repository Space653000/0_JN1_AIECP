'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const SCHEMA='aecp.backup/v1';
const DEFAULT_MAX_BYTES=64*1024*1024;
const DEFAULT_MAX_FILES=5000;
const ALLOWED_TOP=new Set(['state.json','runtime','evidence','autonomy','harness']);
const NEVER_BACKUP=new Set(['credentials.json']);
const ATOMIC_TEMP=/\.tmp(?:-\d+-[0-9a-f]+)?$/;

function sha256(buffer){return crypto.createHash('sha256').update(buffer).digest('hex')}

function safeRelative(value){
 const rel=String(value||'').replaceAll('\\','/');
 if(!rel||rel.startsWith('/')||rel.includes('\0'))throw new Error('Backup path is invalid.');
 const normalized=path.posix.normalize(rel);
 if(normalized==='..'||normalized.startsWith('../')||path.posix.isAbsolute(normalized))throw new Error('Backup path escapes the AECP data root.');
 const top=normalized.split('/')[0];
 if(!ALLOWED_TOP.has(top)||NEVER_BACKUP.has(top))throw new Error('Backup contains a disallowed path.');
 return normalized;
}

async function collectFiles(root,{maxBytes=DEFAULT_MAX_BYTES,maxFiles=DEFAULT_MAX_FILES}={}){
 const files=[];let bytes=0;
 async function walk(relative){
  const absolute=path.join(root,...relative.split('/').filter(Boolean));
  let entries;
  try{entries=await fs.readdir(absolute,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e}
  for(const entry of entries){
   const rel=safeRelative(relative?relative+'/'+entry.name:entry.name);
   if(NEVER_BACKUP.has(rel))continue;
   if(entry.isSymbolicLink())continue;
   if(entry.isDirectory()){await walk(rel);continue}
   if(!entry.isFile())continue;
   // Atomic writes leave a temp file that is renamed away a moment later; it is never committed state.
   if(ATOMIC_TEMP.test(entry.name))continue;
   let data;
   try{data=await fs.readFile(path.join(root,...rel.split('/')))}catch(e){if(e.code==='ENOENT')continue;throw e}
   bytes+=data.length;
   if(bytes>maxBytes)throw new Error('Backup exceeds the configured byte limit.');
   files.push({path:rel,size:data.length,sha256:sha256(data),data:data.toString('base64')});
   if(files.length>maxFiles)throw new Error('Backup exceeds the configured file-count limit.');
  }
 }
 for(const item of ALLOWED_TOP){
  if(item.includes('.')){
   try{
    const data=await fs.readFile(path.join(root,item));
    bytes+=data.length;
    files.push({path:item,size:data.length,sha256:sha256(data),data:data.toString('base64')});
   }catch(e){if(e.code!=='ENOENT')throw e}
  }else await walk(item);
 }
 return {files,bytes};
}

async function createBackup(root,{appVersion='unknown'}={}){
 const collected=await collectFiles(path.resolve(root));
 return {
  schema:SCHEMA,
  createdAt:new Date().toISOString(),
  appVersion:String(appVersion),
  excludes:['credentials.json','symlinks'],
  fileCount:collected.files.length,
  totalBytes:collected.bytes,
  files:collected.files
 };
}

function validateBackup(backup,{maxBytes=DEFAULT_MAX_BYTES,maxFiles=DEFAULT_MAX_FILES}={}){
 if(!backup||backup.schema!==SCHEMA||!Array.isArray(backup.files))throw new Error('Unsupported AECP backup schema.');
 if(backup.files.length>maxFiles)throw new Error('Backup file count exceeds the restore limit.');
 let bytes=0;const seen=new Set();
 const files=backup.files.map(item=>{
  const rel=safeRelative(item?.path);
  if(seen.has(rel))throw new Error('Backup contains duplicate paths.');
  seen.add(rel);
  const data=Buffer.from(String(item?.data||''),'base64');
  bytes+=data.length;
  if(bytes>maxBytes)throw new Error('Backup exceeds the restore byte limit.');
  if(Number(item?.size)!==data.length)throw new Error('Backup file size mismatch.');
  if(String(item?.sha256||'').toLowerCase()!==sha256(data))throw new Error('Backup file SHA-256 mismatch.');
  return {path:rel,data,sha256:sha256(data)};
 });
 return {schema:SCHEMA,files,totalBytes:bytes,appVersion:String(backup.appVersion||'unknown')};
}

async function writeBackup(root,destination,options={}){
 const backup=await createBackup(root,options);
 await fs.mkdir(path.dirname(path.resolve(destination)),{recursive:true});
 await fs.writeFile(destination,JSON.stringify(backup),'utf8');
 return {path:path.resolve(destination),fileCount:backup.fileCount,totalBytes:backup.totalBytes,createdAt:backup.createdAt};
}

async function stageRestore(root,backupFile){
 const base=path.resolve(root);
 const parsed=JSON.parse(await fs.readFile(backupFile,'utf8'));
 const valid=validateBackup(parsed);
 const id='restore-'+Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');
 const stage=path.join(base,'restore-staging',id);
 await fs.rm(stage,{recursive:true,force:true});
 for(const item of valid.files){
  const target=path.join(stage,...item.path.split('/'));
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,item.data);
 }
 const request={schema:'aecp.restore-request/v1',id,stage,requestedAt:new Date().toISOString(),source:path.resolve(backupFile),fileCount:valid.files.length,totalBytes:valid.totalBytes};
 await fs.writeFile(path.join(base,'restore-request.json'),JSON.stringify(request,null,2),'utf8');
 return request;
}

async function applyPendingRestore(root){
 const base=path.resolve(root);
 const requestFile=path.join(base,'restore-request.json');
 let request;
 try{request=JSON.parse(await fs.readFile(requestFile,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}
 const stage=path.resolve(String(request.stage||''));
 const stagingRoot=path.resolve(base,'restore-staging');
 if(!(stage===stagingRoot||stage.startsWith(stagingRoot+path.sep)))throw new Error('Restore staging path is outside the AECP data root.');
 const backupDir=path.join(base,'pre-restore',String(request.id||Date.now()));
 await fs.mkdir(backupDir,{recursive:true});
 for(const top of ALLOWED_TOP){
  const current=path.join(base,top);
  try{await fs.cp(current,path.join(backupDir,top),{recursive:true,errorOnExist:false,force:true})}catch(e){if(e.code!=='ENOENT')throw e}
 }
 for(const top of ALLOWED_TOP){
  const staged=path.join(stage,top);
  try{
   await fs.access(staged);
   await fs.rm(path.join(base,top),{recursive:true,force:true});
   await fs.cp(staged,path.join(base,top),{recursive:true,force:true});
  }catch(e){if(e.code!=='ENOENT')throw e}
 }
 await fs.rm(requestFile,{force:true});
 await fs.rm(stage,{recursive:true,force:true});
 return {...request,appliedAt:new Date().toISOString(),preRestoreBackup:backupDir};
}

module.exports={SCHEMA,ALLOWED_TOP,NEVER_BACKUP,safeRelative,createBackup,validateBackup,writeBackup,stageRestore,applyPendingRestore};
