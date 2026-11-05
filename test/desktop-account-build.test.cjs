'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {adaptAccountUI,adaptAccountHook}=require('../scripts/desktop-account.cjs');
test('desktop account adapter builds the supplied upstream files with LF and Windows CRLF checkouts',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'../vendor/original',file),'utf8').replace(/\r\n/g,'\n');
  const content=read('content.js').replace("    const statusText = ui.status.querySelector('span');","    ui.sync.disabled = !state.accountReady || !state.bridgeReady;\n    const statusText = ui.status.querySelector('span');");
  assert.equal(adaptAccountUI(content),adaptAccountUI(content.replace(/\n/g,'\r\n')));
  const hook=read('page-hook.js');
  assert.equal(adaptAccountHook(hook,'fixture detector'),adaptAccountHook(hook.replace(/\n/g,'\r\n'),'fixture detector'));
  assert.ok(adaptAccountUI(content).includes('重试识别'));
});
