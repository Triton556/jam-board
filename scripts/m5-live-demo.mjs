import { assertHistoricalCapture } from "./historical-capture-guard.mjs";
assertHistoricalCapture(import.meta.url);

// Exercise the real stdio sidecar and verify its calls reach the open desktop window.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'));
if(!page)throw new Error('Start the real Tauri app with WebView2 diagnostics on 9223.');
const runtime=await page.evaluate(async()=>(await import('/src/lib/api.ts')).api.runtimeInfo());
if(!/[\\/]\.dev-data[\\/]capture-[^\\/]+$/.test(runtime.dataDir))throw new Error('Use an isolated .dev-data/capture-* directory.');
if(process.argv.includes('--fresh')){
 const state=await page.evaluate(async()=>(await import('/src/lib/api.ts')).api.appState());
 if(state.hasJam)throw new Error('--fresh refuses existing data. Restart with a new capture directory.');
 await page.evaluate(async()=>(await import('/src/lib/api.ts')).api.loadDemoJam());
}
const state=await page.evaluate(async()=>(await import('/src/lib/api.ts')).api.appState());
if(state.jam?.keyPrefix!=='JB')throw new Error('Capture keys must use JB-* on clean data.');
const server=spawn(runtime.sidecarPath,['--db',`${runtime.dataDir}/jam.db`],{windowsHide:true,env:{...process.env,JAM_AGENT_NAME:'Codex',RUST_LOG:'warn'},stdio:['pipe','pipe','inherit']});
let seq=0;const pending=new Map();const lines=createInterface({input:server.stdout});
lines.on('line',line=>{const response=JSON.parse(line),waiter=pending.get(response.id);if(waiter){pending.delete(response.id);clearTimeout(waiter.timer);response.error?waiter.reject(new Error(JSON.stringify(response.error))):waiter.resolve(response.result);}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(new Error(`Timeout: ${method}`)),10000);pending.set(id,{resolve,reject,timer});server.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);});
try{
 await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'codex-m5-live-check',version:'1'}});
 server.stdin.write(`${JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})}\n`);
 const created=await request('tools/call',{name:'create_task',arguments:{title:'Plan lantern playtest with Codex',tags:['polish'],idempotencyKey:'m5-live-check'}});
 if(created.isError)throw new Error(JSON.stringify(created.content));
 const key=created.structuredContent.key;
 const commented=await request('tools/call',{name:'add_comment',arguments:{key,body:'I will check lantern readability, collect playtest notes, and report the three most useful fixes.'}});
 if(commented.isError)throw new Error(JSON.stringify(commented.content));
 await request('tools/call',{name:'get_board',arguments:{}});
 await page.waitForFunction(async()=>{const status=await(await import('/src/lib/api.ts')).api.mcpStatus();return ['create_task','add_comment'].every(tool=>status.recentCalls.some(c=>c.agent==='Codex'&&c.tool===tool&&c.ok));});
 const check=await page.evaluate(async key=>{const {api}=await import('/src/lib/api.ts');const status=await api.mcpStatus();const members=await api.listMembers();const activity=await api.listActivity({limit:100});const task=await api.getTask(key);return{key,online:members.find(m=>m.handle==='codex')?.online,comments:task.comments.length,recentCalls:status.recentCalls,activity:activity.filter(e=>e.taskKey===key).map(e=>({seq:e.seq,action:e.action,actor:e.actor.name}))};},key);
 if(!check.online||!check.comments||check.activity.length<2)throw new Error('Live presence/comment/activity verification failed.');
 await mkdir(new URL('../docs/media/m5/',import.meta.url),{recursive:true});
 await writeFile(new URL('../docs/media/m5/live-check.json',import.meta.url),JSON.stringify({transport:'real stdio sidecar',...check},null,2)+'\n');
 console.log(JSON.stringify({key,online:check.online,comments:check.comments,recentTools:check.recentCalls.map(c=>c.tool),activity:check.activity.map(e=>e.action)}));
}finally{server.stdin.end();lines.close();setTimeout(()=>server.kill(),200).unref();await browser.close();}
