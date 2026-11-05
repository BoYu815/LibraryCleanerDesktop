'use strict';
const {app,BrowserWindow,WebContentsView,session,ipcMain,dialog,Menu}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const os=require('node:os');
const {ProjectManager}=require('./projects/manager.cjs');
const {CodexProjects}=require('./projects/codex.cjs');
const {DeepSeekProjects}=require('./projects/deepseek.cjs');
const {CloudProjects}=require('./projects/cloud.cjs');
const {demoProviders}=require('./projects/demo.cjs');
const {loadSettings,saveSettings,resolvePaths}=require('./projects/settings.cjs');
const {CHAT_ORIGIN,allowedNavigation,isLibrary,destructiveRequest,isDeleteEndpoint,normalizePairs,parseUpload,DeleteApproval}=require('./policy.cjs');
const smoke=process.argv.includes('--smoke-test');
const testRoot=process.env.LC_TEST_ROOT||(app.isPackaged?path.dirname(process.execPath):path.join(__dirname,'..'));
const testOutput=path.join(testRoot,'test-output');
if(smoke)app.setPath('userData',path.join(testRoot,'.smoke-profile'));
app.setName('LibraryCleanerDesktop');app.commandLine.appendSwitch('lang','zh-CN');app.enableSandbox();app.disableHardwareAcceleration();
const gotLock=smoke||app.requestSingleInstanceLock();if(!gotLock)app.quit();
const shellPath=path.join(__dirname,'shell.html');
let win,guest,mode='home',activeSession,activeAccount='',downloadProgress=0;
const approvals=new DeleteApproval(),prepared=new Set();
const cloudProjects=new CloudProjects();let projectManager,projectDemoManager=new ProjectManager(demoProviders()),projectUseDemo=smoke;
const popups=new Set();
const extensionDir=app.isPackaged?path.join(process.resourcesPath,'extension'):path.join(__dirname,'../extension');
const fontFamily={standard:'Microsoft YaHei',serif:'Microsoft YaHei',sansSerif:'Microsoft YaHei',monospace:'Consolas'};
const guestOptions={preload:path.join(__dirname,'guest-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,defaultFontFamily:fontFamily};
function status(message,loading=false){if(win&&!win.isDestroyed())win.webContents.send('cleaner:status',{message,loading,mode})}
function resize(){if(!win||!guest)return;const [width,height]=win.getContentSize();guest.setBounds({x:0,y:72,width,height:Math.max(0,height-104)})}
function closeGuest(){approvals.revoke();for(const popup of popups)if(!popup.isDestroyed())popup.close();popups.clear();if(guest){win.contentView.removeChildView(guest);guest.webContents.close();guest=null}activeAccount=''}
function isTrustedShell(event){return event.sender===win?.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url===require('node:url').pathToFileURL(shellPath).href}
function validGuest(event){return guest&&!guest.webContents.isDestroyed()&&event.sender===guest.webContents&&event.senderFrame===guest.webContents.mainFrame&&isLibrary(event.senderFrame.url)}
async function approveDelete(event,payload){if(!validGuest(event))return false;let files;try{files=normalizePairs(payload?.files)}catch{return false}if(downloadProgress){status('请等待备份保存完成后再删除。');return false}const contentsId=guest.webContents.id,account=activeAccount;
const text=files.slice(0,7).map(f=>'• '+(f.name||f.library_file_id)).join('\n')+(files.length>7?'\n… 共 '+files.length+' 个文件':'');
let approved=false;
if(smoke){approved=mode==='demo'&&files.every(f=>f.library_file_id.startsWith('libfile_demo_'))}
else{const r=await dialog.showMessageBox(win,{type:'warning',title:'确认删除资料库文件',message:mode==='demo'?'删除这 '+files.length+' 个演示文件？':'将选中的 '+files.length+' 个文件从 ChatGPT 云端资料库删除？',detail:text+'\n\n'+(mode==='demo'?'这些是虚构文件，不会影响真实账号。':'这会影响同一账号的资料库，不会删除电脑上的本地原件。请先备份需要保留的文件。'),buttons:['取消','确认删除'],defaultId:0,cancelId:0,noLink:true});approved=r.response===1}
if(!approved||!validGuest(event)||guest.webContents.id!==contentsId||activeAccount!==account)return false;
approvals.grant(files,{webContentsId:contentsId,accountId:account});return true}
function guardContents(contents){contents.on('will-navigate',(event,url)=>{if(!allowedNavigation(url)){event.preventDefault();status('已阻止离开登录与资料库页面的外部链接。')}});contents.on('will-redirect',(event,url)=>{if(!allowedNavigation(url)){event.preventDefault();status('登录跳转不在支持范围内，请使用页面提供的邮箱登录方式。')}});
contents.setWindowOpenHandler(({url})=>{if(!allowedNavigation(url)||mode==='demo')return {action:'deny'};return {action:'allow',overrideBrowserWindowOptions:{width:520,height:740,parent:win,autoHideMenuBar:true,webPreferences:{...guestOptions,session:activeSession}}}});
contents.on('did-create-window',child=>{popups.add(child);guardContents(child.webContents);child.on('closed',()=>popups.delete(child))});
contents.on('will-attach-webview',event=>event.preventDefault());
contents.on('did-navigate',()=>approvals.revoke());contents.on('did-navigate-in-page',()=>approvals.revoke());}
async function prepareSession(ses,demoMode){if(prepared.has(ses))return;prepared.add(ses);
if(smoke&&demoMode)await ses.clearStorageData();
ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
ses.setUserAgent(ses.getUserAgent(),'zh-CN,zh;q=0.9,en;q=0.7');
await ses.extensions.loadExtension(extensionDir,{allowFileAccess:false});
ses.webRequest.onBeforeRequest({urls:['https://chatgpt.com/backend-api/files/*']},(details,callback)=>{
  if(!destructiveRequest(details.url,details.method)){callback({});return}
  let allowed=false;try{allowed=details.method==='POST'&&isDeleteEndpoint(details.url)&&approvals.consume(parseUpload(details.uploadData),details.webContentsId)}catch{}
  if(!allowed)status('删除请求已拦截：请在文件列表中选择文件，并确认本机弹窗。');callback({cancel:!allowed});
});
ses.webRequest.onBeforeSendHeaders({urls:['https://chatgpt.com/backend-api/*']},(details,callback)=>{
  const key=Object.keys(details.requestHeaders).find(k=>k.toLowerCase()==='chatgpt-account-id');const account=key?String(details.requestHeaders[key]):'';
  if(guest&&guest.webContents.session===ses&&account){if(activeAccount&&account!==activeAccount)approvals.revoke();activeAccount=account}
  if(destructiveRequest(details.url,details.method)&&!approvals.matches(details.webContentsId,account||activeAccount)){callback({cancel:true});return}callback({requestHeaders:details.requestHeaders});
});
ses.on('will-download',(_event,item,contents)=>{
  const source=item.getURL(),name=path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
  if(!guest||contents?.id!==guest.webContents.id||!source.startsWith('blob:https://chatgpt.com/')||!name.toLowerCase().endsWith('.zip')){item.cancel();status('仅支持保存您在备份页主动生成的 ZIP。');return}
  downloadProgress++;status('ZIP 已生成，请选择本地保存位置。');
  if(smoke)item.setSavePath(path.join(testOutput,'demo-backup.zip'));
  else item.setSaveDialogOptions({title:'保存资料库 ZIP 备份',defaultPath:path.join(app.getPath('downloads'),name),filters:[{name:'ZIP 备份',extensions:['zip']}]});
  item.on('updated',()=>{if(item.getTotalBytes()>0)status('正在保存备份 · '+Math.round(item.getReceivedBytes()/item.getTotalBytes()*100)+'%')});
  item.once('done',(_event,state)=>{downloadProgress=Math.max(0,downloadProgress-1);status(state==='completed'?'备份已保存：'+item.getSavePath():state==='cancelled'?'已取消保存备份。':'备份保存失败，请重试。')});
});
if(demoMode){const {createDemo}=require('./demo.cjs');ses.demo=createDemo();await ses.protocol.handle('https',request=>ses.demo.handle(request));}
}
async function openLibrary(demoMode=false){if(downloadProgress){status('请等待当前备份保存完成。');return}closeGuest();mode=demoMode?'demo':'live';activeSession=session.fromPartition(demoMode?'persist:cleaner-demo-v1':'persist:cleaner-account-v1');await prepareSession(activeSession,demoMode);
guest=new WebContentsView({webPreferences:{...guestOptions,session:activeSession,backgroundThrottling:!smoke}});win.contentView.addChildView(guest);resize();guardContents(guest.webContents);
guest.webContents.on('did-start-loading',()=>status(demoMode?'正在打开演示数据…':'正在连接 ChatGPT，请在窗口内自行登录。',true));
guest.webContents.on('did-stop-loading',()=>status(demoMode?'演示模式：以下文件均为虚构。真实账号不受影响。':isLibrary(guest.webContents.getURL())?'点击“同步”读取云端资料库。':'请在当前窗口完成登录，再点击“打开资料库”。'));
guest.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)status('页面连接失败（'+code+'）。请检查网络后点击“刷新”。')});
guest.webContents.on('render-process-gone',()=>status('页面意外关闭，请点击“刷新”恢复。'));
status(demoMode?'演示模式 · 使用虚构数据':'正在连接 ChatGPT…',true);
await guest.webContents.loadURL(CHAT_ORIGIN+'/library');
}
async function action(name){if(!['home','reload','connect','demo','signout','projects'].includes(name))throw Error('Unsupported action');if(smoke&&name==='connect')throw Error('Live connection disabled in smoke test');
if(name==='projects'){if(downloadProgress){status('请等待备份完成。');return}closeGuest();mode='projects';status('桌面项目管理 · 移除项目不会清理硬盘文件。');return}
if(name==='home'){if(downloadProgress){status('请等待备份完成。');return}closeGuest();mode='home';status('准备就绪');return}
if(name==='reload'){if(guest)guest.webContents.reload();return}
if(name==='demo')return openLibrary(true);
if(name==='connect'){if(mode==='live'&&guest){await guest.webContents.loadURL(CHAT_ORIGIN+'/library');return}return openLibrary(false)}
if(name==='signout'){if(mode!=='live')return;const r=await dialog.showMessageBox(win,{type:'question',title:'退出本机登录',message:'退出登录并清除本机的登录状态和缓存？',detail:'不会删除云端资料库文件。下次连接需要重新登录。',buttons:['取消','退出登录'],defaultId:0,cancelId:0,noLink:true});if(r.response!==1)return;const ses=activeSession;closeGuest();await ses.clearStorageData();await ses.clearCache();mode='home';status('已退出登录。')}
}
async function createWindow(){win=new BrowserWindow({title:'资料库管家',width:1280,height:850,minWidth:920,minHeight:640,show:!smoke,backgroundColor:'#faf9f6',icon:path.join(__dirname,'icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'shell-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false}});
const settingsFile=path.join(app.getPath('userData'),'project-connections.json');let projectSettings=await loadSettings(settingsFile),projectPaths;
function rebuildProjectManager(){projectPaths=resolvePaths(projectSettings,{userData:app.getPath('userData')});projectManager=new ProjectManager({codex:new CodexProjects({executable:projectPaths.codexExecutable,home:projectPaths.codexHome}),deepseek:new DeepSeekProjects({home:projectPaths.deepseekHome,bridgeDir:projectPaths.bridgeDir}),'chatgpt-cloud':cloudProjects})}
rebuildProjectManager();
Menu.setApplicationMenu(null);win.on('resize',resize);win.on('closed',()=>{if(guest&&!guest.webContents.isDestroyed())guest.webContents.close();guest=null;win=null});
win.on('close',event=>{if(downloadProgress&&!smoke){const result=dialog.showMessageBoxSync(win,{type:'warning',message:'备份尚未保存完成，确认退出？',buttons:['继续等待','退出'],defaultId:0,cancelId:0});if(result===0)event.preventDefault()}});
win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
ipcMain.handle('cleaner:action',async(event,name)=>{if(!isTrustedShell(event))throw Error('Untrusted source');try{await action(name);return true}catch(error){status('操作未完成：'+String(error?.message||error).slice(0,180));return false}});
ipcMain.handle('cleaner:approve-delete',approveDelete);
ipcMain.on('cleaner:cloud-projects',(event,rows)=>{if(guest&&event.sender===guest.webContents&&event.senderFrame===guest.webContents.mainFrame&&event.senderFrame.url.startsWith(CHAT_ORIGIN+'/'))cloudProjects.accept(rows)});
ipcMain.handle('cleaner:projects-list',async(event,options)=>{if(!isTrustedShell(event))throw Error('Untrusted source');projectUseDemo=smoke||options?.demo===true;return (projectUseDemo?projectDemoManager:projectManager).list()});
ipcMain.handle('cleaner:projects-remove',async(event,request)=>{if(!isTrustedShell(event)||mode!=='projects')throw Error('只能在本地项目管理界面操作。');if(typeof request?.key!=='string'||request.key.length>300||typeof request.fingerprint!=='string'||request.fingerprint.length!==64)throw Error('项目选择无效。');const manager=projectUseDemo?projectDemoManager:projectManager;const project=await manager.prepare(request.key,request.fingerprint);let approved=false;
if(smoke){approved=projectUseDemo&&project.id.startsWith('demo-')}else{const r=await dialog.showMessageBox(win,{type:'warning',title:'从原软件项目栏移除',message:'移除“'+project.name+'”？',detail:(project.platform==='deepseek'?'DeepSeek Harness':'ChatGPT / Codex')+'\n'+project.paths.join('\n')+'\n\n'+project.effect+'\n\n'+(projectUseDemo?'当前为虚构演示项目。':'完成后将重新读取原始项目列表核验。'),buttons:['取消','确认移除'],defaultId:0,cancelId:0,noLink:true});approved=r.response===1}if(!approved)return manager.list();const result=await manager.remove(project);status(projectUseDemo?'已移除演示项目。':'原始项目列表已确认移除；原软件侧栏若未更新，请刷新原软件。');return result});
ipcMain.handle('cleaner:projects-install-deepseek',async event=>{if(!isTrustedShell(event)||smoke)throw Error('此操作仅可在正常运行时由用户确认。');const r=await dialog.showMessageBox(win,{type:'question',title:'启用 DeepSeek 项目连接器',message:'允许资料库管家连接 DeepSeek 的本机项目列表？',detail:'将安装一个本机连接插件并备份 DeepSeek 的插件配置。它仅提供项目名称、目录和会话数量读取，以及经过本工具确认的项目移除。不会读取聊天内容、账号密码或删除硬盘目录。安装后请重新打开 DeepSeek Harness。\n\n数据目录：'+projectPaths.deepseekHome,buttons:['取消','启用连接器'],defaultId:0,cancelId:0,noLink:true});if(r.response!==1)return {cancelled:true};const source=app.isPackaged?path.join(process.resourcesPath,'bridge/deepseek'):path.join(__dirname,'../bridge/deepseek');await require('./projects/installer.cjs').installDeepSeekBridge({source,bridgeDir:projectPaths.bridgeDir,home:projectPaths.deepseekHome});status('连接器已安装，请重新打开 DeepSeek Harness，再刷新项目列表。');return {installed:true}});
ipcMain.handle('cleaner:projects-settings',async(event,field)=>{if(!isTrustedShell(event))throw Error('Untrusted source');if(field===undefined)return projectPaths;if(smoke)throw Error('测试不允许修改真实连接位置。');if(!['codexExecutable','codexHome','deepseekHome','reset'].includes(field))throw Error('设置选项无效。');if(field==='reset'){projectSettings=await saveSettings(settingsFile,{});rebuildProjectManager();return projectPaths}const isFile=field==='codexExecutable';const result=await dialog.showOpenDialog(win,{title:isFile?'选择官方 codex.exe':field==='deepseekHome'?'选择包含 storages/workspace.json 的 DeepSeek 数据目录':'选择 ChatGPT/Codex 数据目录（通常为 .codex）',properties:[isFile?'openFile':'openDirectory'],...(isFile?{filters:[{name:'官方 Codex 程序',extensions:['exe']}]}:{})});if(result.canceled||!result.filePaths[0])return projectPaths;const chosen=result.filePaths[0];if(field==='deepseekHome'){await fs.promises.access(path.join(chosen,'storages/workspace.json'))}if(field==='codexHome'){const names=await fs.promises.readdir(chosen);if(!names.some(n=>n==='config.toml'||n==='.codex-global-state.json'||/^state_.*\.sqlite$/.test(n)))throw Error('这个目录没有可识别的 Codex 数据标记。')}projectSettings=await saveSettings(settingsFile,{...projectSettings,[field]:chosen});rebuildProjectManager();status('连接位置已保存，仅影响本工具。');return projectPaths});
await win.loadFile(shellPath);status('准备就绪');
if(smoke){fs.mkdirSync(testOutput,{recursive:true});await require('./smoke.cjs').run({win,openLibrary,getGuest:()=>guest,getSession:()=>activeSession,getDownloadProgress:()=>downloadProgress,approvals,status,out:testOutput});app.quit()}
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus()}});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(createWindow).catch(error=>{console.error('App startup failed:',smoke?error.stack:error.message);if(!smoke)dialog.showErrorBox('资料库管家启动失败',error.message);app.exit(1)});
