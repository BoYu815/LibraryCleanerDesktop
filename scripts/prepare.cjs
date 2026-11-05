'use strict';
const fs=require('node:fs'),path=require('node:path');
const {adaptAccountUI,adaptAccountHook}=require('./desktop-account.cjs');
const convert=require('opencc-js').Converter({from:'tw',to:'cn'});
const simplified=source=>convert(source).replace(/zh-TW/g,'zh-CN').replace(/档案库/g,'资料库').replace(/档案/g,'文件').replace(/备份汇出/g,'备份导出').replace(/试算表/g,'表格').replace(/简报/g,'演示文稿').replace(/智慧清理/g,'日期清理').replace(/帐号/g,'账号').replace(/设定/g,'设置').replace(/资料来源/g,'数据来源').replace(/连线/g,'连接').replace(/资讯/g,'信息').replace(/副档名/g,'扩展名').replace(/建立日期/g,'创建日期').replace(/Library Cleaner/g,'资料库管家').replace(/<span>Light<\/span>/g,'<span>浅色</span>').replace(/<span>Dark<\/span>/g,'<span>深色</span>');
const root=path.resolve(__dirname,'..'),original=path.join(root,'vendor/original'),target=path.join(root,'extension');
fs.mkdirSync(target,{recursive:true});
for(const item of ['page-hook.js','icons','styles'])fs.cpSync(path.join(original,item),path.join(target,item),{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(original,'manifest.json'),'utf8'));
manifest.name='Library Cleaner Desktop Internal';delete manifest.action;delete manifest.background;
manifest.content_scripts[0].js=['desktop-adapter.js','content.js'];
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
let content=fs.readFileSync(path.join(original,'content.js'),'utf8');
function replaceOnce(from,to){if(!content.includes(from))throw Error('Upstream code changed: '+from.slice(0,70));content=content.replace(from,to)}
replaceOnce("const VERSION = '2.6';","const VERSION = '"+require('../package.json').version+" 桌面版';");
replaceOnce('panelOpen: false,','panelOpen: true,');
replaceOnce('autoSync: true,','autoSync: false,');
replaceOnce('state.autoSync = settings.autoSync !== false;','state.autoSync = settings.autoSync === true;');
replaceOnce('ui.deleteButton.disabled = !count || state.deleting;','ui.deleteButton.disabled = !count || state.deleting || state.downloading;');
replaceOnce('const statusText = ui.status.querySelector(\'span\');',"ui.sync.disabled = !state.accountReady || !state.bridgeReady;\n    const statusText = ui.status.querySelector('span');");
// Approval is enforced by the desktop process, including on the outgoing HTTP request.
replaceOnce('if (!confirm(`確定要刪除 ${files.length.toLocaleString(\'zh-TW\')} 個檔案？${bytes ? `\\n容量約 ${fmtBytes(bytes)}` : \'\'}\\n\\n此操作會將檔案移出 ChatGPT 檔案庫。`)) return;','if (!await desktopConfirmDelete(files)) return;');
content=content.replace('整理、備份與清理 ChatGPT 檔案','整理、備份與清理雲端資料庫');
content=content.replace("host.id = 'lc-extension-host';","host.id = 'lc-extension-host'; host.lang = 'zh-CN';");
fs.writeFileSync(path.join(target,'content.js'),simplified(adaptAccountUI(content)));
fs.writeFileSync(path.join(target,'page-hook.js'),simplified(adaptAccountHook(fs.readFileSync(path.join(original,'page-hook.js'),'utf8'),fs.readFileSync(path.join(root,'src/account-detection.js'),'utf8'))));
fs.appendFileSync(path.join(target,'page-hook.js'),'\n'+fs.readFileSync(path.join(root,'src/cloud-project-hook.js'),'utf8'));
fs.copyFileSync(path.join(root,'src/desktop-adapter.js'),path.join(target,'desktop-adapter.js'));
const css=Array.from({length:6},(_,i)=>fs.readFileSync(path.join(original,'styles/part'+(i+1)+'.css'),'utf8')).join('\n')+'\n'+fs.readFileSync(path.join(root,'src/desktop.css'),'utf8');
fs.writeFileSync(path.join(target,'panel.css'),css);
// The actual confirmation helper lives in the same extension isolated world as content.js.
fs.appendFileSync(path.join(target,'desktop-adapter.js'),'\n');
const png=fs.readFileSync(path.join(root,'assets/icon256.png'));
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=0;ico[7]=0;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);fs.writeFileSync(path.join(root,'assets/app.ico'),Buffer.concat([ico,png]));
fs.copyFileSync(path.join(original,'icons/icon128.png'),path.join(root,'src/icon.png'));
console.log('Prepared desktop interface and bundled assets.');
