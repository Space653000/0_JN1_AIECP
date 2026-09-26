'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const NPM_STYLE_COMMANDS=new Set(['npm','npx','pnpm','yarn','codex','claude','gemini','opencode']);

function lines(value){
  return String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}

function firstExisting(candidates,exists=fs.existsSync){
  return candidates.find(item=>item&&exists(item))||null;
}

function defaultWhere(name){
  if(process.platform!=='win32')return [];
  try{
    const result=spawnSync('where.exe',[name],{windowsHide:true,shell:false,encoding:'utf8',timeout:5000});
    return result.status===0?lines(result.stdout):[];
  }catch{return [];}
}

function resolveNodeExecutable({env=process.env,execPath=process.execPath,where=defaultWhere,exists=fs.existsSync}={}){
  const explicit=firstExisting([env.npm_node_execpath],exists);
  if(explicit)return explicit;
  if(path.basename(String(execPath||'')).toLowerCase()==='node.exe'&&exists(execPath))return execPath;
  return firstExisting(where('node').filter(item=>/\.exe$/i.test(item)),exists);
}

function parseNodeCmdShim(cmdPath,{read=fs.readFileSync,exists=fs.existsSync,nodeExecutable=null}={}){
  let source='';
  try{source=read(cmdPath,'utf8');}catch{return null;}
  const shimDir=path.win32.dirname(String(cmdPath));
  const matches=[...source.matchAll(/["']?%dp0%\\([^"'\r\n]+?\.js)["']?/ig)];
  if(!matches.length)return null;
  const relative=matches.at(-1)[1];
  const script=path.win32.resolve(shimDir,relative);
  if(!exists(script))return null;
  const localNode=path.win32.join(shimDir,'node.exe');
  const node=firstExisting([localNode,nodeExecutable],exists);
  if(!node)return null;
  return {command:node,argsPrefix:[script],source:'npm-cmd-shim'};
}

// Blueprint 08 decision D12: the official Codex desktop app installs codex.exe under
// %LOCALAPPDATA%/OpenAI/Codex/bin/<hash>/. Only that fixed base and only its direct child folders are looked at;
// no shell, no wildcard, no deeper walk. The candidate must be a regular file named exactly codex.exe, neither it nor its
// folder may be a link, and its real path must still be under the base. The newest one wins.
function findOfficialCodexExe({env=process.env,readdir=fs.readdirSync,lstat=fs.lstatSync,realpath=fs.realpathSync.native||fs.realpathSync}={}){
  const local=String(env?.LOCALAPPDATA||'').trim();
  if(!local||!path.win32.isAbsolute(local))return null;
  const base=path.win32.join(local,'OpenAI','Codex','bin');
  const inside=(child,parent)=>{
    const c=path.win32.normalize(String(child)).toLowerCase();
    const p=path.win32.normalize(String(parent)).toLowerCase().replace(/[\\/]+$/,'');
    return c.startsWith(p+'\\');
  };
  let baseReal;
  let folders;
  try{baseReal=realpath(base);folders=readdir(base,{withFileTypes:true});}catch{return null;}
  let best=null;
  for(const folder of folders){
    try{
      if(!folder.isDirectory()||folder.isSymbolicLink())continue;
      const dir=path.win32.join(base,folder.name);
      const dirStat=lstat(dir);
      if(!dirStat.isDirectory()||dirStat.isSymbolicLink())continue;
      const names=readdir(dir,{withFileTypes:true});
      if(!names.some(entry=>entry.name==='codex.exe'))continue;
      const exe=path.win32.join(dir,'codex.exe');
      const info=lstat(exe);
      if(!info.isFile()||info.isSymbolicLink())continue;
      if(!inside(realpath(exe),baseReal))continue;
      if(!best||info.mtimeMs>best.mtimeMs)best={exe,mtimeMs:info.mtimeMs};
    }catch{/* an unreadable folder is simply not a candidate */}
  }
  return best?best.exe:null;
}

function resolveKnownCommand(command,args=[],options={}){
  const platform=options.platform||process.platform;
  const value=String(command||'');
  const base=path.basename(value).toLowerCase().replace(/\.(?:cmd|bat|exe|com)$/,'');
  if(platform!=='win32'||!NPM_STYLE_COMMANDS.has(base))return{command:value,args:[...args],source:'direct'};

  const exists=options.exists||fs.existsSync;
  const where=options.where||defaultWhere;
  const read=options.read||fs.readFileSync;
  const env=options.env||process.env;
  const execPath=options.execPath||process.execPath;

  // npm invoked from an npm-launched process exposes its exact CLI JS path.
  if(base==='npm'&&env.npm_execpath&&exists(env.npm_execpath)){
    const node=resolveNodeExecutable({env,execPath,where,exists});
    if(node)return{command:node,args:[env.npm_execpath,...args],source:'npm-execpath'};
  }

  const candidates=path.extname(value)?[value]:where(value);
  for(const candidate of candidates){
    if(!candidate||!exists(candidate))continue;
    if(/\.(?:exe|com)$/i.test(candidate))return{command:candidate,args:[...args],source:'native'};
  }

  const node=resolveNodeExecutable({env,execPath,where,exists});
  for(const candidate of candidates){
    if(!candidate||!exists(candidate)||!/[.]cmd$/i.test(candidate))continue;
    const parsed=parseNodeCmdShim(candidate,{read,exists,nodeExecutable:node});
    if(parsed)return{command:parsed.command,args:[...parsed.argsPrefix,...args],source:parsed.source};
  }

  // Last resort for codex only, after PATH lookup and npm shims found nothing launchable (D12).
  if(base==='codex'){
    const official=findOfficialCodexExe({env,readdir:options.readdir,lstat:options.lstat,realpath:options.realpath});
    if(official)return{command:official,args:[...args],source:'openai-codex-install'};
  }

  // Fail closed to the original command. The caller will report UNAVAILABLE/ENOENT
  // rather than widening authority through cmd.exe or shell:true.
  return{command:value,args:[...args],source:'unresolved'};
}

module.exports={NPM_STYLE_COMMANDS,findOfficialCodexExe,resolveKnownCommand,resolveNodeExecutable,parseNodeCmdShim};
