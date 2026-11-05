'use strict';
class CloudProjects{
  constructor(){this.rows=[];this.loaded=false}
  accept(input){if(!Array.isArray(input))return;const unique=new Map();for(const p of input){if(typeof p?.id!=='string'||!/^g-p-[a-z0-9-]{12,100}$/i.test(p.id)||typeof p.name!=='string'||p.name.length>250)continue;unique.set(p.id,{platform:'chatgpt-cloud',id:p.id,name:p.name,paths:[],kind:'cloud',canRemove:false,effect:'这是账号云端项目；删除会影响其聊天或资源。当前版本未验证其删除接口，暂不执行删除。'})}if(unique.size){this.rows=[...unique.values()];this.loaded=true}}
  async list(){return {connected:this.loaded,rows:this.rows,message:this.loaded?'从本工具中已登录页面的正常响应读取；暂不支持云端项目删除。':'云端项目需要先在本工具内登录 ChatGPT，然后打开侧栏。'}}
  async remove(){throw Error('云端项目删除接口尚未验证，不能按本地项目移除。')}
}
module.exports={CloudProjects};
