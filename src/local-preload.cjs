'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('files',Object.freeze({
  refresh:()=>ipcRenderer.invoke('local:refresh'),
  addProject:()=>ipcRenderer.invoke('local:add'),
  settings:field=>ipcRenderer.invoke('local:settings',field),
  remove:files=>ipcRenderer.invoke('local:trash',files),
  reveal:file=>ipcRenderer.invoke('local:reveal',file),
  open:file=>ipcRenderer.invoke('local:open',file),
  projectMenu:id=>ipcRenderer.invoke('local:project-menu',id),
  projectPlan:id=>ipcRenderer.invoke('local:project-plan',id),
  removeProject:request=>ipcRenderer.invoke('local:project-delete',request),
  recoveryList:()=>ipcRenderer.invoke('local:recovery-list'),
  restore:id=>ipcRenderer.invoke('local:restore',id),
  onDeletePlan:callback=>ipcRenderer.on('local:delete-plan',(_event,plan)=>callback(plan)),
  onState:callback=>ipcRenderer.on('local:state',(_event,state)=>callback(state))
}));
