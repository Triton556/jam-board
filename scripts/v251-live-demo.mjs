// Real native window and stdio MCP fixture, not an AI worker session.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const media=path.join(root,'docs/media/v2.5.1'),data=path.join(root,'.dev-data',`capture-v251-${Date.now()}`);
await mkdir(media,{recursive:true});await mkdir(path.join(data,'frames'),{recursive:true});
const env={...process.env,JAM_BOARD_DATA_DIR:data,RUST_LOG:'warn'};
delete env.JAM_BOARD_DB;delete env.VITE_MOCK_BRIDGE;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const vite=spawn('cmd.exe',['/d','/c','npm run dev -- --port 1420 --strictPort'],{cwd:path.join(root,'apps/desktop'),env,windowsHide:true,stdio:'ignore'});
let app,browser,client;const pending=new Map(),transcript=[];
try {
  for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:1420')).ok)break;}catch{}await delay(100);}
  app=spawn(path.join(root,'target/debug/jam-board.exe'),[],{cwd:root,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9223'},windowsHide:true,stdio:'ignore'});
  for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9223');break;}catch{}await delay(100);}
  if(!browser)throw Error('Native CDP unavailable');
  let page;
  for(let i=0;i<100&&!page;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'));if(!page)await delay(100);}
  if(!page||await page.evaluate(()=>!!window.__jamMock))throw Error('Expected real native bridge');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'Load demo jam',exact:true}).click();
  await expect(page.getByTestId('task-card')).toHaveCount(22);
  await page.evaluate(()=>document.fonts.ready);
  client=spawn(path.join(root,'target/debug/jam-board-mcp.exe'),[],{cwd:root,env:{...env,JAM_AGENT_NAME:'Worker'},windowsHide:true,stdio:['pipe','pipe','ignore']});
  let sequence=0;
  createInterface({input:client.stdout}).on('line',line=>{const r=JSON.parse(line),p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}});
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('MCP timeout: '+method)),65000);pending.set(id,{resolve,reject,timer});client.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'codex',version:'v251-native-fixture'}});
  client.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const tool=async(name,args={})=>{const r=await request('tools/call',{name,arguments:args});if(r.isError)throw Error(JSON.stringify(r.content));transcript.push({name,arguments:args});return r.structuredContent;};
  const tasks=await tool('list_tasks',{status:['ready'],assignee:'unassigned'}),key=tasks.tasks[0]?.key;
  if(!key)throw Error('No Ready task');
  const first=(await tool('list_tasks',{status:['in_progress']})).tasks[0]?.key;
  await tool('claim_task',{key});
  if(first)await tool('move_task',{key,status:'in_progress',beforeKey:first});
  const start=Date.now();
  await tool('set_status',{text:'implementing snow trails',scope:{type:'task',id:key}});
  const card=page.locator(`[data-testid="task-card"][data-key="${key}"]`);
  await expect(card.getByTestId('working-line')).toHaveText('Worker · implementing snow trails',{timeout:1000});
  const arrivalMs=Date.now()-start;
  await card.scrollIntoViewIfNeeded();await delay(4500);
  const captures=[];
  const shot=async name=>{await page.mouse.move(660,30);await delay(250);await page.screenshot({path:path.join(media,name+'.jpg'),type:'jpeg',quality:90});captures.push(name+'.jpg');};
  await page.getByLabel('Theme',{exact:true}).selectOption('light');
  await shot('board-light');await card.screenshot({path:path.join(media,'working-card-light.png')});
  const cdp=await page.context().newCDPSession(page),frames=[],writes=[];
  cdp.on('Page.screencastFrame',e=>{const name=String(frames.length).padStart(5,'0')+'.jpg';frames.push({name,at:e.metadata.timestamp});writes.push(writeFile(path.join(data,'frames',name),Buffer.from(e.data,'base64')));void cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId});});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:78,maxWidth:1360,maxHeight:860,everyNthFrame:2});
  await delay(6500);await cdp.send('Page.stopScreencast');await cdp.detach();await Promise.all(writes);
  await writeFile(path.join(data,'frames.json'),JSON.stringify(frames));
  for(const theme of ['light','dark']){
    await page.getByLabel('Theme',{exact:true}).selectOption(theme);await shot('board-'+theme);
    await card.screenshot({path:path.join(media,'working-card-'+theme+'.png')});
    await card.click();await expect(page.getByTestId('working-pill')).toBeVisible();await shot('task-panel-'+theme);
    await page.keyboard.press('Escape');
    await page.goto('http://127.0.0.1:1420/table?q='+key);await expect(page.locator(`[data-task-key="${key}"]`)).toHaveAttribute('data-working','active');await shot('table-'+theme);
    await page.goto('http://127.0.0.1:1420/board');await card.scrollIntoViewIfNeeded();
  }
  if(errors.length||frames.length<10)throw Error('Invalid native capture: '+errors.join(';'));
  await writeFile(path.join(media,'native-session.json'),JSON.stringify({native:true,mock:false,fixture:'Scripted MCP client, not an AI session; isolated demo only',dataDirectory:path.relative(root,data),taskKey:key,arrivalMs,sourceFrames:frames.length,sourceSeconds:frames.at(-1).at-frames[0].at,sourceData:path.relative(root,data),cursorOverlay:false,pageErrors:errors,transcript,captures},null,2)+'\n');
  await writeFile(path.join(root,'.dev-data/v251-capture.json'),JSON.stringify({data,media}));
  console.log(JSON.stringify({native:true,key,arrivalMs,frames:frames.length,captures:captures.length}));
}finally{
  for(const p of pending.values())clearTimeout(p.timer);
  client?.stdin.end();await delay(200);if(client?.exitCode===null)client.kill();
  await browser?.close();
  for(const p of [app,vite])if(p?.exitCode===null){try{execFileSync('taskkill.exe',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
}

// Encode the native frames with Chrome's built-in VP9 encoder, no new tools.
const receipt=JSON.parse(await readFile(path.join(media,'native-session.json'),'utf8'));
const frames=JSON.parse(await readFile(path.join(data,'frames.json'),'utf8'));
const images=[];
for(let n=0;n<90;n++){
 const time=frames[0].at+n/15;
 const frame=frames.findLast(f=>f.at<=time)??frames[0];
 images.push((await readFile(path.join(data,'frames',frame.name))).toString('base64'));
}
const encoder=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await encoder.newPage();
 const encoded=await page.evaluate(async images=>{
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=607;const ctx=canvas.getContext('2d'),stream=canvas.captureStream(15),parts=[];
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1800000});recorder.ondataavailable=e=>parts.push(e.data);
  const stopped=new Promise(r=>recorder.onstop=r);recorder.start();
  for(const bytes of images){const image=new Image();image.src='data:image/jpeg;base64,'+bytes;await image.decode();ctx.drawImage(image,0,0,960,607);await new Promise(r=>setTimeout(r,1000/15));}
  recorder.stop();await stopped;for(const track of stream.getTracks())track.stop();
  return Array.from(new Uint8Array(await new Blob(parts,{type:'video/webm'}).arrayBuffer()));
 },images);
  await writeFile(path.join(media,'working.webm'),Buffer.from(encoded));
  receipt.video={width:960,nominalSeconds:6,bytes:(await stat(path.join(media,'working.webm'))).size};
  receipt.video.playback=await page.evaluate(async bytes=>{
    const video=document.createElement('video');video.src=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'video/webm'}));
    await new Promise((r,j)=>{video.onloadeddata=r;video.onerror=()=>j(Error('Video decode failed'));});
    video.muted=true;await video.play();await new Promise(r=>setTimeout(r,500));video.pause();
    return {seconds:video.duration,width:video.videoWidth,height:video.videoHeight,decodedFrames:video.getVideoPlaybackQuality().totalVideoFrames};
  },encoded);
  if(receipt.video.playback.seconds<5||receipt.video.playback.seconds>8||receipt.video.playback.decodedFrames<2)throw Error('Video playback budget failed');
 await writeFile(path.join(media,'native-session.json'),JSON.stringify(receipt,null,2)+'\n');
}finally{await encoder.close();}
