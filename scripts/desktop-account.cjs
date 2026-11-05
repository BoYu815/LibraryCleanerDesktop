'use strict';
function replaceOnce(source, from, to) {
  if (!source.includes(from)) throw Error('Account adapter upstream changed: ' + from.slice(0, 70));
  return source.replace(from, to);
}
function adaptAccountHook(hook, detectorSource) {
  hook=hook.replace(/\r\n/g,'\n');
  const start=hook.indexOf('  const detectAccount = async () => {');
  const end=hook.indexOf('  const openLibrarySource =',start);
  if(start<0||end<0)throw Error('Account detector location changed');
  hook=hook.slice(0,start)+"  const accountDetector = window.LibraryCleanerAccount.createDetector({fetch: originalFetch, post});\n  const detectAccount = () => accountDetector.detect();\n\n"+hook.slice(end);
  hook=replaceOnce(hook,'    const response = await originalFetch(input, init);','    const response = await originalFetch(input, init);\n    accountDetector.observeResponse(url, method, response);');
  return detectorSource+'\n'+hook;
}
function adaptAccountUI(content) {
  content=content.replace(/\r\n/g,'\n');
  content=replaceOnce(content,'  injectBridge();',"  desktopViewMode.then(mode => { if (mode !== 'login') injectBridge(); });");
  content=replaceOnce(content,'  const init = async () => {',"  const init = async () => {\n    if (await desktopViewMode === 'login') return;");
  content=replaceOnce(content,'    accountReady: false,',"    accountReady: false,\n    accountStatus: {state: 'checking', message: '正在读取当前 ChatGPT 登录会话…'},\n    pendingAccount: undefined,");
  content=replaceOnce(content,'    ui.sync.disabled = !state.accountReady || !state.bridgeReady;',"    ui.sync.disabled = !state.bridgeReady || (!state.accountReady && state.accountStatus.state === 'checking');");
  content=replaceOnce(content,"      ui.status.dataset.state = 'pending';\n      statusText.textContent = '帳號識別中';", "      const labels = {'checking':'账号识别中','signed-out':'请先登录','network-error':'识别超时','blocked':'等待网页验证','unavailable':'识别未完成'};\n      ui.status.dataset.state = state.accountStatus.state === 'checking' ? 'pending' : 'error';\n      statusText.textContent = labels[state.accountStatus.state] || '识别未完成';");
  content=replaceOnce(content,"      ui.sync.innerHTML = `${iconSvg('sync',16)}<span>同步</span>`;", "      ui.sync.innerHTML = `${iconSvg('sync',16)}<span>${state.accountReady ? '同步' : state.accountStatus.state === 'checking' ? '识别中' : '重试识别'}</span>`;\n      if (!state.accountReady) {\n        ui.syncTitle.textContent = state.accountStatus.state === 'checking' ? '正在识别账号' : '账号识别未完成';\n        ui.syncSubtitle.textContent = state.accountStatus.message;\n      }\n      ui.syncSubtitle.title = state.accountReady ? '' : state.accountStatus.message;");
  content=replaceOnce(content,"      state.syncProgress = { error: state.bridgeReady ? '尚未識別目前 ChatGPT 帳號' : '尚未連接頁面橋接器' };", "      state.syncProgress = null;\n      state.accountStatus = {state:'checking', message:'正在重新读取当前登录会话…'};");
  content=replaceOnce(content,"    if (msg.type === 'ACCOUNT_CONTEXT') { switchAccount(msg.payload?.identifier); return; }", "    if (msg.type === 'ACCOUNT_STATUS') {\n      const states = ['checking','ready','signed-out','network-error','blocked','unavailable'];\n      if (states.includes(msg.payload?.state)) {\n        state.accountStatus = {state: msg.payload.state, message: String(msg.payload.message || '').slice(0, 200)};\n        if (ui.status) { updateHeader(); updateSettings(); }\n      }\n      return;\n    }\n    if (msg.type === 'ACCOUNT_CONTEXT') {\n      if (!ui.status) state.pendingAccount = msg.payload?.identifier || '';\n      else switchAccount(msg.payload?.identifier);\n      return;\n    }");
  content=replaceOnce(content,'    await mount();',"    await mount();\n    if (state.pendingAccount !== undefined) { const identifier = state.pendingAccount; state.pendingAccount = undefined; await switchAccount(identifier); }");
  return content;
}
module.exports={adaptAccountHook,adaptAccountUI};
