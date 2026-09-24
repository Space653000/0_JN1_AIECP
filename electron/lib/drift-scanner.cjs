'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

const DEFAULT_FILES=[
 'README.md',
 'Blueprint/00_MASTER_BLUEPRINT.md',
 'Blueprint/23_IMPLEMENTATION_STATUS.md',
 'package.json'
];

async function exists(p){try{await fs.access(p);return true}catch{return false}}

async function scan(root,{requiredFiles=DEFAULT_FILES}={}){
 const findings=[];
 for(const rel of requiredFiles){
  if(!(await exists(path.join(root,rel)))) findings.push({severity:'ERROR',type:'MISSING_REQUIRED_FILE',path:rel});
 }
 const blueprint=await read(path.join(root,'Blueprint/00_MASTER_BLUEPRINT.md'));
 const status=await read(path.join(root,'Blueprint/23_IMPLEMENTATION_STATUS.md'));
 const readme=await read(path.join(root,'README.md'));
 if(blueprint && status && /production-complete|production ready/i.test(blueprint+status) && /not.*production/i.test(status)) findings.push({severity:'WARN',type:'MATURITY_DOCUMENTATION_CONFLICT',message:'Blueprint/status contain conflicting production-readiness language.'});
 if(readme && status && !/23_IMPLEMENTATION_STATUS/i.test(readme)) findings.push({severity:'WARN',type:'README_STATUS_LINK_MISSING',message:'README should point users to the authoritative implementation status.'});
 return {ok:!findings.some(x=>x.severity==='ERROR'),findings,scannedAt:new Date().toISOString()};
}
async function read(p){try{return await fs.readFile(p,'utf8')}catch{return null}}
module.exports={scan};
