'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDetector,identity}=require('../src/account-detection.js');
const response=(json,status=200)=>new Response(JSON.stringify(json),{status,headers:{'content-type':'application/json'}});
const status=events=>events.filter(e=>e.type==='ACCOUNT_STATUS').at(-1)?.payload;
function detector(fetch,timeoutMs=30){const events=[];return {events,...createDetector({fetch,timeoutMs,post:(type,payload)=>events.push({type,payload})})}}
test('logged-in session is checked first and only stable user identity crosses the bridge',async()=>{
  const calls=[],d=detector(async url=>{calls.push(url);return response({user:{id:'fixture-user'},accessToken:'fixture-secret'})});
  await d.detect();assert.deepEqual(calls,['/api/auth/session']);assert.equal(status(d.events).state,'ready');assert.ok(!JSON.stringify(d.events).includes('fixture-secret'));assert.equal(identity({id:'unrelated-object'},'/api/auth/session'),'');
});
test('backend identity fallback uses the same-page session token without exposing it',async()=>{
  const d=detector(async(url,options)=>{if(url==='/api/auth/session')return response({accessToken:'fixture-secret'});assert.equal(options.headers.authorization,'Bearer fixture-secret');assert.equal(options.credentials,'include');return response({id:'fixture-user'})});
  await d.detect();assert.equal(status(d.events).state,'ready');assert.ok(!JSON.stringify(d.events).includes('fixture-secret'));
});
test('a hanging session request times out and cannot prevent the backend identity fallback',async()=>{
  const d=detector(url=>url==='/api/auth/session'?new Promise(()=>{}):Promise.resolve(response({id:'fixture-user'})),10);
  await d.detect();assert.equal(status(d.events).state,'ready');
});
test('timeouts and unauthorized sessions end with actionable statuses rather than permanent checking',async()=>{
  const unauthorized=detector(async()=>response({},401));await unauthorized.detect();assert.equal(status(unauthorized.events).state,'signed-out');assert.equal(unauthorized.events.filter(e=>e.type==='ACCOUNT_CONTEXT').at(-1).payload.identifier,'');
  const hanging=detector(()=>new Promise(()=>{}),5);await hanging.detect();assert.equal(status(hanging.events).state,'network-error');
  const blocked=detector(async()=>response({},403));await blocked.detect();assert.equal(status(blocked.events).state,'blocked');
});
test('duplicate requests coalesce and a later retry can recover a failed identification',async()=>{
  let ready=false,calls=0;const d=detector(async()=>{calls++;return ready?response({user:{id:'fixture-user'}}):response({},401)});
  const first=d.detect();assert.equal(d.detect(),first);await first;assert.equal(calls,2);ready=true;await d.detect();assert.equal(status(d.events).state,'ready');
});
test('a normal same-origin authenticated response supersedes an older failed detection',async()=>{
  const d=detector(()=>new Promise(()=>{}),5),pending=d.detect();
  d.observeResponse('https://example.com/api/auth/session','GET',response({user:{id:'foreign'}}));
  d.observeResponse('/api/auth/session','POST',response({user:{id:'posted'}}));
  d.observeResponse('/api/auth/session','GET',response({user:{id:'fixture-user'},accessToken:'fixture-secret'}));
  await pending;assert.equal(status(d.events).state,'ready');assert.equal(d.events.filter(e=>e.type==='ACCOUNT_CONTEXT').at(-1).payload.identifier,'fixture-user');assert.ok(!JSON.stringify(d.events).includes('fixture-secret'));
});
