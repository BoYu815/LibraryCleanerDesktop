'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('files',Object.freeze({
  refresh:()=>ipcRenderer.invoke('local:refresh'),
  addProject:()=>ipcRenderer.invoke('local:add'),
  settings:field=>ipcRenderer.invoke('local:settings',field),
  remove:files=>ipcRenderer.invoke('local:trash',files),
  reveal:file=>ipcRenderer.invoke('local:reveal',file),
  open:file=>ipcRenderer.invoke('local:open',file),
  onState:callback=>ipcRenderer.on('local:state',(_event,state)=>callback(state))
}));
