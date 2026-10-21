// Captures the actual WebView2 desktop surface without the Computer Use cursor overlay.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require=createRequire(new URL("../apps/desktop/package.json",import.meta.url));
const {chromium,expect}=require("@playwright/test");
const root=fileURLToPath(new URL("../",import.meta.url));
const media=path.join(root,"docs/media/0.1.1"),data=path.join(root,".dev-data",`capture-011-${Date.now()}`);
await mkdir(media,{recursive:true});await mkdir(data,{recursive:true});
const env={...process.env,JAM_BOARD_DATA_DIR:data,RUST_LOG:"warn"};delete env.JAM_BOARD_DB;delete env.VITE_MOCK_BRIDGE;
const vite=spawn("cmd.exe",["/d","/c","npm run dev -- --port 1420 --strictPort"],{cwd:path.join(root,"apps/desktop"),env,windowsHide:true,stdio:"ignore"});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let app,browser;
try {
  for(let i=0;i<150;i++){try{if((await fetch("http://127.0.0.1:1420")).ok)break;}catch{}await delay(100);}
  app=spawn(path.join(root,"target/debug/jam-board.exe"),[],{cwd:root,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--remote-debugging-port=9223"},windowsHide:false,stdio:"ignore"});
  for(let i=0;i<200;i++){try{browser=await chromium.connectOverCDP("http://127.0.0.1:9223");break;}catch{}await delay(100);}
  if(!browser)throw new Error("No native WebView2");
  const page=await(async()=>{for(let i=0;i<100;i++){const p=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith("http://127.0.0.1:1420"));if(p)return p;await delay(100);}throw new Error("No native page");})();
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  if(await page.evaluate(()=>!!window.__jamMock))throw new Error("Mock capture is forbidden");
  await page.getByRole("button",{name:"Load demo jam",exact:true}).click();await expect(page.getByTestId("task-card")).toHaveCount(22);await page.evaluate(()=>document.fonts.ready);await delay(5200);
  const shots=[];
  const shot=async(name)=>{await page.mouse.move(650,55);await delay(350);await page.screenshot({path:path.join(media,name+".jpg"),type:"jpeg",quality:90});shots.push(name+".jpg");};
  for(const theme of ["light","dark"]){
    await page.getByLabel("Theme",{exact:true}).selectOption(theme);await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
    await page.getByRole("link",{name:"Board",exact:true}).click();await shot(`board-${theme}`);
    await page.getByRole("link",{name:"Table",exact:true}).click();await expect(page.locator(".task-table")).toBeVisible();await shot(`table-${theme}`);
    await page.getByRole("switch",{name:"Show archived"}).click();await shot(`table-archived-${theme}`);await page.getByRole("switch",{name:"Show archived"}).click();
    await page.getByRole("link",{name:"Settings",exact:true}).click();
    for(const section of ["Board","Appearance","About"]){await page.getByRole("navigation",{name:"Settings sections"}).getByRole("button",{name:section,exact:true}).click();await shot(`settings-${section.toLowerCase()}-${theme}`);}
    await page.getByRole("link",{name:"Activity",exact:true}).click();await expect(page.getByRole("radiogroup",{name:"Activity filter"})).toBeVisible();await shot(`activity-${theme}`);
    await page.getByRole("link",{name:"Settings",exact:true}).click();await page.getByRole("navigation",{name:"Settings sections"}).getByRole("button",{name:"Board",exact:true}).click();await page.getByRole("switch",{name:"Story point estimates"}).click();
    await page.getByRole("link",{name:"Board",exact:true}).click();await page.getByRole("button",{name:/Open JB-7:/}).click();await expect(page.getByRole("radiogroup",{name:"Estimate",exact:true})).toBeVisible();await shot(`task-controls-${theme}`);await page.getByRole("button",{name:"Close task",exact:true}).click();
    await page.getByRole("link",{name:"Settings",exact:true}).click();await page.getByRole("navigation",{name:"Settings sections"}).getByRole("button",{name:"Board",exact:true}).click();await page.getByRole("switch",{name:"Story point estimates"}).click();
  }
  if(errors.length)throw new Error(errors.join("\n"));
  await writeFile(path.join(media,"native-capture.json"),JSON.stringify({native:true,mock:false,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight})),dataDirectory:path.relative(root,data),screenshots:shots,pageErrors:errors},null,2)+"\n");console.log(JSON.stringify({screenshots:shots.length,pageErrors:errors.length}));
} finally {
  await browser?.close();
  for(const child of [app,vite])if(child?.exitCode===null){try{execFileSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});}catch{}}
}
