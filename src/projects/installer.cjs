'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url'),crypto=require('node:crypto');
const PLUGIN_ID='library-cleaner-project-bridge';
async function installDeepSeekBridge({source,bridgeDir,home}){const patch=path.join(home,'profiles/desktop/cordis.patch.yml');const original=await fs.readFile(patch,'utf8');if(original.length>2*1024*1024)throw Error('插件配置文件过大');
if(original.includes(PLUGIN_ID))throw Error('配置里已有项目连接器，请先重新打开 DeepSeek 并刷新项目列表。');
if(original.trim()&&!original.trim().startsWith('-')&&original.trim()!=='[]'&&!original.trim().startsWith('#'))throw Error('插件配置格式不受支持，尚未修改。');
await fs.mkdir(bridgeDir,{recursive:true});for(const file of ['index.mjs','package.json'])await fs.copyFile(path.join(source,file),path.join(bridgeDir,file));
const node='\n- id: '+PLUGIN_ID+'\n  name: '+JSON.stringify(pathToFileURL(path.join(bridgeDir,'index.mjs')).href)+'\n';const updated=(original.trim()==='[]'?'':original.trimEnd())+node;
const current=await fs.readFile(patch,'utf8');if(current!==original)throw Error('DeepSeek 配置刚刚变化，请重试。');
const backup=patch+'.library-cleaner-backup-'+Date.now();await fs.copyFile(patch,backup,fs.constants?.COPYFILE_EXCL||1);const tmp=patch+'.library-cleaner-'+crypto.randomBytes(5).toString('hex')+'.tmp';await fs.writeFile(tmp,updated,'utf8');await fs.rename(tmp,patch);return {backup};}
module.exports={installDeepSeekBridge,PLUGIN_ID};
