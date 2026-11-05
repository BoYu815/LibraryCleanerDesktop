'use strict';
const crypto=require('node:crypto');
function fingerprint(p){return crypto.createHash('sha256').update(JSON.stringify([p.platform,p.id,p.name,p.paths,p.updatedAt])).digest('hex')}
class ProjectManager{
  constructor(providers){this.providers=providers;this.latest=new Map()}
  async list(){const states=await Promise.all(Object.entries(this.providers).map(async([platform,provider])=>{try{const result=await provider.list();return {platform,connected:Array.isArray(result)||result.connected,rows:Array.isArray(result)?result:result.rows,message:Array.isArray(result)?'本机项目接口已连接':result.message}}catch(error){return {platform,connected:false,rows:[],message:error.message}}}));this.latest.clear();for(const s of states)for(const p of s.rows){p.fingerprint=fingerprint(p);this.latest.set(p.platform+':'+p.id,p)}return {states,checkedAt:new Date().toISOString()}}
  async prepare(key,expected){const before=this.latest.get(key);if(!before||before.fingerprint!==expected)throw Error('项目列表已变化，请刷新后重新选择。');await this.list();const current=this.latest.get(key);if(!current||current.fingerprint!==expected)throw Error('原项目已变化，请重新选择。');if(!current.canRemove)throw Error('请先启用对应的项目连接器。');return {...current}}
  async remove(project){const current=await this.prepare(project.platform+':'+project.id,project.fingerprint);await this.providers[current.platform].remove(current);return this.list()}
}
module.exports={ProjectManager,fingerprint};
