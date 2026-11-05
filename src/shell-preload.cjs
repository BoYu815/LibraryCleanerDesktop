'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',Object.freeze({
  action:(name)=>ipcRenderer.invoke('cleaner:action',name),
  projects:Object.freeze({list:options=>ipcRenderer.invoke('cleaner:projects-list',options),remove:request=>ipcRenderer.invoke('cleaner:projects-remove',request),installDeepSeek:()=>ipcRenderer.invoke('cleaner:projects-install-deepseek'),settings:field=>ipcRenderer.invoke('cleaner:projects-settings',field)}),
  onStatus:(callback)=>{if(typeof callback==='function')ipcRenderer.on('cleaner:status',(_event,value)=>callback(value))}
}));
