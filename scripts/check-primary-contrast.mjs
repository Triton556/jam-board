import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const css = await readFile(root + "apps/desktop/src/styles/tokens.css", "utf8");
const luminance = (hex) => hex.match(/[a-f0-9]{2}/gi).map(c => parseInt(c,16)/255).map(c => c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4).reduce((n,c,i)=>n+c*[0.2126,0.7152,0.0722][i],0);
const results = [];
for (const [theme, block] of [["light",css.split('[data-theme="dark"]')[0]],["dark",css.split('[data-theme="dark"]')[1].split("@theme")[0]]]) {
  const token = name => block.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`,"i"))[1];
  for(const name of ["primary","primary-hover"]) {
    const bg=token(name), fg=token("on-primary"),a=luminance(bg),b=luminance(fg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    results.push({theme,background:bg,foreground:fg,ratio:Number(ratio.toFixed(3)),pass:ratio>=4.5});
  }
}
const dir=root+"docs/media/0.1.1";await mkdir(dir,{recursive:true});await writeFile(dir+"/primary-contrast.json",JSON.stringify(results,null,2)+"\n");
console.log(results);if(results.some(r=>!r.pass))process.exitCode=1;
