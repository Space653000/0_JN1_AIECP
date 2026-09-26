'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {isWithinRoot}=require('./path-safety.cjs');
const {discoverRepoKnowledge}=require('./repo-knowledge.cjs');

const DEFAULT_FILES=[
 'README.md',
 'Blueprint/00_MASTER_BLUEPRINT.md',
 'Blueprint/23_IMPLEMENTATION_STATUS.md',
 'package.json'
];

async function safePath(root,relative){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))return null;
 const candidate=path.resolve(root,relative);
 const base=await fs.realpath(root).catch(()=>null);
 const real=await fs.realpath(candidate).catch(()=>null);
 return base&&real&&isWithinRoot(base,real)?real:null;
}
async function read(root,relative){const file=await safePath(root,relative);try{return file?await fs.readFile(file,'utf8'):null}catch{return null}}

async function scan(root,{requiredFiles=DEFAULT_FILES}={}){
 const findings=[];
 for(const rel of requiredFiles){
  if(!(await safePath(root,rel))) findings.push({severity:'ERROR',type:'MISSING_REQUIRED_FILE',path:rel});
 }
 const blueprint=await read(root,'Blueprint/00_MASTER_BLUEPRINT.md');
 const status=await read(root,'Blueprint/23_IMPLEMENTATION_STATUS.md');
 const readme=await read(root,'README.md');
 if(blueprint && status && /production-complete|production ready/i.test(blueprint+status) && /not.*production/i.test(status)) findings.push({severity:'WARN',type:'MATURITY_DOCUMENTATION_CONFLICT',message:'Blueprint/status contain conflicting production-readiness language.'});
 if(readme && status && !/23_IMPLEMENTATION_STATUS/i.test(readme)) findings.push({severity:'WARN',type:'README_STATUS_LINK_MISSING',message:'README should point users to the authoritative implementation status.'});
 const knowledge=await discoverRepoKnowledge(root);
 if(knowledge.missing.includes('AGENTS.md'))findings.push({severity:'WARNING',type:'AGENTS_MD_MISSING',message:'No root AGENTS.md; document stable engineering constraints for agent discovery. No file was created.'});
 if(!Object.keys(knowledge.verificationCommands).length)findings.push({severity:'WARNING',type:'VERIFICATION_COMMAND_MISSING',message:'No verify/test/check script found; add a deterministic project verification command.'});
 const aiStatus=await safePath(root,'.ai/STATUS.md');
 const blueprintStatus=await safePath(root,'Blueprint/23_IMPLEMENTATION_STATUS.md');
 if(aiStatus&&blueprintStatus){
  const [a,b]=await Promise.all([fs.stat(aiStatus),fs.stat(blueprintStatus)]);
  if(Math.abs(a.mtimeMs-b.mtimeMs)>30*24*60*60*1000)findings.push({severity:'WARNING',type:'STATUS_BLUEPRINT_MTIME_DRIFT',message:'STATUS.md and Blueprint/23 modification times differ by more than 30 days; review consistency without automatically editing either file.'});
 }
 return {ok:!findings.some(x=>x.severity==='ERROR'),findings,scannedAt:new Date().toISOString()};
}
module.exports={scan};
