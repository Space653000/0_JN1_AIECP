'use strict';

const { spawn } = require('node:child_process');

const BROWSER_PROCESSES = new Set(['chrome','msedge','firefox','brave','opera','vivaldi']);
const MAX_OUTPUT = 1024 * 1024;

function encodePowerShell(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

function validatePid(value) {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) throw new Error('A valid positive process id is required.');
  return pid;
}

function validateBounds(input = {}) {
  const out = {};
  for (const key of ['x','y','width','height']) {
    const value = Number(input[key]);
    if (!Number.isInteger(value)) throw new Error(`Window bound ${key} must be an integer.`);
    out[key] = value;
  }
  if (out.width < 200 || out.height < 120 || out.width > 16384 || out.height > 16384) throw new Error('Window bounds are outside the supported range.');
  return out;
}

function isBrowserProcess(name) {
  return BROWSER_PROCESSES.has(String(name || '').trim().toLowerCase().replace(/\.exe$/i,''));
}

function runPowerShell(script, { timeoutMs = 15000, signal } = {}) {
  if (process.platform !== 'win32') throw new Error('Windows UI adapter is available only on Windows.');
  const encoded = encodePowerShell(script);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore','pipe','pipe']
    });
    let stdout='',stderr='',done=false,timedOut=false,aborted=false;
    const append=(current,chunk)=>(current+chunk.toString()).slice(-MAX_OUTPUT);
    const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);if(signal)signal.removeEventListener('abort',abort);fn(value)};
    const timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},Math.max(1000,timeoutMs));
    const abort=()=>{aborted=true;try{child.kill()}catch{}};
    if(signal)signal.aborted?abort():signal.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',b=>{stdout=append(stdout,b)});
    child.stderr.on('data',b=>{stderr=append(stderr,b)});
    child.on('error',e=>finish(reject,e));
    child.on('close',code=>finish(resolve,{code:Number.isInteger(code)?code:-1,stdout,stderr,timedOut,aborted}));
  });
}

function listWindowsScript() {
  return [
    "$ErrorActionPreference='Stop'",
    "$items = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {",
    "  [pscustomobject]@{ pid=$_.Id; processName=$_.ProcessName; title=$_.MainWindowTitle; hwnd=[int64]$_.MainWindowHandle }",
    "}",
    "$items | ConvertTo-Json -Compress"
  ].join('; ');
}

function automationTreeScript(pid, maxNodes = 120) {
  pid = validatePid(pid);
  maxNodes = Math.max(1, Math.min(500, Number(maxNodes) || 120));
  return [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    `$pidTarget=${pid}`,
    "$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$pidTarget)",
    "$root = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)",
    "if ($null -eq $root) { throw 'Automation root not found for process.' }",
    "$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
    `$limit=[Math]::Min($all.Count,${maxNodes})`,
    "$items = for($i=0;$i -lt $limit;$i++){ $e=$all.Item($i); [pscustomobject]@{ name=$e.Current.Name; automationId=$e.Current.AutomationId; controlType=$e.Current.ControlType.ProgrammaticName; enabled=$e.Current.IsEnabled } }",
    "$items | ConvertTo-Json -Compress"
  ].join('; ');
}

function dockWindowScript(pid, bounds) {
  pid = validatePid(pid);
  const b = validateBounds(bounds);
  return [
    "$ErrorActionPreference='Stop'",
    "Add-Type @'",
    "using System; using System.Runtime.InteropServices;",
    "public static class AECPWindowNative { [DllImport(\"user32.dll\", SetLastError=true)] public static extern bool MoveWindow(IntPtr hWnd,int X,int Y,int nWidth,int nHeight,bool bRepaint); }",
    "'@",
    `$p=Get-Process -Id ${pid} -ErrorAction Stop`,
    "if ($p.MainWindowHandle -eq 0) { throw 'Target process does not expose a top-level window.' }",
    `if(-not [AECPWindowNative]::MoveWindow($p.MainWindowHandle,${b.x},${b.y},${b.width},${b.height},$true)){throw 'MoveWindow failed.'}`,
    "[pscustomobject]@{ok=$true;pid=$p.Id;processName=$p.ProcessName} | ConvertTo-Json -Compress"
  ].join('; ');
}

function parseJsonOutput(stdout) {
  const text=String(stdout||'').trim();
  if(!text)return [];
  return JSON.parse(text);
}

class WindowsUiAdapter {
  constructor({policy=null}={}){ this.policy=policy; }

  async listWindows(options={}) {
    const result=await runPowerShell(listWindowsScript(),options);
    if(result.code!==0||result.timedOut||result.aborted)throw new Error(String(result.stderr||'Window enumeration failed.').slice(-2000));
    const parsed=parseJsonOutput(result.stdout);
    return (Array.isArray(parsed)?parsed:[parsed]).filter(Boolean).map(x=>({...x,browser:isBrowserProcess(x.processName)}));
  }

  async inspect(pid,{maxNodes=120,allowBrowser=false,...options}={}) {
    const windows=await this.listWindows(options);
    const target=windows.find(x=>x.pid===validatePid(pid));
    if(!target)throw new Error('Target top-level window was not found.');
    if(target.browser&&!allowBrowser)throw new Error('Browser automation-tree inspection is disabled by default. AECP never inspects ChatGPT/browser DOM through this adapter.');
    const result=await runPowerShell(automationTreeScript(pid,maxNodes),options);
    if(result.code!==0||result.timedOut||result.aborted)throw new Error(String(result.stderr||'UI Automation inspection failed.').slice(-2000));
    const parsed=parseJsonOutput(result.stdout);
    return {target,nodes:(Array.isArray(parsed)?parsed:[parsed]).filter(Boolean)};
  }

  async dock(pid,bounds,{approved=false,...options}={}) {
    if(this.policy?.assert)this.policy.assert({action:'SYSTEM',approved});
    const result=await runPowerShell(dockWindowScript(pid,bounds),options);
    if(result.code!==0||result.timedOut||result.aborted)throw new Error(String(result.stderr||'Window docking failed.').slice(-2000));
    return parseJsonOutput(result.stdout);
  }
}

module.exports={WindowsUiAdapter,BROWSER_PROCESSES,encodePowerShell,validatePid,validateBounds,isBrowserProcess,listWindowsScript,automationTreeScript,dockWindowScript,parseJsonOutput};
