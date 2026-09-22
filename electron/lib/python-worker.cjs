'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const MAX_OUTPUT = 2 * 1024 * 1024;

function normalizeRoot(root) {
  if (!root) throw new Error('Python worker requires a Workspace root.');
  return path.resolve(String(root));
}

function pythonSyntaxScript() {
  return [
    "import ast,json,pathlib,sys",
    "root=pathlib.Path(sys.argv[1]).resolve()",
    "skip={'.git','node_modules','.venv','venv','dist','build','release'}",
    "files=[]",
    "errors=[]",
    "for p in root.rglob('*.py'):",
    "    if any(part in skip for part in p.parts): continue",
    "    files.append(str(p.relative_to(root)))",
    "    try:",
    "        ast.parse(p.read_text(encoding='utf-8'), filename=str(p))",
    "    except Exception as e:",
    "        errors.append({'file':str(p.relative_to(root)),'error':str(e)})",
    "print(json.dumps({'ok':not errors,'files':files,'errors':errors},ensure_ascii=False))",
    "sys.exit(0 if not errors else 2)"
  ].join('\n');
}

function runPython(command,args,{cwd,timeoutMs=30000,signal}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    let stdout='',stderr='',bytes=0,done=false,timedOut=false,aborted=false;
    const append=(current,chunk)=>{const text=chunk.toString();bytes+=Buffer.byteLength(text);if(bytes>MAX_OUTPUT){try{child.kill()}catch{};return current}return current+text};
    const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);if(signal)signal.removeEventListener('abort',abort);fn(value)};
    const timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},Math.max(1000,timeoutMs));
    const abort=()=>{aborted=true;try{child.kill()}catch{}};
    if(signal)signal.aborted?abort():signal.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',b=>stdout=append(stdout,b));
    child.stderr.on('data',b=>stderr=append(stderr,b));
    child.on('error',e=>finish(reject,e));
    child.on('close',code=>finish(resolve,{code:Number.isInteger(code)?code:-1,stdout,stderr,timedOut,aborted,outputLimitExceeded:bytes>MAX_OUTPUT}));
  });
}

class PythonWorker {
  constructor({command='python'}={}){ this.command=command; }

  async syntaxScan(workspaceRoot,{timeoutMs=30000,signal}={}) {
    const root=normalizeRoot(workspaceRoot);
    const result=await runPython(this.command,['-I','-B','-c',pythonSyntaxScript(),root],{cwd:root,timeoutMs,signal});
    let report=null;
    try{report=JSON.parse(String(result.stdout||'').trim())}catch{}
    if(!report)throw new Error(String(result.stderr||'Python worker returned invalid evidence.').slice(-2000));
    return {...report,code:result.code,timedOut:result.timedOut,aborted:result.aborted};
  }
}

module.exports={PythonWorker,normalizeRoot,pythonSyntaxScript,runPython};
