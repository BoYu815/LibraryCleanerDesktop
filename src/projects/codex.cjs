'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn,execFile}=require('node:child_process'),readline=require('node:readline');
function discovery(){return new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); (Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation)"],{windowsHide:true,timeout:6000},(error,stdout)=>resolve(error?'':stdout.trim())))}
async function findExecutable(configured){if(configured&&path.isAbsolute(configured)&&path.basename(configured).toLowerCase()==='codex.exe'){await fs.access(configured);return configured}const root=await discovery();const candidates=[...(root?[path.join(root,'app/resources/codex.exe')]:[]),...(process.env.LOCALAPPDATA?[path.join(process.env.LOCALAPPDATA,'Programs/Codex/resources/codex.exe'),path.join(process.env.LOCALAPPDATA,'Programs/ChatGPT/resources/codex.exe')]:[])];for(const exe of candidates){try{await fs.access(exe);return exe}catch{}}throw Error('自动定位未找到官方项目接口，请在连接设置中选择 codex.exe。')}
class CodexProjects{
  constructor({executable,home}={}){this.executable=executable;this.home=home}
  async request(method,params){const executable=await findExecutable(this.executable);return new Promise((resolve,reject)=>{
    const child=spawn(executable,['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:this.home?{...process.env,CODEX_HOME:this.home}:process.env});let finished=false;let ready=false;
    const close=()=>{clearTimeout(timer);reader.close();child.stdin.end();child.kill()};
    const done=(error,value)=>{if(finished)return;finished=true;close();error?reject(error):resolve(value)};
    const timer=setTimeout(()=>done(Error('ChatGPT/Codex 本机接口连接超时。')),20000);
    const reader=readline.createInterface({input:child.stdout});child.stderr.on('data',()=>{});child.on('error',()=>done(Error('无法启动官方项目接口。')));child.on('exit',()=>{if(!finished)done(Error('官方项目接口已断开。'))});
    reader.on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.id===1){if(m.error)return done(Error(m.error.message||'初始化失败'));ready=true;child.stdin.write(JSON.stringify({method:'initialized'})+'\n');child.stdin.write(JSON.stringify({id:2,method,params})+'\n')}else if(m.id===2&&ready){if(m.error)return done(Error(m.error.message||'项目操作失败'));done(null,m.result)}});
    child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'library-cleaner-desktop',title:'资料库管家',version:'1.1.0'},capabilities:{experimentalApi:true}}})+'\n');
  })}
  async list(){const rows=[];let cursor=null;for(let page=0;page<100;page++){const result=await this.request('project/list',{limit:100,...(cursor?{cursor}:{})});for(const p of result.data||[])if(typeof p.id==='string'&&typeof p.name==='string')rows.push({platform:'codex',id:p.id,name:p.name,paths:(p.roots||[]).map(r=>r.path).filter(p=>typeof p==='string'),updatedAt:p.updatedAt,kind:'local',canRemove:true,effect:'从原软件的本地项目列表移除；保留本地文件与会话记录。'});cursor=result.nextCursor;if(!cursor)return rows}throw Error('项目分页超过限制，请缩小范围。')}
  async remove(project){await this.request('project/delete',{projectId:project.id});const rows=await this.list();if(rows.some(p=>p.id===project.id))throw Error('接口已返回，但原始列表仍含该项目，尚不能确认移除。');return rows}
}
module.exports={CodexProjects,findExecutable};
