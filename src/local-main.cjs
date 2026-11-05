'use strict';
const {app,BrowserWindow,ipcMain,dialog,Menu,shell}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {FileIndex}=require('./local/files.cjs'),{discover}=require('./local/discovery.cjs');
const {Quarantine}=require('./local/quarantine.cjs'),{Conversations}=require('./local/conversations.cjs');
const {inside}=require('./local/discovery.cjs'),crypto=require('node:crypto');
const {CodexProjects}=require('./projects/codex.cjs');
const {validate}=require('./projects/settings.cjs');
const smoke=process.argv.includes('--smoke-test'),testRoot=process.env.LC_TEST_ROOT||path.join(__dirname,'..');
if(smoke)app.setPath('userData',path.join(testRoot,'.local-smoke-profile'));
app.setName('LibraryCleanerDesktop');app.enableSandbox();app.disableHardwareAcceleration();app.commandLine.appendSwitch('lang','zh-CN');
const lock=smoke||app.requestSingleInstanceLock();if(!lock)app.quit();
const page=path.join(__dirname,'local-shell.html');let win,index,quarantine,conversations,config={manual:[],connections:{}},configPath,scanning=null,pending=false,interval,recoveryInterval,snapshot={projects:[],files:[],warnings:[]},fixture,nativeProjects=[],nativeBusy=false;const deletePlans=new Map();
const trusted=event=>event.sender===win?.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url===require('node:url').pathToFileURL(page).href;
function send(value){snapshot={...snapshot,...value};if(win&&!win.isDestroyed())win.webContents.send('local:state',snapshot)}
async function save(){const temp=configPath+'.tmp';await fs.writeFile(temp,JSON.stringify(config,null,2),'utf8');await fs.rename(temp,configPath)}
async function refresh(){
  if(scanning){pending=true;return scanning}
  scanning=(async()=>{
    send({busy:true,message:''});
    try{
      const found=await discover(smoke?{home:fixture.home,env:{},manual:fixture.manual}:{settings:config.connections,manual:config.manual,downloads:app.getPath('downloads'),nativeProjects});
      quarantine.protectedPaths=[app.getPath('home'),process.execPath,found.homes.codexHome,found.homes.deepseekHome];
      quarantine.blockedTrees=[...quarantine.fixedBlockedTrees,...['sessions','archived_sessions','auth.json','config.toml'].map(name=>path.join(found.homes.codexHome,name)),...['sessions','storages','profiles','credentials'].map(name=>path.join(found.homes.deepseekHome,name))];
      const hidden=quarantine.hiddenProjectIds();found.projects=(await Promise.all(found.projects.map(async p=>{if(!hidden.has(p.id))return p;for(const root of p.roots)try{await fs.lstat(root);return p}catch{}return null}))).filter(Boolean);
      send({projects:found.projects.map(p=>({...p,count:snapshot.projects.find(old=>old.id===p.id)?.count||0})),homes:found.homes});
      const result=await index.scan(found.projects,{onProgress:value=>{if(win&&!win.isDestroyed())win.webContents.send('local:state',{...value,busy:true})}});send({...result,recoveryCount:quarantine.list().length,homes:found.homes,warnings:[...found.warnings,...result.warnings],busy:false,message:''});
      index.watch(found.projects,()=>refresh().catch(error=>send({busy:false,message:error.message})));
      return snapshot;
    }catch(error){send({busy:false,message:'扫描未完成：'+String(error.message||error)});throw error}
  })().finally(()=>{scanning=null;if(pending){pending=false;setTimeout(()=>refresh().catch(()=>{}),100)}});
  return scanning;
}
async function chooseFolder(title){const result=await dialog.showOpenDialog(win,{title,properties:['openDirectory']});return result.canceled?null:result.filePaths[0]}
async function refreshNative(){if(nativeBusy||smoke||!win)return;nativeBusy=true;try{const {resolvePaths}=require('./projects/settings.cjs'),homes=resolvePaths(config.connections);nativeProjects=await new CodexProjects({home:homes.codexHome,executable:homes.codexExecutable}).list();await refresh()}catch{/* Existing directory records remain usable without a running CLI. */}finally{nativeBusy=false}}
async function prepareProject(id){
  if(scanning)await scanning;const project=snapshot.projects.find(p=>p.id===id);if(!project||project.platform==='downloads')throw Error('请右键选择具体项目或文件夹，不能整项删除公共下载目录。');
  const protectedPaths=[];for(const other of snapshot.projects){if(other.id===project.id||other.parentId===project.id)continue;for(const root of other.roots)if(project.roots.some(r=>inside(r,root)))protectedPaths.push(root)}
  const plan=await quarantine.prepare(project.roots,{name:project.name,projectId:project.id,protectedPaths});
  plan.conversations=smoke?fixture.conversations:await conversations.prepare(project,snapshot.homes);
  if(plan.conversations?.blocked)throw Error(plan.conversations.notice);
  plan.projectRoots=project.roots.slice();const token=crypto.randomUUID();if(deletePlans.size>=20)deletePlans.delete(deletePlans.keys().next().value);deletePlans.set(token,plan);
  return {token,name:plan.name,files:plan.files,bytes:plan.bytes,paths:plan.targets.map(t=>t.path),conversations:plan.conversations?.rows?.map(row=>({id:row.id,name:row.name}))||[],conversationSupported:!!plan.conversations?.supported,notice:plan.conversations?.notice||'仅处理文件。',days:7};
}
async function create(){
  configPath=path.join(app.getPath('userData'),'local-file-projects.json');await fs.mkdir(app.getPath('userData'),{recursive:true});
  if(smoke)fixture=await require('./local/smoke.cjs').fixtures(path.join(testRoot,'test-output/local-fixtures'));
  else try{const value=JSON.parse(await fs.readFile(configPath,'utf8'));config={manual:Array.isArray(value.manual)?value.manual.filter(p=>typeof p.name==='string'&&typeof p.path==='string'&&path.isAbsolute(p.path)):[],connections:validate(value.connections)}}catch{}
  conversations=new Conversations();quarantine=await new Quarantine({dataDir:smoke?path.join(fixture.root,'recovery-data'):app.getPath('userData'),provider:smoke?fixture.provider:conversations,clock:smoke?()=>fixture.now:Date.now,vaultFor:smoke?()=>fixture.recycle:undefined,protectedPaths:[app.getPath('home'),process.execPath],blockedTrees:[path.dirname(process.execPath),process.env.SystemRoot,...(smoke?[]:[path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions'),path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'archived_sessions'),path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'sessions'),path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'storages')])].filter(Boolean)}).init();
  index=new FileIndex();
  quarantine.fixedBlockedTrees=quarantine.blockedTrees.slice();
  win=new BrowserWindow({title:'生成文件管家',width:1320,height:880,minWidth:990,minHeight:650,show:!smoke,autoHideMenuBar:true,backgroundColor:'#f7f8fa',icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'local-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:!smoke}});
  Menu.setApplicationMenu(null);win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const handle=(name,callback)=>ipcMain.handle(name,async(event,...args)=>{if(!trusted(event))throw Error('不支持的操作来源。');return callback(...args)});
  handle('local:refresh',refresh);
  handle('local:add',async()=>{if(smoke)throw Error('演示测试不选择真实目录');const selected=await chooseFolder('关联项目文件夹');if(!selected)return;const root=await fs.realpath(selected);if(root===path.parse(root).root)throw Error('请选择具体项目文件夹，不要选择整个磁盘。');if(!config.manual.some(p=>p.path===root)){config.manual.push({name:path.basename(root),path:root});await save()}return refresh()});
  handle('local:settings',async field=>{if(smoke)throw Error('演示测试不更改真实设置');if(field==='reset')config.connections={};else{if(!['codexHome','deepseekHome'].includes(field))throw Error('无效的设置');const selected=await chooseFolder(field==='codexHome'?'选择 GPT / Codex 数据目录（通常为 .codex）':'选择 DeepSeek 数据目录（通常为 .dsh）');if(!selected)return;config.connections=validate({...config.connections,[field]:selected})}await save();nativeProjects=[];await refresh();refreshNative();return snapshot});
  handle('local:reveal',async request=>{const [file]=await index.validate([request]);shell.showItemInFolder(file.path);return true});
  handle('local:open',async request=>{const [file]=await index.validate([request]);if(!['演示文稿','文档','表格','图片','三维与图纸','音视频'].includes(file.type)||['.svg','.md','.txt'].includes(path.extname(file.path).toLowerCase())){shell.showItemInFolder(file.path);return true}const error=await shell.openPath(file.path);if(error)throw Error(error);return true});
  handle('local:trash',async requests=>{
    if(scanning)await scanning;const files=await index.validate(requests);
    const plan=await quarantine.prepare(files.map(f=>f.path),{name:files.length===1?files[0].name:files.length+' 个文件'});
    if(!smoke){const result=await dialog.showMessageBox(win,{type:'warning',title:'移入回收区，保留 7 天',message:'将这 '+files.length+' 个本地文件移入回收区？',detail:files.slice(0,8).map(f=>f.path).join('\n')+(files.length>8?'\n…':'')+'\n\n7 天内可在本工具的回收区恢复。到期后在软件运行或下次打开时永久清理。不安装后台任务。此次不处理对话。',buttons:['取消','移入回收区'],defaultId:0,cancelId:0,noLink:true});if(result.response!==1)return {cancelled:true}}
    await index.validate(requests);const id=await quarantine.put(plan);await refresh();send({message:'已移入回收区，保留 7 天；到期后自动清理。',recoveryCount:quarantine.list().length});return {id};
  });
  handle('local:project-plan',prepareProject);
  handle('local:project-menu',id=>{if(!snapshot.projects.some(p=>p.id===id))throw Error('请选择具体项目。');Menu.buildFromTemplate([{label:'删除这一项…（保留 7 天）',click:async()=>{try{send({message:'正在核对目录和关联对话…'});const plan=await prepareProject(id);win?.webContents.send('local:delete-plan',plan)}catch(error){send({message:error.message})}}}]).popup({window:win});return true});
  handle('local:project-delete',async request=>{const plan=deletePlans.get(request?.token);if(!plan)throw Error('删除预览已失效。');const project=snapshot.projects.find(p=>p.id===plan.projectId);if(!project||JSON.stringify(project.roots)!==JSON.stringify(plan.projectRoots))throw Error('项目位置已经变化，请重新确认。');if(!request.includeConversations&&!(plan.conversations?.supported&&!plan.conversations.rows.length&&plan.conversations.selection?.workspace))plan.conversations=null;else if(request.includeConversations&&!plan.conversations?.supported)throw Error('该平台暂不支持安全处理对话。');
    if(!smoke){const result=await dialog.showMessageBox(win,{type:'warning',title:'确认移入回收区',message:'删除这一项“'+plan.name+'”？',detail:plan.targets.map(t=>t.path).join('\n')+'\n\n整个目录，包括隐藏文件和子目录，将移入回收区。明确关联的对话：'+(plan.conversations?.rows.length||0)+' 条。\n7 天内可恢复。到期清理不可恢复，软件关闭时延至下次打开处理。',buttons:['取消','移入回收区，保留 7 天'],defaultId:0,cancelId:0,noLink:true});if(result.response!==1)return {cancelled:true}}
    const id=await quarantine.put(plan);deletePlans.delete(request.token);await refresh();send({message:'这一项已移入回收区，保留 7 天。'});return {id};
  });
  handle('local:recovery-list',()=>quarantine.list());handle('local:restore',async id=>{await quarantine.restore(id);await refresh();send({message:'已恢复到原位置。'});return true});
  win.on('closed',()=>{index.close();clearInterval(interval);clearInterval(recoveryInterval);win=null});await win.loadFile(page);
  if(smoke){await require('./local/smoke.cjs').run({win,refresh,index,fixture,quarantine,prepareProject,out:path.join(testRoot,'test-output')});app.quit()}
  else{
    quarantine.purgeExpired().then(result=>{if(result.pending)send({message:'部分到期记录暂不能安全清理，请查看回收区。'});return refresh()}).catch(error=>send({message:'到期清理未完成：'+error.message}));recoveryInterval=setInterval(()=>quarantine.purgeExpired().then(()=>refresh()).catch(error=>send({message:error.message})),60*60*1000);
    await refresh();refreshNative();interval=setInterval(()=>{refresh().catch(()=>{});refreshNative()},60000);
    // Also watch the small registration directories; no account or chat content is read.
    for(const dir of [snapshot.homes.codexHome,path.join(snapshot.homes.deepseekHome,'storages')]){try{const watcher=require('node:fs').watch(dir,(_e,name)=>{if(String(name).includes('workspace')||String(name).includes('global-state'))refresh().catch(()=>{})});win.once('closed',()=>watcher.close())}catch{}}
  }
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus()}});app.on('window-all-closed',()=>app.quit());
app.whenReady().then(create).catch(error=>{console.error(error.stack||error);if(win)send({busy:false,message:'启动未完成：'+error.message});app.exit(1)});
