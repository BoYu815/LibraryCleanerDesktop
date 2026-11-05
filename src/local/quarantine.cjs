'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {inside}=require('./discovery.cjs');
const WEEK=7*24*60*60*1000,uuid=()=>crypto.randomUUID(),validId=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
async function exists(file){try{await fs.lstat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function inspect(target,{limit=100000}={}){
  const root=await fs.realpath(target),stat=await fs.lstat(target);if(stat.isSymbolicLink())throw Error('不能整项删除目录链接，请选择实际文件夹。');
  const hash=crypto.createHash('sha256'),stack=[root];let files=0,folders=0,bytes=0,entries=0;
  while(stack.length){const file=stack.pop(),s=await fs.lstat(file);if(++entries>limit)throw Error('目录内容太多，无法完成安全核验；请选择更具体的文件夹。');hash.update(JSON.stringify([path.relative(root,file),s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.isSymbolicLink()]));
    if(s.isSymbolicLink()){hash.update(await fs.readlink(file));continue}
    if(s.isDirectory()){folders++;const children=(await fs.readdir(file)).sort();for(const name of children)stack.push(path.join(file,name))}else if(s.isFile()){files++;bytes+=s.size}else throw Error('该目录含有不支持的特殊文件。');
  }
  return {path:root,parent:await fs.realpath(path.dirname(root)),directory:stat.isDirectory(),fingerprint:hash.digest('hex'),files,folders,bytes};
}
async function removeOwned(target,vault){
  if(!inside(vault,target)||target===vault)throw Error('清理目标超出回收区。');
  const stat=await fs.lstat(target);if(stat.isSymbolicLink()){await fs.unlink(target);return}
  if(stat.isDirectory()){if(await fs.realpath(target)!==target)throw Error('回收区目录位置发生变化，已停止清理。');for(const name of await fs.readdir(target))await removeOwned(path.join(target,name),vault);await fs.rmdir(target)}else await fs.unlink(target);
}
class Quarantine{
  constructor({dataDir,protectedPaths=[],blockedTrees=[],provider=null,clock=Date.now,vaultFor}={}){this.dataDir=dataDir;this.file=path.join(dataDir,'quarantine-index.json');this.protectedPaths=protectedPaths;this.blockedTrees=blockedTrees;this.provider=provider;this.clock=clock;this.vaultFor=vaultFor;this.tail=Promise.resolve()}
  async init(){await fs.mkdir(this.dataDir,{recursive:true});try{this.data=JSON.parse(await fs.readFile(this.file,'utf8'));if(!validId(this.data.installId)||!Array.isArray(this.data.items))throw Error('回收区索引格式不受支持。')}catch(error){if(error.code!=='ENOENT')throw error;this.data={version:1,installId:uuid(),items:[]};await this.save()}return this}
  async save(){const temp=this.file+'.tmp';await fs.writeFile(temp,JSON.stringify(this.data,null,2),'utf8');await fs.rename(temp,this.file)}
  serial(fn){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task}
  list(){return this.data.items.filter(item=>!['restored','purged'].includes(item.status)).map(item=>({id:item.id,name:item.name,projectId:item.projectId,deletedAt:item.deletedAt,expiresAt:item.expiresAt,status:item.status,error:item.error||'',files:item.files,bytes:item.bytes,paths:item.targets.map(t=>t.original),conversations:item.conversations?.rows?.length||0}))}
  hiddenProjectIds(){return new Set(this.data.items.filter(item=>item.projectId&&!['restored'].includes(item.status)).map(item=>item.projectId))}
  async prepare(targets,{name,projectId=null,conversations=null,protectedPaths=[]}={}){
    if(!Array.isArray(targets)||!targets.length||targets.length>500)throw Error('请选择 1 至 500 个目标。');
    const roots=[];for(const target of targets){const root=await fs.realpath(target);if(root===path.parse(root).root)throw Error('不能删除整个磁盘或共享根目录。');for(const protectedPath of [...this.protectedPaths,...protectedPaths,this.dataDir]){const guard=await fs.realpath(protectedPath).catch(()=>path.resolve(protectedPath));if(inside(root,guard))throw Error('这一项包含系统、账号数据或正在运行的软件，不能整项删除。')}for(const protectedPath of [this.dataDir,...this.blockedTrees,...this.data.items.flatMap(item=>item.targets.map(t=>t.vault))]){const guard=await fs.realpath(protectedPath).catch(()=>path.resolve(protectedPath));if(inside(guard,root)||inside(root,guard))throw Error('不能删除系统目录、账号数据或本工具的回收区。')}if(!roots.some(p=>inside(p,root)))roots.push(root)}
    const unique=roots.filter(root=>!roots.some(other=>other!==root&&inside(other,root))),items=[];for(const root of unique)items.push(await inspect(root));
    return {name,projectId,createdAt:this.clock(),targets:items,conversations,files:items.reduce((n,t)=>n+t.files,0),bytes:items.reduce((n,t)=>n+t.bytes,0)};
  }
  async vault(source){
    const volume=path.parse(source).root,ownVolume=path.parse(this.dataDir).root;
    const candidates=this.vaultFor?[await this.vaultFor(source)]:volume.toLowerCase()===ownVolume.toLowerCase()?[path.join(this.dataDir,'recovery-files')]:[path.join(volume,'.GeneratedFileManagerRecovery',this.data.installId),path.join(path.dirname(source),'.GeneratedFileManagerRecovery',this.data.installId)];
    let selected;for(const candidate of candidates){try{await fs.mkdir(candidate,{recursive:true});selected=candidate;break}catch{}}
    if(!selected)throw Error('无法建立同磁盘的回收区，文件尚未移动，请检查磁盘写入权限。');const stat=await fs.lstat(selected);if(stat.isSymbolicLink())throw Error('回收区不能是目录链接。');const root=await fs.realpath(selected),marker=path.join(root,'.owner.json');
    try{const owner=JSON.parse(await fs.readFile(marker,'utf8'));if(owner.installId!==this.data.installId)throw Error('这个回收目录不属于本工具。')}catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(marker,JSON.stringify({installId:this.data.installId}),'utf8')}
    return root;
  }
  async checkedVault(target){
    if(!validId(target.entryId)||!validId(target.batchId))throw Error('回收记录标识无效。');const root=await fs.realpath(target.vault);if(root!==target.vault||(await fs.lstat(root)).isSymbolicLink())throw Error('回收区位置已改变。');const owner=JSON.parse(await fs.readFile(path.join(root,'.owner.json'),'utf8'));if(owner.installId!==this.data.installId)throw Error('回收区归属不匹配。');const payload=path.join(root,'items',target.batchId,target.entryId,'content');if(!inside(root,payload))throw Error('无效的回收位置。');let parent=root;for(const part of ['items',target.batchId,target.entryId]){parent=path.join(parent,part);try{const stat=await fs.lstat(parent);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(parent)!==parent)throw Error('回收区内部目录已变化，停止操作。')}catch(error){if(error.code==='ENOENT')break;throw error}}return {root,payload};
  }
  put(plan){return this.serial(async()=>{
    if(this.clock()-plan.createdAt>5*60*1000)throw Error('删除预览已经过期，请重新打开。');
    for(const target of plan.targets){const current=await inspect(target.path);if(current.fingerprint!==target.fingerprint)throw Error('文件或目录已经变化，请重新确认。')}
    await this.provider?.validate(plan.conversations);
    const item={id:uuid(),name:plan.name,projectId:plan.projectId,deletedAt:this.clock(),expiresAt:this.clock()+WEEK,status:'preparing',targets:[],conversations:plan.conversations,files:plan.files,bytes:plan.bytes};
    for(const target of plan.targets){const vault=await this.vault(target.path);if(inside(target.path,vault))throw Error('回收区不能放在待删除目录里面。');item.targets.push({original:target.path,parent:target.parent,vault,batchId:item.id,entryId:uuid(),state:'pending'})}
    this.data.items.push(item);await this.save();
    try{
      item.conversations=await this.provider?.archive(item.conversations)||item.conversations;await this.save();
      for(let i=0;i<item.targets.length;i++){const target=item.targets[i],current=await inspect(plan.targets[i].path);if(current.fingerprint!==plan.targets[i].fingerprint)throw Error('目录正在使用或内容已变化，未继续移动。');const {payload}=await this.checkedVault(target);await fs.mkdir(path.dirname(payload),{recursive:true});await fs.rename(target.original,payload);target.state='stored';await this.save()}
      item.status='active';await this.save();return item.id;
    }catch(error){item.status='recovery-needed';item.error=String(error.message||error);await this.save();throw Error('本次处理未全部完成，已保留回收记录，请到回收区恢复：'+item.error)}
  })}
  restore(id){return this.serial(async()=>{
    const item=this.data.items.find(x=>x.id===id);if(!item||['restored','purged'].includes(item.status))throw Error('回收记录不存在。');
    for(const target of item.targets){const {payload}=await this.checkedVault(target);if(target.state==='pending'&&await exists(payload))target.state='stored';if(target.state!=='stored')continue;
      if(await exists(target.original))throw Error('原位置已有同名文件或文件夹，未覆盖：'+target.original);
      if(await fs.realpath(path.dirname(target.original))!==target.parent)throw Error('原文件夹位置已变化，不能自动恢复。');
      await fs.rename(payload,target.original);target.state='restored';await this.save();
    }
    await this.provider?.restore(item.conversations);item.status='restored';item.error='';await this.save();return true;
  })}
  purgeExpired(){return this.serial(async()=>{
    const result={purged:0,pending:0};for(const item of this.data.items){if(!['active','cleanup-pending'].includes(item.status)||this.clock()<item.expiresAt)continue;
      try{
        if(item.projectId){for(const target of item.targets)if(await exists(target.original))throw Error('原项目位置已有新内容，已暂停到期清理，请先确认或恢复。')}
        for(const target of item.targets)await this.checkedVault(target);
        await this.provider?.purge(item.conversations);
        for(const target of item.targets){if(target.state==='purged')continue;const {root,payload}=await this.checkedVault(target);if(await exists(payload))await removeOwned(payload,root);target.state='purged';await this.save()}
        item.status='purged';item.error='';item.conversations=null;await this.save();result.purged++;
      }catch(error){item.status='cleanup-pending';item.error=String(error.message||error);await this.save();result.pending++}
    }return result;
  })}
}
module.exports={Quarantine,inspect,removeOwned,WEEK};
