'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const ALLOWED_BROWSERS = Object.freeze(['msedge','chrome','firefox','brave','opera']);

function ensureWindows(platform=process.platform){
  if(platform!=='win32') throw new Error('Windows desktop adapter is available only on Windows.');
}

function normalizeSide(side){
  const value=String(side||'right').toLowerCase();
  if(!['left','right'].includes(value)) throw new Error('Dock side must be left or right.');
  return value;
}

function normalizePid(pid){
  const value=Number(pid);
  if(!Number.isInteger(value)||value<=0||value>0x7fffffff) throw new Error('A valid browser process ID is required.');
  return value;
}

function listScript(){
  const allowed=ALLOWED_BROWSERS.map(x=>"'"+x+"'").join(',');
  return [
    "$ErrorActionPreference='Stop'",
    `$allowed=@(${allowed})`,
    "$items=Get-Process | Where-Object { $allowed -contains $_.ProcessName.ToLowerInvariant() -and $_.MainWindowHandle -ne 0 } | ForEach-Object { [pscustomobject]@{ process=$_.ProcessName; pid=$_.Id; handle=$_.MainWindowHandle.ToInt64() } }",
    "if($items){$items|ConvertTo-Json -Compress}else{'[]'}"
  ].join(';');
}

function dockScript(pid,side){
  const safePid=normalizePid(pid);
  const safeSide=normalizeSide(side);
  const allowed=ALLOWED_BROWSERS.map(x=>"'"+x+"'").join(',');
  return [
    "$ErrorActionPreference='Stop'",
    `$allowed=@(${allowed})`,
    `$p=Get-Process -Id ${safePid} -ErrorAction Stop`,
    "if(-not ($allowed -contains $p.ProcessName.ToLowerInvariant())){throw 'Process is not an allowlisted browser.'}",
    "if($p.MainWindowHandle -eq 0){throw 'Browser has no main window.'}",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class AECPUser32 { [DllImport(\"user32.dll\")] public static extern bool MoveWindow(IntPtr hWnd,int X,int Y,int nWidth,int nHeight,bool bRepaint); [DllImport(\"user32.dll\")] public static extern int GetSystemMetrics(int nIndex); }'",
    "$w=[AECPUser32]::GetSystemMetrics(0);$h=[AECPUser32]::GetSystemMetrics(1);$half=[int]($w/2)",
    `$x=if('${safeSide}' -eq 'left'){0}else{$half}`,
    "if(-not [AECPUser32]::MoveWindow($p.MainWindowHandle,$x,0,$half,$h,$true)){throw 'MoveWindow failed.'}",
    `[pscustomobject]@{ok=$true;process=$p.ProcessName;pid=$p.Id;side='${safeSide}';x=$x;y=0;width=$half;height=$h}|ConvertTo-Json -Compress`
  ].join(';');
}

async function runPowerShell(script,{timeoutMs=10000}={}){
  ensureWindows();
  const executable=process.env.ComSpec? 'powershell.exe':'powershell.exe';
  const {stdout,stderr}=await execFileAsync(executable,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{
    windowsHide:true,
    timeout:Math.max(1000,timeoutMs),
    maxBuffer:1024*1024
  });
  if(stderr&&String(stderr).trim()) throw new Error(String(stderr).trim().slice(-2000));
  return String(stdout||'').trim();
}

function parseJson(text,fallback){
  if(!text) return fallback;
  const parsed=JSON.parse(text);
  return parsed;
}

class WindowsDesktopAdapter{
  async listBrowserWindows(){
    const parsed=parseJson(await runPowerShell(listScript()),[]);
    const items=Array.isArray(parsed)?parsed:[parsed];
    return items.filter(Boolean).map(item=>({
      process:String(item.process||''),
      pid:Number(item.pid),
      handle:Number(item.handle)
    })).filter(item=>ALLOWED_BROWSERS.includes(item.process.toLowerCase())&&Number.isInteger(item.pid)&&item.pid>0&&Number.isFinite(item.handle));
  }

  async dockBrowserWindow({pid,side='right'}={}){
    const parsed=parseJson(await runPowerShell(dockScript(pid,side)),null);
    if(!parsed?.ok) throw new Error('Browser docking did not return success evidence.');
    return parsed;
  }
}

module.exports={WindowsDesktopAdapter,ALLOWED_BROWSERS,ensureWindows,normalizeSide,normalizePid,listScript,dockScript,runPowerShell};
