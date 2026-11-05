'use strict';
const {app,BrowserWindow,ipcMain,dialog,Menu,shell}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {FileIndex}=require('./local/files.cjs'),{discover}=require('./local/discovery.cjs');
const {CodexProjects}=require('./projects/codex.cjs');
const {validate}=require('./projects/settings.cjs');
const smoke=process.argv.includes('--smoke-test'),testRoot=process.env.LC_TEST_ROOT||path.join(__dirname,'..');
if(smoke)app.setPath('userData',path.join(testRoot,'.local-smoke-profile'));
app.setName('LibraryCleanerDesktop');app.enableSandbox();app.disableHardwareAcceleration();app.commandLine.appendSwitch('lang','zh-CN');
const lock=smoke||app.requestSingleInstanceLock();if(!lock)app.quit();
const page=path.join(__dirname,'local-shell.html');let win,index,config={manual:[],connections:{}},configPath,scanning=null,pending=false,interval,snapshot={projects:[],files:[],warnings:[]},fixture,nativeProjects=[],nativeBusy=false;
const trusted=event=>event.sender===win?.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url===require('node:url').pathToFileURL(page).href;
function send(value){snapshot={...snapshot,...value};if(win&&!win.isDestroyed())win.webContents.send('local:state',snapshot)}
async function save(){const temp=configPath+'.tmp';await fs.writeFile(temp,JSON.stringify(config,null,2),'utf8');await fs.rename(temp,configPath)}
async function refresh(){
  if(scanning){pending=true;return scanning}
  scanning=(async()=>{
    send({busy:true,message:''});
    try{
      const found=await discover(smoke?{home:fixture.home,env:{},manual:fixture.manual}:{settings:config.connections,manual:config.manual,downloads:app.getPath('downloads'),nativeProjects});
      send({projects:found.projects.map(p=>({...p,count:snapshot.projects.find(old=>old.id===p.id)?.count||0})),homes:found.homes});
      const result=await index.scan(found.projects,{onProgress:value=>{if(win&&!win.isDestroyed())win.webContents.send('local:state',{...value,busy:true})}});send({...result,homes:found.homes,warnings:[...found.warnings,...result.warnings],busy:false,message:''});
      index.watch(found.projects,()=>refresh().catch(error=>send({busy:false,message:error.message})));
      return snapshot;
    }catch(error){send({busy:false,message:'扫描未完成：'+String(error.message||error)});throw error}
  })().finally(()=>{scanning=null;if(pending){pending=false;setTimeout(()=>refresh().catch(()=>{}),100)}});
  return scanning;
}
async function chooseFolder(title){const result=await dialog.showOpenDialog(win,{title,properties:['openDirectory']});return result.canceled?null:result.filePaths[0]}
async function refreshNative(){if(nativeBusy||smoke||!win)return;nativeBusy=true;try{const {resolvePaths}=require('./projects/settings.cjs'),homes=resolvePaths(config.connections);nativeProjects=await new CodexProjects({home:homes.codexHome,executable:homes.codexExecutable}).list();await refresh()}catch{/* Existing directory records remain usable without a running CLI. */}finally{nativeBusy=false}}
async function create(){
  configPath=path.join(app.getPath('userData'),'local-file-projects.json');await fs.mkdir(app.getPath('userData'),{recursive:true});
  if(smoke)fixture=await require('./local/smoke.cjs').fixtures(path.join(testRoot,'test-output/local-fixtures'));
  else try{const value=JSON.parse(await fs.readFile(configPath,'utf8'));config={manual:Array.isArray(value.manual)?value.manual.filter(p=>typeof p.name==='string'&&typeof p.path==='string'&&path.isAbsolute(p.path)):[],connections:validate(value.connections)}}catch{}
  index=new FileIndex({trash:smoke?fixture.trash:file=>shell.trashItem(file)});
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
    if(!smoke){const result=await dialog.showMessageBox(win,{type:'warning',title:'移到 Windows 回收站',message:'将这 '+files.length+' 个本地文件移到回收站？',detail:files.slice(0,8).map(f=>f.path).join('\n')+(files.length>8?'\n…':'')+'\n\n删除的是电脑上的实际文件，可通过回收站恢复。不会删除云端资料、聊天记录或整个项目目录。',buttons:['取消','移到回收站'],defaultId:0,cancelId:0,noLink:true});if(result.response!==1)return {cancelled:true}}
    const result=await index.remove(requests);await refresh();send({message:'已移到回收站 '+result.removed.length+' 个文件'+(result.failed.length?'，'+result.failed.length+' 个未完成；请检查扫描提示。':''),warnings:[...snapshot.warnings,...result.failed.map(f=>f.message)]});return result;
  });
  win.on('closed',()=>{index.close();clearInterval(interval);win=null});await win.loadFile(page);
  if(smoke){await require('./local/smoke.cjs').run({win,refresh,index,fixture,nativeTrash:file=>shell.trashItem(file),out:path.join(testRoot,'test-output')});app.quit()}
  else{
    await refresh();refreshNative();interval=setInterval(()=>{refresh().catch(()=>{});refreshNative()},60000);
    // Also watch the small registration directories; no account or chat content is read.
    for(const dir of [snapshot.homes.codexHome,path.join(snapshot.homes.deepseekHome,'storages')]){try{const watcher=require('node:fs').watch(dir,(_e,name)=>{if(String(name).includes('workspace')||String(name).includes('global-state'))refresh().catch(()=>{})});win.once('closed',()=>watcher.close())}catch{}}
  }
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus()}});app.on('window-all-closed',()=>app.quit());
app.whenReady().then(create).catch(error=>{console.error(error.stack||error);if(win)send({busy:false,message:'启动未完成：'+error.message});app.exit(1)});
