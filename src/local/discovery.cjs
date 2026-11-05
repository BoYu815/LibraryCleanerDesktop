'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {resolvePaths}=require('../projects/settings.cjs');
const key=value=>crypto.createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0,24);
async function json(file){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return null}}
async function discover({home=os.homedir(),env=process.env,settings={},downloads,manual=[],nativeProjects=[]}={}){
  const homes=resolvePaths(settings,{home,env}),projects=[],warnings=[];
  const add=(platform,name,roots,source)=>{
    roots=[...new Set(roots.filter(p=>typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)!==path.parse(p).root).map(p=>path.normalize(p)))];
    if(!roots.length)return;
    const existing=projects.find(p=>p.platform===platform&&p.roots.some(r=>roots.includes(r)));
    if(existing){existing.roots=[...new Set([...existing.roots,...roots])];return existing}
    const project={id:key(platform+'|'+roots.slice().sort().join('|')),name:String(name||path.basename(roots[0])||'未命名项目'),platform,roots,source};projects.push(project);return project;
  };
  for(const p of nativeProjects)add('codex',p.name,p.paths||[],'GPT / Codex 官方项目接口');
  const codex=await json(path.join(homes.codexHome,'.codex-global-state.json'));
  for(const p of Object.values(codex?.['local-projects']||{}))add('codex',p.name,p.rootPaths||[],'GPT / Codex 项目登记');
  for(const p of Object.values(codex?.['thread-projectless-output-directories']||{})){
    if(typeof p!=='string'||!path.isAbsolute(p))continue;
    const owner=projects.find(x=>x.platform==='codex'&&x.roots.some(root=>inside(root,p)));
    if(!owner)add('codex',path.basename(path.dirname(p))||'会话输出',[p],'GPT / Codex 会话输出目录');
  }
  const imageHome=path.join(homes.codexHome,'generated_images'),unassignedImages=[];
  try{for(const item of await fs.readdir(imageHome,{withFileTypes:true})){
    if(!item.isDirectory()||item.isSymbolicLink())continue;
    const assignment=codex?.['thread-project-assignments']?.[item.name],legacy=codex?.['local-projects']?.[assignment?.projectId],hint=codex?.['thread-workspace-root-hints']?.[item.name];
    const owner=projects.find(p=>p.platform==='codex'&&p.roots.some(root=>(legacy?.rootPaths||[]).includes(root)||(typeof hint==='string'&&inside(root,hint))));
    const folder=path.join(imageHome,item.name);if(owner)owner.roots.push(folder);else unassignedImages.push(folder);
  }}catch{}
  if(unassignedImages.length)add('codex','生成图片（未归类）',unassignedImages,'GPT / Codex 生成图片目录');
  const deepseek=await json(path.join(homes.deepseekHome,'storages/workspace.json'));
  if(deepseek){
    if(Array.isArray(deepseek?.global?.workspaceIds)&&deepseek?.tables?.workspaces){
      for(const id of deepseek.global.workspaceIds){const p=deepseek.tables.workspaces[id];if(p)add('deepseek',p.title||p.name,[p.path],'DeepSeek 项目登记')}
    }else warnings.push('DeepSeek 项目记录格式暂不支持，可在连接设置中选择数据目录。');
  }
  const deepseekDownloads=path.join(homes.deepseekHome,'downloads');try{if((await fs.stat(deepseekDownloads)).isDirectory())add('deepseek','DeepSeek 下载（待归类）',[deepseekDownloads],'DeepSeek 下载目录，尚未确认是否由 AI 生成')}catch{}
  for(const p of manual)add('manual',p.name,[p.path],'自行关联的项目文件夹');
  // Output folders are useful task-level groups within a broad AI workspace.
  for(const parent of [...projects])for(const root of parent.roots)for(const name of ['output','outputs','artifacts','输出','生成文件']){
    const output=path.join(root,name);let children;try{children=await fs.readdir(output,{withFileTypes:true})}catch{continue}
    for(const child of children){if(!child.isDirectory()||child.isSymbolicLink()||child.name.startsWith('.')||child.name==='node_modules')continue;const childPath=path.join(output,child.name);if(projects.some(p=>p.roots.includes(childPath)))continue;const project=add(parent.platform,child.name,[childPath],'项目内的输出文件夹');if(project)project.parentId=parent.id}
  }
  if(downloads)add('downloads','下载文件 · 待归类',[downloads],'下载目录，尚未确认是否由 AI 生成');
  return {projects,homes,warnings};
}
function inside(root,file){const rel=path.relative(path.resolve(root),path.resolve(file));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))}
module.exports={discover,inside,key};
