/* global chrome */
const desktopViewMode=new Promise(resolve=>{
  const requestId=crypto.randomUUID();
  const finish=mode=>{clearTimeout(timer);window.removeEventListener('message',listener);resolve(mode==='library'?'library':'login')};
  const listener=event=>{if(event.source!==window||event.origin!==location.origin)return;const m=event.data;if(m?.channel==='LC_DESKTOP_NATIVE_V1'&&m.type==='VIEW_MODE_RESULT'&&m.requestId===requestId)finish(m.mode)};
  const timer=setTimeout(()=>finish('login'),2000);
  window.addEventListener('message',listener);
  window.postMessage({channel:'LC_DESKTOP_NATIVE_V1',type:'GET_VIEW_MODE',requestId},location.origin);
});
const desktopConfirmDelete=files=>new Promise(resolve=>{
  const requestId=crypto.randomUUID();
  const listener=event=>{if(event.source!==window||event.origin!==location.origin)return;const m=event.data;if(m?.channel==='LC_DESKTOP_NATIVE_V1'&&m.type==='CONFIRM_DELETE_RESULT'&&m.requestId===requestId){clearTimeout(timer);window.removeEventListener('message',listener);resolve(m.approved===true)}};
  const timer=setTimeout(()=>{window.removeEventListener('message',listener);resolve(false)},5*60*1000);
  window.addEventListener('message',listener);
  window.postMessage({channel:'LC_DESKTOP_NATIVE_V1',type:'CONFIRM_DELETE',requestId,files:files.map(f=>({libraryFileId:f.libraryFileId,fileId:f.fileId,name:f.name}))},location.origin);
});
