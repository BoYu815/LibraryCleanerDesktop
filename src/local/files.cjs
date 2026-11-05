'use strict';
const fs=require('node:fs/promises'),nativeFs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inside,key}=require('./discovery.cjs');
const skipped=new Set(['node_modules','.git','.svn','.hg','.venv','venv','__pycache__','.cache','.codex','.agents','.aws','.smoke-profile']);
const ignored=new Set(['.dll','.pak','.asar','.node','.log','.tmp','.lock','.dmp','.sqlite','.db','.zstd']);
function kind(file){const ext=path.extname(file).toLowerCase();if(['.ppt','.pptx','.odp'].includes(ext))return '演示文稿';if(['.doc','.docx','.pdf','.odt','.rtf','.md','.txt'].includes(ext))return '文档';if(['.xls','.xlsx','.csv','.tsv','.ods'].includes(ext))return '表格';if(['.png','.jpg','.jpeg','.webp','.gif','.svg','.bmp'].includes(ext))return '图片';if(['.zip','.7z','.rar','.exe','.msi','.msix'].includes(ext))return '软件与压缩包';if(['.step','.stp','.stl','.sldprt','.sldasm','.z3','.dwg','.dxf'].includes(ext))return '三维与图纸';if(['.mp4','.mov','.mp3','.wav','.m4a','.webm'].includes(ext))return '音视频';return '其他'}
const fingerprint=(file,stat)=>crypto.createHash('sha256').update(JSON.stringify([file,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs])).digest('hex');
const ignoredName=name=>name.startsWith('~$')||name.startsWith('.')||ignored.has(path.extname(name).toLowerCase());
class FileIndex{
  constructor({limit=25000,trash}={}){this.limit=limit;this.trash=trash;this.entries=new Map();this.watchers=[];this.closed=false}
  async scan(projects,{onProgress}={}){
    const entries=new Map(),rows=[],resultProjects=[],warnings=[],seen=new Set();
    const pathKey=value=>process.platform==='win32'?path.normalize(value).toLowerCase():path.normalize(value);
    const canonicalRoots=new Map();
    for(const project of projects)for(const root of project.roots)if(!canonicalRoots.has(root))canonicalRoots.set(root,await fs.realpath(root).catch(()=>null));
    const rootOwners=new Map();for(const project of projects)for(const root of project.roots){const canonical=canonicalRoots.get(root);if(!canonical)continue;const id=pathKey(canonical);if(!rootOwners.has(id))rootOwners.set(id,new Set());rootOwners.get(id).add(project.id)}
    let lastUpdate=0,lastSent=0;
    const progress=project=>{if(!onProgress||Date.now()-lastUpdate<500)return;lastUpdate=Date.now();const pending=projects.filter(p=>!resultProjects.some(done=>done.id===p.id)).map(p=>({...p,count:0,bytes:0,missing:[]}));onProgress({projects:[...resultProjects,...pending],chunkFiles:rows.slice(lastSent),message:'正在扫描：'+project.name});lastSent=rows.length};
    for(const project of [...projects].sort((a,b)=>Number(!!b.parentId)-Number(!!a.parentId))){
      const result={...project,count:0,bytes:0,missing:[],truncated:false};resultProjects.push(result);
      for(const root of project.roots){
        let canonical;try{canonical=canonicalRoots.get(root);if(!canonical||!(await fs.stat(canonical)).isDirectory())throw Error()}catch{result.missing.push(root);continue}
        const stack=[canonical];
        while(stack.length&&result.count<this.limit){
          const dir=stack.pop();let items;try{items=await fs.readdir(dir,{withFileTypes:true})}catch{warnings.push('无法读取：'+dir);continue}
          items.sort((a,b)=>Number(['output','outputs','artifacts','输出','生成文件'].includes(a.name))-Number(['output','outputs','artifacts','输出','生成文件'].includes(b.name)));
          for(const item of items){
            if(result.count>=this.limit){result.truncated=true;break}
            if(item.isSymbolicLink()||skipped.has(item.name)||item.name.startsWith('.'))continue;
            const file=path.join(dir,item.name);
            if(item.isDirectory()){const owners=rootOwners.get(pathKey(file));if(!owners||![...owners].some(id=>id!==project.id))stack.push(file);continue}
            if(!item.isFile()||ignoredName(item.name))continue;
            try{
              const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())continue;
              const real=await fs.realpath(file);if(!inside(canonical,real)||real!==file)continue;
              const identity=project.id+'|'+pathKey(real);if(seen.has(identity))continue;seen.add(identity);
              const id=key(identity),row={id,projectId:project.id,name:item.name,path:real,folder:path.dirname(real),type:kind(real),size:stat.size,modified:stat.mtimeMs,fingerprint:fingerprint(real,stat),source:project.source};
              entries.set(id,{...row,root:canonical});rows.push(row);result.count++;result.bytes+=stat.size;
              if(result.count%200===0)progress(project);
            }catch{warnings.push('文件已变化或无法读取：'+file)}
          }
        }
        if(stack.length)result.truncated=true;
      }
      if(result.truncated)warnings.push('项目“'+project.name+'”超过 '+this.limit+' 个文件，本次为部分结果。可关联更具体的文件夹。');
      progress(project);
    }
    for(const child of resultProjects){if(!child.parentId)continue;const parent=resultProjects.find(p=>p.id===child.parentId);if(parent){parent.count+=child.count;parent.bytes+=child.bytes}}
    this.entries=entries;this.projects=projects;return {projects:resultProjects,files:rows,warnings,checkedAt:Date.now()};
  }
  async validate(requests){
    if(!Array.isArray(requests)||requests.length<1||requests.length>500)throw Error('请选择 1 至 500 个文件。');
    const seen=new Set(),out=[];
    for(const request of requests){
      if(typeof request?.id!=='string'||typeof request.fingerprint!=='string'||seen.has(request.id))throw Error('文件选择无效。');seen.add(request.id);
      const entry=this.entries.get(request.id);if(!entry||entry.fingerprint!==request.fingerprint)throw Error('文件列表已经变化，请刷新后重新选择。');
      if(!this.projects.some(p=>p.id===entry.projectId))throw Error('这个项目已停止监测。');
      const stat=await fs.lstat(entry.path).catch(()=>null);if(!stat||!stat.isFile()||stat.isSymbolicLink()||fingerprint(entry.path,stat)!==entry.fingerprint)throw Error('文件已变化，未删除：'+entry.name);
      const root=await fs.realpath(entry.root).catch(()=>''),real=await fs.realpath(entry.path).catch(()=>'');
      if(root!==entry.root||real!==entry.path||!inside(root,real))throw Error('文件位置已变化，未删除：'+entry.name);
      // A parent replaced by a junction must never expand the original scan boundary.
      let parent=path.dirname(entry.path);
      while(parent!==entry.root){if(!inside(entry.root,parent))throw Error('文件超出项目范围。');const parentStat=await fs.lstat(parent);if(parentStat.isSymbolicLink())throw Error('文件夹已变为链接，请重新扫描。');parent=path.dirname(parent)}
      out.push(entry);
    }
    return out;
  }
  async remove(requests){
    await this.validate(requests);const removed=[],failed=[];
    for(const request of requests){try{const [entry]=await this.validate([request]);await this.trash(entry.path);removed.push(entry.path);this.entries.delete(entry.id)}catch(error){failed.push({id:request.id,message:String(error.message||error)})}}
    return {removed,failed};
  }
  watch(projects,onChange){
    this.stopWatching();const roots=[...new Set(projects.flatMap(p=>p.roots))];let timer;
    for(const root of roots){try{const watcher=nativeFs.watch(root,{recursive:true},(_event,name)=>{if(name&&String(name).split(/[\\/]/).some(part=>skipped.has(part)))return;clearTimeout(timer);timer=setTimeout(onChange,1200)});watcher.on('error',onChange);this.watchers.push(watcher)}catch{}}
    this.clearTimer=()=>clearTimeout(timer);
  }
  stopWatching(){this.clearTimer?.();for(const watcher of this.watchers)watcher.close();this.watchers=[]}
  close(){this.closed=true;this.stopWatching()}
}
module.exports={FileIndex,kind,fingerprint,skipped};
