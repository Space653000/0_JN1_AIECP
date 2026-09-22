'use strict';

const path=require('node:path');

function looksWindowsPath(value){
  const text=String(value||'');
  return /^[A-Za-z]:[\\/]/.test(text)||/^\\\\/.test(text)||/^\/\//.test(text);
}

function pathApiFor(...values){
  return values.some(looksWindowsPath)?path.win32:path;
}

function canonicalForCompare(value){
  const api=pathApiFor(value);
  const resolved=api.resolve(String(value||''));
  return (api===path.win32||process.platform==='win32')?resolved.toLowerCase():resolved;
}

function isNetworkPath(value){
  const text=String(value||'');
  return /^\\\\[^\\]+\\[^\\]+/.test(text)||/^\/\/[^/]+\/[^/]+/.test(text);
}

function isWithinRoot(root,candidate){
  const api=pathApiFor(root,candidate);
  const base=(api===path.win32||process.platform==='win32')?api.resolve(String(root||'')).toLowerCase():api.resolve(String(root||''));
  const target=(api===path.win32||process.platform==='win32')?api.resolve(String(candidate||'')).toLowerCase():api.resolve(String(candidate||''));
  if(base===target)return true;
  const relative=api.relative(base,target);
  return relative!==''&&!relative.startsWith('..')&&!api.isAbsolute(relative);
}

function assertWithinRoot(root,candidate){
  if(!isWithinRoot(root,candidate))throw new Error('Requested path is outside the active Workspace.');
  const api=pathApiFor(root,candidate);
  return api.resolve(String(candidate||''));
}

module.exports={looksWindowsPath,pathApiFor,canonicalForCompare,isNetworkPath,isWithinRoot,assertWithinRoot};
