'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {CodexProjects}=require('../projects/codex.cjs');
const kinds=['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'];
const stamp=row=>crypto.createHash('sha256').update(JSON.stringify([row.id,row.name,row.cwd,row.projectId,row.parentThreadId,row.updatedAt])).digest('hex');
const summary=(row,archived)=>({id:row.id,name:row.name||'未命名对话',cwd:row.cwd,projectId:row.projectId||null,parentThreadId:row.parentThreadId||null,updatedAt:row.updatedAt,archived,active:row.status?.type==='active',stamp:stamp(row)});
class Conversations{
  constructor({clientFor}={}){this.clientFor=clientFor||(settings=>new CodexProjects({home:settings.codexHome,executable:settings.codexExecutable}))}
  async pages(client,params){const rows=[];for(const archived of [false,true]){let cursor=null;for(let i=0;i<100;i++){const result=await client.request('thread/list',{...params,archived,sourceKinds:kinds,limit:100,...(cursor?{cursor}:{})});for(const row of result.data||[])rows.push(summary(row,archived));cursor=result.nextCursor;if(!cursor)break;if(i===99)throw Error('对话数量超过安全核对范围。')}}return rows}
  async rows(client,selection){
    const params=selection.projectId?{projectId:selection.projectId}:{cwd:selection.roots};const base=await this.pages(client,params),map=new Map(base.map(row=>[row.id,row]));
    const missing=(selection.ids||[]).filter(id=>!map.has(id));if(missing.length){const known=new Set(missing);for(const row of await this.pages(client,{}))if(known.has(row.id))map.set(row.id,row)}
    const allowedProjects=new Set([...map.values()].map(row=>row.projectId).filter(Boolean));
    for(const row of [...map.values()].filter(row=>!row.parentThreadId||!map.has(row.parentThreadId))){for(const child of await this.pages(client,{ancestorThreadId:row.id})){if(child.projectId&&!allowedProjects.has(child.projectId))throw Error('关联对话的子对话已属于其他项目，不能一并删除。');map.set(child.id,child)}}
    return [...map.values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  async prepare(project,homes){
    if(project.platform!=='codex')return {supported:false,rows:[],notice:project.platform==='deepseek'?'DeepSeek 对话的可恢复删除和到期永久删除尚未验证；本次只能处理文件，不会删除它的对话。':'没有可验证的 AI 对话归属，本次仅处理文件。'};
    try{
      const client=this.clientFor(homes),selection={roots:project.roots,ids:project.linkedThreadIds||[]};
      if(project.kind==='workspace'){const projects=await client.list();const original=projects.find(p=>p.id===project.nativeId)||projects.find(p=>p.paths.some(root=>project.roots.some(r=>path.resolve(r).toLowerCase()===path.resolve(root).toLowerCase())));if(!original)throw Error('未能确认原始项目身份。');selection.projectId=original.id;selection.workspace={id:original.id,name:original.name,paths:original.paths};}
      const rows=await this.rows(client,selection);if(rows.some(row=>row.active)){const error=Error('存在正在运行的关联对话，请先停止或结束对话。');error.blockAll=true;throw error}
      return {supported:true,settings:homes,selection,rows,rootIds:rows.filter(row=>!row.parentThreadId||!rows.some(parent=>parent.id===row.parentThreadId)).map(row=>row.id),notice:rows.length?'关联对话先归档，7 天内可以恢复；到期清理时才永久删除。已按官方接口接入，真实对话删除尚未完成实机验收。':'没有找到明确关联的对话，不会按名称猜测或删除其他对话。'};
    }catch(error){return {supported:false,blocked:!!error.blockAll,rows:[],notice:'对话暂不能安全处理：'+error.message+(error.blockAll?'':' 本次可仅处理文件。')}}
  }
  async validate(record){if(!record?.supported)return;const rows=await this.rows(this.clientFor(record.settings),record.selection);if(JSON.stringify(rows.map(r=>[r.id,r.stamp,r.archived]))!==JSON.stringify(record.rows.map(r=>[r.id,r.stamp,r.archived]))||rows.some(r=>r.active))throw Error('关联对话已经变化，请重新打开删除预览。')}
  async archive(record){if(!record?.supported)return record;const client=this.clientFor(record.settings);record.archiving=true;
    for(const id of record.rootIds){const row=record.rows.find(row=>row.id===id);if(!row.archived)await client.request('thread/archive',{threadId:id})}
    const current=await this.rows(client,record.selection);for(const row of record.rows){const found=current.find(c=>c.id===row.id);if(!found?.archived)throw Error('未能核验关联对话已归档。');row.afterArchive=found.stamp}record.archivedByTool=true;return record;
  }
  async restore(record){if(!record?.supported||!record.rows.length)return;const client=this.clientFor(record.settings);const current=await this.rows(client,record.selection);for(const row of record.rows.filter(row=>!row.archived)){const found=current.find(c=>c.id===row.id);if(!found)throw Error('部分对话已在原软件删除，不能恢复。');if(found.archived)await client.request('thread/unarchive',{threadId:row.id})}}
  async purge(record){if(!record?.supported)return;if(!record.archivedByTool)throw Error('对话归档状态未完成，不执行永久清理。');const client=this.clientFor(record.settings),current=await this.rows(client,record.selection),allowed=new Set(record.rows.map(row=>row.id));
    if(current.some(row=>!allowed.has(row.id)))throw Error('项目出现新的关联对话，未继续永久清理。');for(const row of current){const previous=record.rows.find(p=>p.id===row.id);if(!row.archived||row.stamp!==previous.afterArchive||row.active)throw Error('关联对话已恢复或变化，已暂停到期清理。')}
    for(const id of record.rootIds)if(current.some(row=>row.id===id))await client.request('thread/delete',{threadId:id});
    const remaining=await this.rows(client,record.selection);if(remaining.length)throw Error('原软件仍保留对话或出现新对话，尚未确认清理完成。');
    if(record.selection.workspace){const expected=record.selection.workspace,current=(await client.list()).find(p=>p.id===expected.id);if(current){if(current.name!==expected.name||JSON.stringify(current.paths)!==JSON.stringify(expected.paths))throw Error('原项目已经变化，未删除项目登记。');await client.request('project/delete',{projectId:expected.id})}}
  }
}
module.exports={Conversations,stamp};
