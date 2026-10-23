import { assertHistoricalCapture } from "./historical-capture-guard.mjs";
assertHistoricalCapture(import.meta.url);

// Uses the native WebView2 and Rust harness runner; folder picker results are injected.
// --install is only for a separately authorized write to the clone's private receipt store.
import{spawn,execFileSync}from'node:child_process';
import{createHash}from'node:crypto';
import{createRequire}from'node:module';
import{mkdir,writeFile,readFile,readdir,rm}from'node:fs/promises';
import{fileURLToPath}from'node:url';
import path from'node:path';
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));const{chromium,expect}=require('@playwright/test');
const root=fileURLToPath(new URL('../',import.meta.url)),media=path.join(root,'docs/media/v2.4b'),data=path.join(root,'.dev-data',`capture-v24b-${Date.now()}`),targets=path.join(root,'.dev-data/skill-install-test'),playbook=path.resolve(root,'../agent-playbook-jam-board-skill'),install=process.argv.includes('--install');
await mkdir(media,{recursive:true});await mkdir(data,{recursive:true});await mkdir(targets,{recursive:true});
const revision=execFileSync('git',['-C',playbook,'rev-parse','--short','HEAD'],{encoding:'utf8',windowsHide:true}).trim();if(revision!=='df75cb8')throw Error('Expected df75cb8');
const before=execFileSync('git',['-C',playbook,'status','--porcelain'],{encoding:'utf8',windowsHide:true});
if(before!=='')throw Error('Playbook porcelain must be empty before the run');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const receiptDir=path.join(playbook,'.harness-state/receipts');
const receiptSnapshot=async()=>{const files=await readdir(receiptDir).catch(e=>{if(e.code==='ENOENT')return [];throw e});return new Map(await Promise.all(files.filter(n=>n.endsWith('.json')).map(async n=>[n,hash(await readFile(path.join(receiptDir,n)))])))};
const initialReceipts=await receiptSnapshot();
const gitRead=args=>execFileSync('git',['-C',playbook,...args],{encoding:'utf8',windowsHide:true}).trim();
const checkoutIdentity=async()=>({head:gitRead(['rev-parse','HEAD']),branch:gitRead(['branch','--show-current']),configSha256:hash(await readFile(path.resolve(playbook,gitRead(['rev-parse','--git-path','config']))))});
const identityBefore=await checkoutIdentity();
const env={...process.env,JAM_BOARD_DATA_DIR:data,RUST_LOG:'warn'};delete env.JAM_BOARD_DB;delete env.VITE_MOCK_BRIDGE;
const vite=spawn('cmd.exe',['/d','/c','npm run dev -- --port 1420 --strictPort'],{cwd:path.join(root,'apps/desktop'),env,windowsHide:true,stdio:'ignore'});let app,browser;const created=[],captures=[],results=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:1420')).ok)break}catch{}await delay(100)}
 app=spawn(path.join(root,'target/debug/jam-board.exe'),[],{cwd:root,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9223'},windowsHide:false,stdio:'ignore'});
 for(let i=0;i<200;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9223');break}catch{}await delay(100)}if(!browser)throw Error('No native WebView2');
 let page;for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'));if(page)break;await delay(100)}if(!page)throw Error('No native page');const errors=[],remote=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!['127.0.0.1','localhost','ipc.localhost','asset.localhost','tauri.localhost'].includes(u.hostname))remote.push(u.hostname)});if(await page.evaluate(()=>!!window.__jamMock))throw Error('Mock bridge forbidden');
 const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
 const shot=async name=>{await page.mouse.move(660,54);await delay(350);await page.screenshot({path:path.join(media,name+'.jpg'),type:'jpeg',quality:88});captures.push(name+'.jpg')};
 const setTheme=async theme=>{await invoke('set_theme',{theme});await page.evaluate(async()=>{const{api}=await import('/src/lib/api.ts');const{useUiStore}=await import('/src/lib/ui-store.ts');const state=await api.appState();document.documentElement.dataset.theme=state.theme;});};
 await page.getByRole('button',{name:'Game jam',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);for(const theme of['light','dark']){await setTheme(theme);await shot('templates-'+theme)}await setTheme('light');
 await page.getByRole('button',{name:'Web app',exact:true}).click();await page.getByLabel('Project name',{exact:true}).fill('Lantern web companion');await page.getByLabel('Milestone (optional)').fill('2026-11-30T18:00');await page.getByLabel('Your name',{exact:true}).fill('Danil');await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.getByRole('heading',{name:/The product board/})).toBeVisible();await expect(page.getByText('Milestone · Nov 30')).toBeVisible();await expect(page.getByRole('timer')).toHaveCount(0);
 await page.getByRole('link',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'Your project',exact:true})).toBeVisible();for(const theme of['light','dark']){await setTheme(theme);await shot('project-'+theme)}await setTheme('light');await page.getByRole('button',{name:'Agents',exact:true}).click();
 for(const client of['codex','claude']){
  const target=path.join(targets,`${client}-${Date.now()}`);await mkdir(target);created.push(target);
  await page.evaluate(async({target,playbook})=>{const{api}=await import('/src/lib/api.ts');let n=0;api.pickFolder=async()=>++n===1?target:playbook;},{target,playbook});
  await page.getByRole('button',{name:'Choose project folder…',exact:true}).click();await page.getByRole('button',{name:'Choose playbook folder…',exact:true}).click();await page.getByRole('combobox',{name:'Skill client'}).click();await page.getByRole('option',{name:client==='codex'?'Codex':'Claude Code',exact:true}).click();await page.getByRole('button',{name:'Check setup',exact:true}).click();await expect(page.getByText('Playbook 1.3.0')).toBeVisible();await expect(page.getByRole('button',{name:'Run install',exact:true})).toBeEnabled();
  for(const theme of ['light','dark']){await setTheme(theme);await page.getByRole('heading',{name:'Give your agent the skill',exact:true}).scrollIntoViewIfNeeded();await shot(client+'-setup-'+theme);}await setTheme('light');await page.getByRole('button',{name:'Run install',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('This adds files to that project.');
  if(install){await page.getByRole('dialog').getByRole('button',{name:'Install',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Installed · verified'})).toBeVisible({timeout:125000});const skills=path.join(target,client==='codex'?'.agents/skills':'.claude/skills');const installed=await readFile(path.join(skills,'jam-board/SKILL.md'),'utf8');if(!/^name: jam-board\s*$/m.test(installed))throw Error('Missing installed skill name');const receiptName=hash(Buffer.from(target+'\n'+client))+'.json';if(initialReceipts.has(receiptName))throw Error('Fresh target receipt already existed');
   const receipt=await readFile(path.join(receiptDir,receiptName));const destination=await readFile(path.join(target,client==='codex'?'.agents':'.claude','harness-install.json'));if(!receipt.equals(destination))throw Error('Trusted and destination receipts differ');
   results.push({client,uiLabel:client==='codex'?'Codex':'Claude Code',profile:'jam-board',plan:0,install:0,verify:0,skillName:'jam-board',skillNameLine:'name: jam-board',receipt:'.harness-state/receipts/'+receiptName,target:path.relative(root,target)});
   for(const theme of['light','dark']){await setTheme(theme);await page.getByRole('log').evaluate(el=>{el.scrollTop=el.scrollHeight});await page.getByRole('status').filter({hasText:'Installed · verified'}).evaluate(el=>el.closest('.settings-form-row').scrollIntoView({block:'center'}));await shot(client+'-installed-'+theme)}
   const removeArgs=['-3','-B',path.join(playbook,'harness.py'),'remove','--client',client,'--target',target];
   const removalPlan=JSON.parse(execFileSync('py',[...removeArgs,'--dry-run'],{cwd:playbook,env:{...env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8',windowsHide:true}));if(removalPlan.status!=='removal-planned')throw Error('Unexpected removal plan');
   const removed=JSON.parse(execFileSync('py',removeArgs,{cwd:playbook,env:{...env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8',windowsHide:true}));if(removed.status!=='removed')throw Error('Harness removal failed');
   if((await receiptSnapshot()).has(receiptName))throw Error('Own receipt survived harness remove');
   Object.assign(results.at(-1),{cleanup:{dryRun:removalPlan.status,status:removed.status,method:'harness.py remove',receiptRemoved:true}});
  }else{for(const theme of ['light','dark']){await setTheme(theme);await shot(client+'-plan-confirmation-'+theme);}await setTheme('light');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();results.push({client,profile:'jam-board',plan:0,install:'BLOCKED: read-only clone requires receipt write',verify:'NOT_RUN'});}
 }
 const after=execFileSync('git',['-C',playbook,'status','--porcelain'],{encoding:'utf8',windowsHide:true});if(after!=='')throw Error('Playbook porcelain must be empty after the run');const identityAfter=await checkoutIdentity();if(JSON.stringify(identityAfter)!==JSON.stringify(identityBefore))throw Error('Playbook HEAD, branch or config changed');const finalReceipts=await receiptSnapshot();for(const[name,digest]of initialReceipts){if(finalReceipts.get(name)!==digest)throw Error('Pre-existing receipt changed');}if(errors.length)throw Error(errors.join('\n'));if(remote.length)throw Error('Unexpected external request');
 await writeFile(path.join(media,'native-session.json'),JSON.stringify({native:true,mock:false,folderSelection:'injected picker results; real native validation and runner',revision,installAuthorized:install,playbookSourceUnchanged:true,porcelain:{before,after},checkout:{before:identityBefore,after:identityAfter},receipts:{preExistingUnchanged:initialReceipts.size,created:results.filter(r=>r.receipt).map(r=>r.receipt),retained:results.filter(r=>r.receipt&&finalReceipts.has(path.basename(r.receipt))).map(r=>r.receipt)},results,captures,pageErrors:errors,remoteRequests:remote,temporaryTargetsRemoved:true},null,2)+'\n');console.log(JSON.stringify({native:true,install,results,captures:captures.length}));
}finally{
 await browser?.close();for(const child of[app,vite])if(child?.exitCode===null){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{}}
 for(const target of created){const absolute=path.resolve(target),base=path.resolve(targets);if(!absolute.startsWith(base+path.sep))throw Error('Unsafe cleanup');await rm(absolute,{recursive:true,force:true})}
}
