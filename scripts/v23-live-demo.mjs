// Native WebView2 + independent MCP processes. Screenshots contain no desktop cursor overlay.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const root=fileURLToPath(new URL('../',import.meta.url));
const media=path.resolve(root,process.env.JAM_CAPTURE_OUTPUT??'docs/media/v2.3');
const data=path.join(root,'.dev-data',`capture-v23-${Date.now()}`);
await mkdir(media,{recursive:true});await mkdir(data,{recursive:true});
const env={...process.env,JAM_BOARD_DATA_DIR:data,RUST_LOG:'warn'};
delete env.JAM_BOARD_DB;delete env.VITE_MOCK_BRIDGE;
const vite=spawn('cmd.exe',['/d','/c','npm run dev -- --port 1420 --strictPort'],{cwd:path.join(root,'apps/desktop'),env,windowsHide:true,stdio:'ignore'});
let app,browser;const clients=[],transcript=[],captures=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(agentName){
  const child=spawn(path.join(root,'target/debug/jam-board-mcp.exe'),['--db',path.join(data,'jam.db')],{cwd:root,env:{...env,JAM_AGENT_NAME:agentName},windowsHide:true,stdio:['pipe','pipe','ignore']});
  const pending=new Map();let seq=0;
  createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line),p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(new Error(JSON.stringify(r.error))):p.resolve(r.result);}});
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(new Error(`Timeout: ${method}`)),65000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  clients.push({child,pending});
  await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:agentName==='Claude'?'claude-code':'codex',version:'v23-demo'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  return async(name,args={})=>{const r=await request('tools/call',{name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));transcript.push({agent:agentName,tool:name,arguments:args,summary:r.content});return r.structuredContent;};
}
try{
  for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:1420')).ok)break;}catch{}await delay(100);}
  app=spawn(path.join(root,'target/debug/jam-board.exe'),[],{cwd:root,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9223'},windowsHide:false,stdio:'ignore'});
  for(let i=0;i<200;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9223');break;}catch{}await delay(100);}
  if(!browser)throw new Error('Native WebView2 did not start');
  const page=await(async()=>{for(let i=0;i<100;i++){const p=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'));if(p)return p;await delay(100);}throw new Error('No native page');})();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(await page.evaluate(()=>!!window.__jamMock))throw new Error('Native bridge required');
  const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  const route=async target=>{await page.evaluate(target=>{history.pushState(null,'',target);window.dispatchEvent(new PopStateEvent('popstate'));},target);await delay(300);};
  const theme=async value=>{await page.getByLabel('Theme',{exact:true}).selectOption(value);await delay(250);};
  const shot=async name=>{await page.mouse.move(660,54);await delay(400);await page.screenshot({path:path.join(media,`${name}.jpg`),type:'jpeg',quality:88});captures.push(`${name}.jpg`);};
  await page.getByRole('button',{name:'Load demo jam',exact:true}).click();
  await expect(page.getByTestId('task-card')).toHaveCount(22);await page.evaluate(()=>document.fonts.ready);

  await route('/references');await expect(page.getByText('Drop images, sounds, videos or links here')).toBeVisible();
  const remote=[],localRequests={ipc:0,assets:0,vite:0};page.on('request',r=>{const u=new URL(r.url());if(u.hostname==='ipc.localhost')localRequests.ipc++;else if(u.hostname==='asset.localhost')localRequests.assets++;else if(['127.0.0.1','localhost'].includes(u.hostname))localRequests.vite++;else if(['http:','https:'].includes(u.protocol))remote.push(u.hostname);});
  await page.getByRole('button',{name:'Frame',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Lantern mood & materials');await page.getByRole('combobox',{name:'Frame epic'}).click();await page.getByRole('option',{name:'Lantern levels',exact:true}).click();await page.getByRole('button',{name:'Create frame',exact:true}).click();
  let snapshot=await invoke('reference_canvas');const frame=snapshot.frames[0];
  await invoke('update_ref_frame',{input:{id:frame.id,x:40,y:70,w:1120,h:830}});
  const files=['danil-laptop.png','duo-board.png','wife-paint.png','duo-hello.png','danil-wave.png','duo-board-256.webp'].map(name=>path.join(root,'apps/desktop/src/assets/chibi',name));
  const wav=Buffer.alloc(44+44100*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<44100;i++){const envelope=Math.min(1,i/882,(44100-i)/882);wav.writeInt16LE(Math.round(Math.sin(i/44100*Math.PI*440)*.1*32767*envelope),44+i*2);}const wavPath=path.join(data,'lantern-chime.wav');await writeFile(wavPath,wav);files.push(wavPath);
  const drop=await page.locator('.references-page').boundingBox();const ratio=await page.evaluate(()=>devicePixelRatio);
  // Inject the native Tauri drop payload; the production listener and all Rust file checks run unchanged.
  await invoke('plugin:event|emit',{event:'tauri://drag-drop',payload:{paths:files,position:{x:Math.round((drop.x+90)*ratio),y:Math.round((drop.y+150)*ratio)}}});
  await expect.poll(async()=>(await invoke('reference_canvas')).items.length).toBe(7);
  for(const [kind,title,text]of[['Link…','Lantern lighting study','https://example.test/lantern-lighting'],['Note','A small pool of warmth','## Light leads the way\nWarm amber, quiet snow and clear silhouettes.']]){
    await page.getByRole('button',{name:'Add',exact:true}).click();await page.getByRole('button',{name:kind,exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);await page.getByRole('textbox',{name:kind==='Link…'?'URL':'Note',exact:true}).fill(text);await page.getByRole('button',{name:kind==='Link…'?'Add link':'Add note',exact:true}).click();
  }
  snapshot=await invoke('reference_canvas');
  for(const [n,item]of snapshot.items.entries())await invoke('canvas_geometry',{input:{id:item.id,frameId:frame.id,x:24+(n%4)*270,y:64+Math.floor(n/4)*225,w:248,h:190,z:0}});
  await invoke('create_ref_edge',{input:{fromItem:snapshot.items[7].id,toItem:snapshot.items[8].id,label:'warm shapes'}});
  await page.getByRole('button',{name:'Fit view · F'}).click();await delay(600);
  await expect.poll(async()=>{const c=await invoke('reference_canvas');const a=c.items.find(i=>i.title==='lantern-chime');return a?.metadata&&JSON.parse(a.metadata).peaks?.length;}).toBe(64);
  const worker=await connect('Codex'),start=Date.now();
  const agent=await worker('add_reference',{kind:'asset',filePath:files[2],title:'Codex · warm lantern silhouette',caption:'Keep the silhouette readable against the snowy path.',frameEpicKey:'JB-E1',linkTo:'JB-12',x:294,y:514});
  await expect(page.locator('[data-reference-id="'+agent.id+'"][data-highlighted="true"]')).toBeVisible({timeout:1000});const latencyMs=Date.now()-start;
  await theme('light');await shot('canvas-agent-light');
  await worker('update_reference',{itemId:agent.id,caption:'One warm silhouette, a quiet edge, no additional particles.'});await theme('dark');await shot('canvas-agent-dark');
  for(const value of ['light','dark']){await theme(value);await page.getByRole('button',{name:'Fit view · F'}).click();await delay(5300);await shot('canvas-'+value);}
  await theme('light');
  const audioItem=(await invoke('reference_canvas')).items.find(i=>i.title==='lantern-chime');const audioNode=page.locator('[data-reference-id="'+audioItem.id+'"]');await audioNode.getByRole('button',{name:'Play audio'}).click();await expect.poll(()=>audioNode.locator('audio').evaluate(a=>a.paused)).toBe(false);await audioNode.getByRole('button',{name:'Pause audio'}).click();await expect.poll(()=>audioNode.locator('audio').evaluate(a=>a.paused)).toBe(true);await shot('audio-waveform');
  const image=page.locator('[data-reference-id="'+snapshot.items[0].id+'"] .reference-image');await image.click();await expect(page.getByRole('dialog')).toBeVisible();await shot('image-lightbox');await page.getByRole('button',{name:/Close .*laptop/}).click();
  await route('/board?task=JB-12');await page.getByRole('heading',{name:/^References/}).scrollIntoViewIfNeeded();await shot('task-linked-reference');await page.getByRole('button',{name:'Close task',exact:true}).click();
  if(process.env.JAM_CAPTURE_EXTRA==='v25'){
    for(const value of ['light','dark']){
      await theme(value);
      await route('/board');await shot('board-'+value);
      await route('/plan/JB-E1?tab=Stories');await shot('plan-'+value);
      await route('/inbox');await page.locator('.question-card').first().waitFor();await shot('inbox-'+value);
    }
  }
  snapshot=await invoke('reference_canvas');const audio=snapshot.items.find(i=>i.id===audioItem.id),registered=await invoke('list_assets',{input:{kind:null,text:null}});
  if(snapshot.items.length!==10||snapshot.frames.filter(f=>!f.archivedAt).length!==1)throw new Error('Unexpected native canvas counts');if(remote.length)throw new Error('Unexpected remote request: '+remote.join(','));if(errors.length)throw new Error(errors.join('\n'));
  await writeFile(path.join(media,'native-session.json'),JSON.stringify({native:true,mock:false,dataDirectory:path.relative(root,data),dropMethod:'native Tauri drag-drop event injected with seven real paths; production handler and filesystem checks',droppedFiles:files.map(f=>path.relative(root,f)),items:snapshot.items.length,frames:snapshot.frames.filter(f=>!f.archivedAt).length,edges:snapshot.edges.length,audio:{duration:JSON.parse(audio.metadata).duration,peaks:JSON.parse(audio.metadata).peaks.length,playPause:true},agentLatencyMs:latencyMs,referenceAssets:registered.filter(a=>a.role==='reference').length,remoteRequests:remote,localRequests,pageErrors:errors,captures,transcript:transcript.map(t=>({...t,arguments:{...t.arguments,...(t.arguments.filePath?{filePath:path.relative(root,t.arguments.filePath)}:{})}}))},null,2)+'\n');
  console.log(JSON.stringify({native:true,items:snapshot.items.length,latencyMs,captures:captures.length,audioPeaks:64,pageErrors:errors.length,remoteRequests:remote.length}));
}catch(error){await writeFile(path.join(data,'failure.txt'),String(error.stack));if(browser){const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({path:path.join(data,'failure.png')}).catch(()=>{});}throw error;
}finally{
  for(const {child,pending}of clients){for(const p of pending.values())clearTimeout(p.timer);child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),delay(1000)]);if(child.exitCode===null)child.kill();}
  await browser?.close();
  for(const child of [app,vite])if(child?.exitCode===null){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
}
