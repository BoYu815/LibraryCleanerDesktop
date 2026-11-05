(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LibraryCleanerAccount = api;
})(globalThis, function () {
  'use strict';
  const identity = (json, endpoint) => {
    const candidates = [json?.user?.id, json?.user?.sub, json?.user_id, json?.userId];
    if (endpoint === '/backend-api/me') candidates.push(json?.id, json?.sub);
    return candidates.find(value => typeof value === 'string' && value.trim() && value.length < 512) || '';
  };
  function createDetector({fetch, post, timeoutMs = 5000}) {
    let inFlight = null, generation = 0;
    const publish = (ticket, identifier, state, message) => {
      if (ticket !== generation) return;
      post('ACCOUNT_CONTEXT', {identifier});
      post('ACCOUNT_STATUS', {state, message});
    };
    async function read(endpoint, headers) {
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(endpoint, {credentials: 'include', cache: 'no-store', headers: {accept: 'application/json', ...headers}, signal: controller.signal});
            if (!response.ok) return {status: response.status};
            try { return {status: response.status, json: await response.json()}; }
            catch { return {status: response.status, invalid: true}; }
          })(),
          new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({timeout: true}); }, timeoutMs); })
        ]);
      } catch { return {network: true}; }
      finally { clearTimeout(timer); }
    }
    async function run(ticket) {
      post('ACCOUNT_STATUS', {state: 'checking', message: '正在读取当前 ChatGPT 登录会话…'});
      const session = await read('/api/auth/session');
      const sessionId = identity(session.json, '/api/auth/session');
      if (sessionId) return publish(ticket, sessionId, 'ready', '已识别当前账号');
      const token = session.json?.accessToken || session.json?.access_token;
      const headers = typeof token === 'string' && token.length < 32768 ? {authorization: 'Bearer ' + token} : {};
      const me = await read('/backend-api/me', headers);
      const meId = identity(me.json, '/backend-api/me');
      if (meId) return publish(ticket, meId, 'ready', '已识别当前账号');
      const responses = [session, me];
      if (responses.some(r => r.timeout || r.network)) return publish(ticket, '', 'network-error', '账号识别超时或连接失败，请检查网络后点击“重试识别”。');
      if (responses.some(r => r.status === 403)) return publish(ticket, '', 'blocked', '登录服务暂未通过验证。请在顶部“登录页面”完成网页提示，再重试。');
      if (responses.every(r => r.status === 401 || (r.json && !Object.keys(r.json).length))) return publish(ticket, '', 'signed-out', '未读取到有效登录会话。请打开顶部“登录页面”，完成登录后再打开资料库。');
      publish(ticket, '', 'unavailable', '未能识别当前账号，请打开登录页面确认状态后重试。');
    }
    function detect() {
      if (inFlight) return inFlight;
      const ticket = ++generation;
      inFlight = run(ticket).finally(() => { inFlight = null; });
      return inFlight;
    }
    function observeResponse(url, method, response) {
      let endpoint;
      try {
        const target = new URL(url, 'https://chatgpt.com');
        if (target.origin !== 'https://chatgpt.com' || String(method).toUpperCase() !== 'GET') return;
        endpoint = target.pathname;
      } catch { return; }
      if (!['/api/auth/session', '/backend-api/me'].includes(endpoint) || !response.ok) return;
      const ticket = generation;
      response.clone().json().then(json => {
        if (ticket !== generation) return;
        const identifier = identity(json, endpoint);
        if (!identifier) return;
        publish(++generation, identifier, 'ready', '已识别当前账号');
      }).catch(() => {});
    }
    return {detect, observeResponse};
  }
  return {createDetector, identity};
});
