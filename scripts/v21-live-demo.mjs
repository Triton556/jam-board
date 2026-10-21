// Real debug desktop and independent stdio sessions; CDP captures no desktop cursor overlay.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require=createRequire(new URL("../apps/desktop/package.json",import.meta.url));
const {chromium,expect}=require("@playwright/test");
const root=fileURLToPath(new URL("../",import.meta.url));
const media=path.join(root,"docs/media/v2.1");
const data=path.join(root,".dev-data",`capture-v21-${Date.now()}`);
await mkdir(media,{recursive:true});await mkdir(data,{recursive:true});
const env={...process.env,JAM_BOARD_DATA_DIR:data,RUST_LOG:"warn"};
delete env.JAM_BOARD_DB;delete env.VITE_MOCK_BRIDGE;
const vite=spawn("cmd.exe",["/d","/c","npm run dev -- --port 1420 --strictPort"],{cwd:path.join(root,"apps/desktop"),env,windowsHide:true,stdio:"ignore"});
let app,browser;const clients=[];const transcript=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(agentName){
  const child=spawn(path.join(root,"target/debug/jam-board-mcp.exe"),["--db",path.join(data,"jam.db")],{cwd:root,env:{...env,JAM_AGENT_NAME:agentName},windowsHide:true,stdio:["pipe","pipe","ignore"]});
  const pending=new Map();let seq=0;
  createInterface({input:child.stdout}).on("line",line=>{const r=JSON.parse(line);const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(new Error(JSON.stringify(r.error))):p.resolve(r.result);}});
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(new Error(`Timeout: ${method}`)),65000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");});
  clients.push({child,pending});
  await request("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:agentName==="Claude"?"claude-code":"codex",version:"v21-demo"}});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");
  return async(name,args={})=>{const r=await request("tools/call",{name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));transcript.push({agent:agentName,tool:name,arguments:args,summary:r.content});return r.structuredContent;};
}
try{
  for(let i=0;i<150;i++){try{if((await fetch("http://127.0.0.1:1420")).ok)break;}catch{}await delay(100);}
  app=spawn(path.join(root,"target/debug/jam-board.exe"),[],{cwd:root,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--remote-debugging-port=9223"},windowsHide:false,stdio:"ignore"});
  for(let i=0;i<200;i++){try{browser=await chromium.connectOverCDP("http://127.0.0.1:9223");break;}catch{}await delay(100);}
  if(!browser)throw new Error("Native WebView2 did not start");
  const page=await(async()=>{for(let i=0;i<100;i++){const p=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith("http://127.0.0.1:1420"));if(p)return p;await delay(100);}throw new Error("No native page");})();
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  if(await page.evaluate(()=>!!window.__jamMock))throw new Error("Capture must use the native bridge");
  const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  await page.getByRole("button",{name:"Load demo jam",exact:true}).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);await page.evaluate(()=>document.fonts.ready);await delay(5300);
  // A normal human reorder makes the returned task visible above the fold.
  await invoke("move_task",{input:{key:"JB-7",status:"ready",beforeKey:"JB-2",afterKey:null,overrideReason:null}});
  const shot=async name=>{await page.mouse.move(600,55);await page.screenshot({path:path.join(media,`${name}.png`)});};
  for(const theme of ["light","dark"]){await page.getByLabel("Theme",{exact:true}).selectOption(theme);await page.locator('.board-scroll').evaluate(e=>e.scrollTop=0);await delay(350);await shot(`board-${theme}`);}
  await page.getByLabel("Theme",{exact:true}).selectOption("light");
  const brain=await connect("Claude"),worker=await connect("Codex");
  await brain("set_status",{text:"interviewing about the second lantern route"});
  for(const title of ["Who is the route for?","Keep keyboard controls?","How long should a route take?"]){const q=await brain("ask_user",{scope:{type:"project",id:""},title,roundLabel:"Round 1",options:[{label:"Keep the cozy prototype",description:"One short route for keyboard players"}],recommendedIndex:0});await invoke("answer_question",{input:{id:q.id,answerIndex:0,answerText:null}});}
  const epic=await brain("create_epic",{title:"Lantern route playtest",goalMd:"A fresh keyboard player can cross a short snowy route without guessing.",doneWhenMd:"The next-tile cue passes all named bridge checks.",notIncludedMd:"No new engine, inventory or multiplayer.",workerModel:"gpt-6.1-sol",participation:"first_sketch",reviewer:"final"});
  await brain("become_brain",{epicKey:epic.key});await brain("set_epic_status",{key:epic.key,status:"active"});
  const stories=[];
  for(const title of ["Readable route cues","Controller and playtest checks"]){const s=await brain("create_story",{epicKey:epic.key,title,outcomeMd:"A player follows the lantern safely across the bridge.",basisMd:"The accepted lantern prototype.",preserveMd:"Keep the jump arc and action names.",scaleMd:"One scene and focused tests.",rejectionRisksMd:"Ambiguous cue, hidden tile, delayed interaction.",openDecisionsMd:"None after the first interview round.",acceptance:[{id:"1",criterion:"Only the adjacent safe tile lights up",mandatory:true,check:"Play the bridge scene with keyboard controls"}]});await brain("set_story_status",{key:s.key,status:"active"});stories.push(s);}
  const tasks=[];
  for(let i=0;i<4;i++)tasks.push(await brain("create_task",{storyKey:stories[i<2?0:1].key,title:["Lantern cue: illuminate one safe tile","Preserve the snow edge at full glow","Keyboard bridge playtest","Controller bridge playtest"][i],goalMd:"Read the next safe step without guessing.",contextMd:"The bridge scene and lantern input already work.",whereMd:"game/bridge/tile_cue.gd and tests/bridge.gd",changes:[{title:"Safe-tile cue",now:"Two neighboring tiles can light up",cause:"The radius includes the second tile",required:"Illuminate only the adjacent safe tile",where:"Bridge scene",follow:"Accepted warm lantern palette",keep:"Existing action names and jump arc"}],tests:[{setup:"Hold the lantern at the bridge entrance",expected:"Exactly one safe tile lights up"}],boundariesMd:"No new engine, hosted services or broad refactor.",resultMd:"Submit summary, changed files, named test commands with expected/actual/results, deviations and unverified checks."}));
  for(const t of tasks)await brain("mark_ready",{key:t.key});
  await worker("claim_task",{key:tasks[0].key});
  await worker("submit_report",{key:tasks[0].key,summaryMd:"Added the tile cue; the edge case still needs correction.",changedFiles:["game/bridge/tile_cue.gd"],tests:[{name:"2",command:"godot --headless --script tests/bridge.gd",expected:"One safe tile lights up",actual:"Two tiles light up at the boundary",result:"FAIL"}],notVerifiedMd:"Controller hardware is not connected."});
  const reviewStarted=Date.now();
  await brain("review_task",{key:tasks[0].key,verdict:"changes_requested",commentsMd:"Limit the radius to the adjacent safe tile and repeat test 2.",failedTests:["2"]});
  await brain("set_status",{text:`reviewed ${tasks[0].key}; waiting for the corrected cue`,scope:{type:"epic",id:epic.key}});
  const journal=await invoke("epic_journal",{epicKey:epic.key,after:0});
  if(!journal.some(e=>e.sentence===`Claude returned ${tasks[0].key}: tests 2 failed`))throw new Error("Missing review journal row");
  await expect(page.locator(`[data-key="${tasks[0].key}"]`)).toContainText("Changes requested",{timeout:1000});
  const reviewUiLatencyMs=Date.now()-reviewStarted;
  if(reviewUiLatencyMs>1000)throw new Error("Review flag did not reach the native board within one second");
  await page.locator(`[data-key="${tasks[0].key}"]`).scrollIntoViewIfNeeded();await shot("agent-review-return");
  await page.getByRole("button",{name:new RegExp(`Open ${tasks[0].key}:`)}).click();
  await page.getByTestId("task-brief").scrollIntoViewIfNeeded();await shot("task-brief");
  await page.getByRole("region",{name:"Latest report"}).scrollIntoViewIfNeeded();await shot("task-report-review");
  await page.getByRole("region",{name:"Latest review"}).evaluate(e=>e.scrollIntoView({block:"center"}));await delay(250);await shot("task-review");
  if(errors.length)throw new Error(errors.join("\n"));
  await writeFile(path.join(media,"native-session.json"),JSON.stringify({native:true,mock:false,dataDirectory:path.relative(root,data),taskCount:26,epicKey:epic.key,taskKey:tasks[0].key,clientNames:["Claude","Codex"],humanAnswers:3,reviewUiLatencyMs,transcript,journal:journal.map(e=>({seq:e.seq,action:e.action,sentence:e.sentence})),pageErrors:errors},null,2)+"\n");
  console.log(JSON.stringify({native:true,taskCount:26,journalRows:journal.length,screenshots:6,pageErrors:errors.length}));
}finally{
  for(const {child,pending}of clients){for(const p of pending.values())clearTimeout(p.timer);child.stdin.end();await Promise.race([new Promise(r=>child.once("exit",r)),delay(2000)]);if(child.exitCode===null)child.kill();}
  await browser?.close();
  for(const child of [app,vite])if(child?.exitCode===null){try{execFileSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});}catch{}}
}
