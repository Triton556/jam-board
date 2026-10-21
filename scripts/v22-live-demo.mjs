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
const media=path.join(root,'docs/media/v2.2');
const data=path.join(root,'.dev-data',`capture-v22-${Date.now()}`);
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
  await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:agentName==='Claude'?'claude-code':'codex',version:'v22-demo'}});
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
  const brain=await connect('Claude'),worker=await connect('Codex');
  await brain('set_status',{text:'interviewing about the next lantern route'});
  const interview=[];
  for(const title of ['Who is the new route for?','Keep the existing keyboard controls?','How long should the playtest route take?']){
    interview.push(await brain('ask_user',{scope:{type:'project',id:''},title,bodyMd:'Keep the next change small enough to check in one playtest.',roundLabel:'Round 1',options:[{label:'Keep the cozy prototype',description:'A short keyboard route for first-time players'},{label:'Expand the route',description:'Add another bridge before the playtest'}],recommendedIndex:0}));
  }
  await page.getByRole('link',{name:'Inbox',exact:true}).click();
  await expect(page.getByRole('article',{name:`Question: ${interview[0].title}`})).toBeVisible();
  await delay(5300);
  for(const value of ['light','dark']){await theme(value);await shot(`inbox-${value}`);}
  await theme('light');
  for(const q of interview){const card=page.getByRole('article',{name:`Question: ${q.title}`});await card.getByRole('button',{name:/Keep the cozy prototype/}).click();await card.getByRole('button',{name:'Answer',exact:true}).click();await expect(card).not.toBeVisible();}
  const epic=await brain('create_epic',{title:'Lantern route playtest',goalMd:'A fresh keyboard player can cross a short snowy route without guessing.',doneWhenMd:'The next-tile cue passes every named bridge check.',notIncludedMd:'No new engine, inventory or multiplayer.',decidedMd:'Keep the warm palette, keyboard controls and a two-minute route.',openQuestionsMd:'Check the bridge edge with the first playtester.',workerModel:'gpt-6.1-sol',participation:'first_sketch',reviewer:'final'});
  await brain('become_brain',{epicKey:epic.key});await brain('set_epic_status',{key:epic.key,status:'active'});
  const stories=[];
  for(const title of ['Readable route cues','Controller and playtest checks']){const s=await brain('create_story',{epicKey:epic.key,title,outcomeMd:'A player follows the lantern safely across the bridge.',basisMd:'The accepted lantern prototype.',preserveMd:'Keep the jump arc and action names.',scaleMd:'One scene and focused tests.',rejectionRisksMd:'Ambiguous cue, hidden tile, delayed interaction.',openDecisionsMd:'None after Round 1.',acceptance:[{id:'1',criterion:'Only the adjacent safe tile lights up',mandatory:true,check:'Play the bridge scene with keyboard controls'}]});await brain('set_story_status',{key:s.key,status:'active'});stories.push(s);}
  const tasks=[];
  for(let i=0;i<4;i++)tasks.push(await brain('create_task',{storyKey:stories[i<2?0:1].key,title:['Lantern cue: illuminate one safe tile','Preserve the snow edge at full glow','Keyboard bridge playtest','Controller bridge playtest'][i],goalMd:'Read the next safe step without guessing.',contextMd:'The bridge scene and lantern input already work.',whereMd:'game/bridge/tile_cue.gd and tests/bridge.gd',changes:[{title:'Safe-tile cue',now:'Two neighboring tiles can light up',cause:'The radius includes the second tile',required:'Illuminate only the adjacent safe tile',where:'Bridge scene',follow:'Accepted warm lantern palette',keep:'Existing action names and jump arc'}],tests:[{setup:'Hold the lantern at the bridge entrance',expected:'Exactly one safe tile lights up'}],boundariesMd:'No new engine, hosted services or broad refactor.',resultMd:'Submit summary, files, named test commands with expected/actual/results, deviations and unverified checks.'}));
  for(const t of tasks)await brain('mark_ready',{key:t.key});
  await route(`/plan/${epic.key}`);await expect(page.getByRole('textbox',{name:'Epic title',exact:true})).toHaveValue(epic.title);
  await worker('claim_task',{key:tasks[0].key});
  await worker('submit_report',{key:tasks[0].key,summaryMd:'Added the tile cue; the boundary case still needs correction.',changedFiles:['game/bridge/tile_cue.gd'],tests:[{name:'2',command:'godot --headless --script tests/bridge.gd',expected:'One safe tile lights up',actual:'Two tiles light up at the boundary',result:'FAIL'}],deviationsMd:'No changes outside the bridge scene.',notVerifiedMd:'Controller hardware is not connected.'});
  await page.getByRole('radio',{name:'Stories',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`${tasks[0].key} ${tasks[0].title}`)}).click();
  await expect(page.getByRole('region',{name:'Latest report',exact:true})).toContainText('FAIL');
  await page.getByRole('button',{name:'Request changes…',exact:true}).click();
  const review=page.getByRole('dialog',{name:'Request changes',exact:true});
  await review.getByRole('textbox',{name:'Review comments'}).fill('Limit the radius to the adjacent tile and repeat test 2.');
  await review.getByRole('checkbox').first().check();
  await review.getByRole('button',{name:'Request changes',exact:true}).click();
  await expect(page.getByRole('region',{name:'Latest review',exact:true})).toContainText('Changes requested');
  await page.getByRole('button',{name:'Close task',exact:true}).click();
  await worker('ask_user',{scope:{type:'task',id:tasks[0].key},title:'Should the cue fade at the snowy edge?',bodyMd:'The edge test exposes two plausible visual treatments.',roundLabel:'Implementation',options:[{label:'Keep one warm tile',description:'Match the accepted brief and repeat test 2'},{label:'Let it glow beyond the bridge',description:'Broaden the visual cue'}],recommendedIndex:0});
  await worker('set_status',{text:`refining the boundary cue for ${tasks[0].key}`,scope:{type:'task',id:tasks[0].key}});
  await brain('set_status',{text:`waiting for the corrected report on ${tasks[0].key}`,scope:{type:'epic',id:epic.key}});
  await invoke('move_task',{input:{key:tasks[0].key,status:'ready',beforeKey:'JB-2',afterKey:null,overrideReason:null}});
  await delay(5300);
  for(const value of ['light','dark']){
    await theme(value);
    await route(`/plan/${epic.key}?tab=Overview`);await expect(page.getByRole('button',{name:'Edit Goal and audience',exact:true})).toBeVisible();await shot(`plan-overview-${value}`);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();await shot(`plan-stories-${value}`);
    await page.getByRole('radio',{name:'Journal',exact:true}).click();await expect(page.getByTestId('journal-scroll')).toContainText('returned');await shot(`plan-journal-${value}`);
    await route('/board');await expect(page.getByTestId('task-card')).toHaveCount(26);await shot(`board-${value}`);
    await page.getByRole('button',{name:new RegExp(`Open ${tasks[0].key}:`)}).click();
    await page.locator('.drawer').evaluate(e=>e.scrollTop=0);await shot(`task-brief-${value}`);
    const guardrails=page.locator('[data-brief-field="change"] details[open] summary');
    if(await guardrails.count())await guardrails.click();
    await page.locator('[data-brief-field="change"]').evaluate(e=>e.scrollIntoView({block:'start'}));await page.locator('.drawer').evaluate(e=>e.scrollTop-=72);await shot(`task-changes-${value}`);
    await page.locator('.round').first().evaluate(e=>e.scrollIntoView({block:'start'}));await page.locator('.drawer').evaluate(e=>e.scrollTop-=64);await shot(`task-rounds-${value}`);
    await page.getByRole('button',{name:'Close task',exact:true}).click();
  }
  const journal=await invoke('epic_journal',{epicKey:epic.key,after:0});
  if(!journal.some(e=>e.action==='review.recorded' && e.actor.kind==='human'))throw new Error('Human review missing from journal');
  if(errors.length)throw new Error(errors.join('\n'));
  await writeFile(path.join(media,'native-session.json'),JSON.stringify({native:true,mock:false,dataDirectory:path.relative(root,data),epicKey:epic.key,taskKey:tasks[0].key,humanAnswersViaInbox:3,humanReviewViaPanel:true,captures,transcript,journal:journal.map(e=>({seq:e.seq,action:e.action,sentence:e.sentence})),pageErrors:errors},null,2)+'\n');
  console.log(JSON.stringify({native:true,captures:captures.length,journalRows:journal.length,humanAnswersViaInbox:3,humanReviewViaPanel:true,pageErrors:errors.length}));
}catch(error){await writeFile(path.join(data,'failure.txt'),String(error.stack));if(browser){const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({path:path.join(data,'failure.png')}).catch(()=>{});}throw error;
}finally{
  for(const {child,pending}of clients){for(const p of pending.values())clearTimeout(p.timer);child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),delay(1000)]);if(child.exitCode===null)child.kill();}
  await browser?.close();
  for(const child of [app,vite])if(child?.exitCode===null){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
}
