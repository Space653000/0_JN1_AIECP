'use strict';

const fs=require('node:fs');
const path=require('node:path');

function looksWindowsPath(value){
  const text=String(value||'');
  return /^[A-Za-z]:[\\/]/.test(text)||/^\\\\/.test(text)||/^\/\//.test(text);
}

function pathApiFor(...values){
  return values.some(looksWindowsPath)?path.win32:path;
}

// Resolves symlinks, junctions and 8.3 short names of the nearest existing ancestor, then re-appends the folders that do not
// exist yet, so a path is judged by where it really is. A path that cannot be resolved at all is returned unchanged.
function realish(resolved){
  const rest=[];
  let probe=resolved;
  for(;;){
    try{
      const real=fs.realpathSync.native(probe);
      return rest.length?path.join(real,...rest.reverse()):real;
    }catch{
      const parent=path.dirname(probe);
      if(parent===probe)return resolved;
      rest.push(path.basename(probe));
      probe=parent;
    }
  }
}

// Windows-style strings on a non-Windows host (and the reverse) are compared textually: they cannot be resolved on this disk.
function canonicalWith(api,value){
  const resolved=api.resolve(String(value||''));
  const real=api===path?realish(resolved):resolved;
  return (api===path.win32||process.platform==='win32')?real.toLowerCase():real;
}

function canonicalForCompare(value){
  return canonicalWith(pathApiFor(value),value);
}

function isNetworkPath(value){
  const text=String(value||'');
  return /^\\\\[^\\]+\\[^\\]+/.test(text)||/^\/\/[^/]+\/[^/]+/.test(text);
}

function isWithinRoot(root,candidate){
  const api=pathApiFor(root,candidate);
  const base=canonicalWith(api,root);
  const target=canonicalWith(api,candidate);
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
