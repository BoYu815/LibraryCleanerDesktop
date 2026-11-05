'use strict';
const {ipcRenderer}=require('electron');
// Runs in an isolated, sandboxed world. No filesystem or IPC API is exposed to the page.
if(location.origin==='https://chatgpt.com'){
  window.addEventListener('message',async event=>{
    if(event.source!==window||event.origin!=='https://chatgpt.com')return;
    const m=event.data;
    if(m?.channel==='LC_DESKTOP_NATIVE_V1'&&m.type==='CLOUD_PROJECTS'&&Array.isArray(m.projects)){ipcRenderer.send('cleaner:cloud-projects',m.projects);return;}
    if(!m||m.channel!=='LC_DESKTOP_NATIVE_V1'||m.type!=='CONFIRM_DELETE'||typeof m.requestId!=='string'||m.requestId.length>80)return;
    let approved=false;
    try{approved=await ipcRenderer.invoke('cleaner:approve-delete',{files:m.files})}catch{}
    window.postMessage({channel:'LC_DESKTOP_NATIVE_V1',type:'CONFIRM_DELETE_RESULT',requestId:m.requestId,approved},'https://chatgpt.com');
  });
}
