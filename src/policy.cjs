'use strict';
const CHAT_ORIGIN = 'https://chatgpt.com';
const AUTH_HOSTS = new Set(['chatgpt.com','auth.openai.com','auth0.openai.com','accounts.google.com','login.microsoftonline.com','login.live.com','appleid.apple.com']);
function allowedNavigation(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&AUTH_HOSTS.has(u.hostname)&&(!u.port||u.port==='443')}catch{return false}}
function isLibrary(raw){try{const u=new URL(raw);return u.origin===CHAT_ORIGIN&&/^\/library(?:\/|$)/.test(u.pathname)}catch{return false}}
function destructiveRequest(raw,method){try{const u=new URL(raw);return u.origin===CHAT_ORIGIN&&u.pathname.startsWith('/backend-api/files/')&&(method==='DELETE'||(!['GET','HEAD'].includes(method)&&/delete|trash|remove|purge/i.test(u.pathname)))}catch{return true}}
function isDeleteEndpoint(raw){try{const u=new URL(raw);return u.origin===CHAT_ORIGIN&&u.pathname==='/backend-api/files/library/files/delete-batch'}catch{return false}}
function normalizePairs(input){if(!Array.isArray(input)||!input.length||input.length>50000)throw Error('文件列表无效');const seen=new Set();return input.map(f=>{if(!f||typeof f!=='object')throw Error('文件格式无效');const lib=f.library_file_id??f.libraryFileId,file=f.file_id??f.fileId;if(typeof lib!=='string'||typeof file!=='string'||!/^libfile[_-][\w-]{1,200}$/.test(lib)||!/^file[_-][\w-]{1,200}$/.test(file))throw Error('文件标识无效');const key=lib+'|'+file;if(seen.has(key))throw Error('文件列表包含重复项');seen.add(key);return {library_file_id:lib,file_id:file,name:typeof f.name==='string'?f.name.replace(/[\r\n\x00-\x1f]/g,' ').slice(0,180):''}})}
function parseUpload(uploadData){const pieces=(uploadData||[]).map(p=>{if(!p.bytes||p.file)throw Error('不支持的请求内容');return Buffer.from(p.bytes)});const bytes=Buffer.concat(pieces);if(bytes.length>4*1024*1024)throw Error('请求内容过大');const payload=JSON.parse(bytes.toString('utf8'));if(Object.keys(payload).some(k=>k!=='files'))throw Error('请求字段无效');return normalizePairs(payload.files)}
class DeleteApproval{
  constructor(now=()=>Date.now()){this.now=now;this.revoke()}
  grant(files,{webContentsId,accountId=''}){this.keys=new Map(normalizePairs(files).map(f=>[f.library_file_id+'|'+f.file_id,0]));this.webContentsId=webContentsId;this.accountId=accountId;this.expires=this.now()+10*60*1000}
  revoke(){this.keys=new Map();this.webContentsId=-1;this.accountId='';this.expires=0}
  matches(webContentsId,accountId=this.accountId){return this.expires>this.now()&&webContentsId===this.webContentsId&&accountId===this.accountId}
  consume(files,webContentsId){let list;try{list=normalizePairs(files)}catch{return false}if(!this.matches(webContentsId)||!list.every(f=>{const n=this.keys.get(f.library_file_id+'|'+f.file_id);return n!==undefined&&n<8}))return false;for(const f of list){const k=f.library_file_id+'|'+f.file_id;this.keys.set(k,this.keys.get(k)+1)}return true}
}
module.exports={CHAT_ORIGIN,allowedNavigation,isLibrary,destructiveRequest,isDeleteEndpoint,normalizePairs,parseUpload,DeleteApproval};
