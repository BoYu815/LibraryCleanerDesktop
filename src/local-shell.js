'use strict';
const $=id=>document.getElementById(id),labels={codex:'GPT / Codex',deepseek:'DeepSeek',manual:'关联的项目',downloads:'待归类'};
let state={projects:[],files:[],warnings:[],busy:true},active='all',activePlatform='all',page=0,selected=new Map(),visible=[],searchTimer,deletePlan;
const size=n=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';
const date=n=>new Date(n).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el};
function report(error){$('status').textContent=String(error?.message||error);$('status').title=$('status').textContent}
async function perform(action){try{await action()}catch(error){report(error)}}
function animate(){if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.querySelector('.file-panel').animate([{opacity:.65,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:190,easing:'cubic-bezier(.2,.7,.2,1)'})}
function choose(id){active=id;page=0;selected.clear();render();animate()}
const platformFiles=()=>{const allowed=new Set(state.projects.filter(p=>activePlatform==='all'||p.platform===activePlatform).map(p=>p.id));return state.files.filter(f=>allowed.has(f.projectId))};
function sidebar(){
  const container=$('projects'),scrollTop=container.scrollTop;container.replaceChildren();
  const item=(id,name,count)=>{const button=node('button','project'+(active===id?' active':''));button.dataset.projectId=id;button.append(node('span','folder','▱'),node('span','name',name),node('span','number',String(count)));button.title=id==='all'?name:name+' · 右键可删除这一项';button.onclick=()=>choose(id);if(id!=='all')button.oncontextmenu=event=>{event.preventDefault();perform(()=>window.files.projectMenu(id))};return button};
  container.append(item('all',activePlatform==='all'?'全部项目':labels[activePlatform]+' 项目',new Set(platformFiles().map(f=>f.path)).size));
  for(const platform of ['codex','deepseek','manual','downloads']){if(activePlatform!=='all'&&activePlatform!==platform)continue;const projects=state.projects.filter(p=>p.platform===platform);if(!projects.length)continue;container.append(node('div','project-group',labels[platform]));for(const p of projects.filter(p=>!p.parentId)){container.append(item(p.id,p.name,p.count||0));for(const child of projects.filter(c=>c.parentId===p.id)){const button=item(child.id,child.name,child.count||0);button.classList.add('child-project');container.append(button)}}}
  container.scrollTop=scrollTop;
}
function selection(){
  $('selection').hidden=!selected.size;$('selected-count').textContent='已选 '+selected.size+' 个';
  $('select-page').checked=visible.length>0&&visible.every(f=>selected.has(f.id));$('select-page').indeterminate=visible.some(f=>selected.has(f.id))&&!$('select-page').checked;
}
function render(){
  if(active!=='all'&&!state.projects.some(p=>p.id===active))active='all';
  const live=new Map(state.files.map(f=>[f.id,f.fingerprint]));for(const [id,fp] of selected)if(live.get(id)!==fp)selected.delete(id);
  sidebar();$('platform-switch').dataset.active=activePlatform;for(const button of document.querySelectorAll('[data-platform]'))button.setAttribute('aria-pressed',String(button.dataset.platform===activePlatform));const project=state.projects.find(p=>p.id===active);$('project-title').textContent=project?.name||(activePlatform==='all'?'全部项目':labels[activePlatform]+' 的文件');$('platform').textContent=project?(labels[project.platform]+' · '+project.source):'本地项目文件';
  $('project-path').textContent=project?project.roots.join('  ·  '):'自动定位 GPT / Codex 与 DeepSeek 的本地项目，监测目录中的文件';$('project-path').title=$('project-path').textContent;
  const search=$('search').value.toLowerCase().trim(),type=$('type').value,sort=$('sort').value;
  const projectIds=new Set([active,...state.projects.filter(p=>p.parentId===active).map(p=>p.id)]);
  let files=platformFiles().filter(f=>(active==='all'||projectIds.has(f.projectId))&&(type==='all'||f.type===type)&&(!search||(f.name+' '+f.path).toLowerCase().includes(search)));
  if(active==='all'){const seen=new Set();files=files.filter(f=>{if(seen.has(f.path.toLowerCase()))return false;seen.add(f.path.toLowerCase());return true})}
  files.sort(sort==='name'?(a,b)=>a.name.localeCompare(b.name,'zh-CN'):sort==='size'?(a,b)=>b.size-a.size:(a,b)=>b.modified-a.modified);
  page=Math.max(0,Math.min(page,Math.ceil(files.length/100)-1));visible=files.slice(page*100,(page+1)*100);
  $('count').textContent=files.length.toLocaleString('zh-CN')+' 个文件 · '+size(files.reduce((n,f)=>n+f.size,0));
  const list=$('file-list');list.replaceChildren();
  for(const f of visible){
    const row=node('div','file-row');row.dataset.fileId=f.id;const checkbox=node('input');checkbox.type='checkbox';checkbox.checked=selected.has(f.id);checkbox.setAttribute('aria-label','选择 '+f.name);checkbox.onchange=()=>{checkbox.checked?selected.set(f.id,f.fingerprint):selected.delete(f.id);selection()};
    const info=node('div'),name=node('span','file-name',f.name),location=node('span','file-path',f.path);location.title=f.path;info.append(name,location);const owner=state.projects.find(p=>p.id===f.projectId);info.append(node('div','file-project',owner?.name||'未归类'));
    const actions=node('div','row-actions'),open=node('button','open-file','打开'),reveal=node('button','reveal-file','位置'),remove=node('button','delete-one','删除');
    open.onclick=()=>perform(()=>window.files.open({id:f.id,fingerprint:f.fingerprint}));reveal.onclick=()=>perform(()=>window.files.reveal({id:f.id,fingerprint:f.fingerprint}));remove.onclick=()=>perform(()=>window.files.remove([{id:f.id,fingerprint:f.fingerprint}]));actions.append(open,reveal,remove);
    row.append(checkbox,info,node('span','file-type',f.type),node('span','file-size',size(f.size)),node('span','file-date',date(f.modified)),actions);list.append(row);
  }
  $('empty').hidden=!!files.length;$('empty-copy').textContent=state.busy?'正在扫描本机项目，请稍候…':project?.missing?.length?'项目目录当前不存在或无法读取。可检查位置或关联新的文件夹。':'可以更换筛选条件，或关联项目文件夹。';
  $('page').textContent=(files.length?page+1:0)+' / '+Math.ceil(files.length/100);$('previous').disabled=page===0;$('next').disabled=(page+1)*100>=files.length;$('refresh').disabled=state.busy;$('refresh').textContent=state.busy?'正在定位…':'刷新定位';
  $('codex-home').textContent=state.homes?.codexHome||'自动定位';$('deepseek-home').textContent=state.homes?.deepseekHome||'自动定位';
  $('status').textContent=state.message||(state.busy?'正在查找项目与扫描文件…':'已监测 '+state.projects.length+' 个项目 · '+(state.checkedAt?'更新于 '+new Date(state.checkedAt).toLocaleTimeString('zh-CN'):'')+(state.warnings.length?' · '+state.warnings.length+' 条扫描提示':''));$('status').title=state.warnings.join('\n')||$('status').textContent;
  selection();
  $('recovery-open').textContent='回收区'+(state.recoveryCount?' · '+state.recoveryCount:'')+' · 保留 7 天';
}
function showDeletePlan(plan){deletePlan=plan;$('delete-title').textContent='删除“'+plan.name+'”';$('delete-summary').textContent=plan.files+' 个文件 · '+size(plan.bytes);$('delete-paths').textContent=plan.paths.join('\n');$('include-conversations').checked=plan.conversationSupported&&plan.conversations.length>0;$('include-conversations').disabled=!plan.conversationSupported||!plan.conversations.length;$('conversation-label').textContent='包含明确关联的 '+plan.conversations.length+' 条对话';$('delete-notice').textContent=plan.notice;const list=$('conversation-list');list.replaceChildren();for(const row of plan.conversations){const el=node('div','conversation-name',row.name);el.title=row.id;list.append(el)}if(!$('delete-dialog').open)$('delete-dialog').showModal()}
async function recovery(){
  const items=await window.files.recoveryList(),list=$('recovery-list');list.replaceChildren();if(!items.length)list.append(node('p','muted','回收区是空的。'));
  for(const item of items){const row=node('div','recovery-row'),info=node('div'),days=Math.max(0,Math.ceil((item.expiresAt-Date.now())/86400000));info.append(node('strong','',item.name),node('p','muted',item.files+' 个文件 · '+item.conversations+' 条对话 · '+(days?'剩余 '+days+' 天':'已到期，等待清理')),node('p','muted','到期：'+new Date(item.expiresAt).toLocaleString('zh-CN')));if(item.error)info.append(node('p','recovery-error',item.error));const button=node('button','restore-item','恢复');button.dataset.recoveryId=item.id;button.onclick=async()=>{button.disabled=true;try{await window.files.restore(item.id);await recovery()}catch(error){$('recovery-note').textContent=error.message;button.disabled=false}};row.append(info,button);list.append(row)}
}
window.files.onDeletePlan(showDeletePlan);$('delete-cancel').onclick=()=>$('delete-dialog').close();$('delete-confirm').onclick=async()=>{if(!deletePlan)return;const button=$('delete-confirm');button.disabled=true;try{const result=await window.files.removeProject({token:deletePlan.token,includeConversations:$('include-conversations').checked});if(!result?.cancelled){$('delete-dialog').close();deletePlan=null}}catch(error){$('delete-notice').textContent=error.message}finally{button.disabled=false}};
$('recovery-open').onclick=()=>perform(async()=>{await recovery();$('recovery-dialog').showModal()});
window.files.onState(next=>{if(next.chunkFiles){const map=new Map(state.files.map(f=>[f.id,f]));for(const file of next.chunkFiles)map.set(file.id,file);next={...next,files:[...map.values()]};delete next.chunkFiles}state={...state,...next};render()});
$('refresh').onclick=()=>perform(()=>window.files.refresh());
for(const id of ['add-project','empty-add'])$(id).onclick=()=>perform(()=>window.files.addProject());
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=0;render()},100)};for(const id of ['type','sort'])$(id).onchange=()=>{page=0;render();animate()};
for(const button of document.querySelectorAll('[data-platform]'))button.onclick=()=>{activePlatform=button.dataset.platform;choose('all')};
$('previous').onclick=()=>{page--;render();animate()};$('next').onclick=()=>{page++;render();animate()};
$('select-page').onchange=e=>{for(const f of visible)e.target.checked?selected.set(f.id,f.fingerprint):selected.delete(f.id);render()};
$('clear-selection').onclick=()=>{selected.clear();render()};$('trash').onclick=()=>perform(()=>window.files.remove([...selected].map(([id,fingerprint])=>({id,fingerprint}))));
$('settings').onclick=()=>$('settings-dialog').showModal();for(const button of document.querySelectorAll('[data-setting]'))button.onclick=()=>perform(()=>window.files.settings(button.dataset.setting));$('reset-settings').onclick=()=>perform(()=>window.files.settings('reset'));
$('status').onclick=()=>{if(state.warnings.length){$('warnings').textContent=state.warnings.join('\n');$('warning-dialog').showModal()}};
render();perform(()=>window.files.refresh());
