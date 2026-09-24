'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const nodeModules=path.join(root,'node_modules');
const output=path.join(root,'artifacts','license-audit.json');

const PROHIBITED=[
  {id:'AGPL',re:/\bAGPL(?:-|\b)/i},
  {id:'SSPL',re:/\bSSPL(?:-|\b)/i},
  {id:'BUSL',re:/\bBUSL(?:-|\b)/i},
  {id:'COMMONS_CLAUSE',re:/commons\s+clause/i}
];

function licenseText(pkg){
  if(typeof pkg?.license==='string')return pkg.license.trim();
  if(pkg?.license&&typeof pkg.license.type==='string')return pkg.license.type.trim();
  if(Array.isArray(pkg?.licenses))return pkg.licenses.map(x=>typeof x==='string'?x:x?.type).filter(Boolean).join(' OR ');
  return '';
}

function packageDirs(modulesDir){
  let entries=[];
  try{entries=fs.readdirSync(modulesDir,{withFileTypes:true})}catch{return[]}
  const dirs=[];
  for(const entry of entries){
    if(!entry.isDirectory()||entry.name==='.bin')continue;
    const absolute=path.join(modulesDir,entry.name);
    if(entry.name.startsWith('@')){
      let scoped=[];
      try{scoped=fs.readdirSync(absolute,{withFileTypes:true})}catch{}
      for(const child of scoped)if(child.isDirectory())dirs.push(path.join(absolute,child.name));
    }else dirs.push(absolute);
  }
  return dirs;
}

function scan(){
  const queue=[nodeModules],seenModules=new Set(),packages=[],findings=[];
  while(queue.length){
    const modulesDir=queue.shift();
    let real;
    try{real=fs.realpathSync(modulesDir)}catch{continue}
    if(seenModules.has(real))continue;
    seenModules.add(real);
    for(const dir of packageDirs(modulesDir)){
      const pkgFile=path.join(dir,'package.json');
      let pkg;
      try{pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'))}catch{continue}
      const license=licenseText(pkg);
      const item={name:String(pkg.name||path.basename(dir)),version:String(pkg.version||''),license:license||null,relativePath:path.relative(root,dir).replaceAll('\\','/')};
      packages.push(item);
      if(!license)findings.push({severity:'WARN',type:'MISSING_LICENSE',...item});
      for(const rule of PROHIBITED)if(rule.re.test(license))findings.push({severity:'ERROR',type:'PROHIBITED_LICENSE',policy:rule.id,...item});
      queue.push(path.join(dir,'node_modules'));
    }
  }
  packages.sort((a,b)=>(a.name+'@'+a.version).localeCompare(b.name+'@'+b.version));
  const errors=findings.filter(x=>x.severity==='ERROR');
  const report={
    schema:'aecp.license-audit/v1',
    generatedAt:new Date().toISOString(),
    packageCount:packages.length,
    errorCount:errors.length,
    warningCount:findings.length-errors.length,
    policy:{prohibited:PROHIBITED.map(x=>x.id),missingLicense:'WARN'},
    findings,
    packages
  };
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n','utf8');
  process.stdout.write(JSON.stringify({schema:report.schema,packageCount:report.packageCount,errorCount:report.errorCount,warningCount:report.warningCount,output:'artifacts/license-audit.json'},null,2)+'\n');
  if(errors.length)process.exitCode=1;
  return report;
}

scan();
