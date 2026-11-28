const {open}=require('../round1/lib.cjs');const fs=require('fs');
const [ship,w,h,thr,tag,view]=[process.argv[2],+process.argv[3],+process.argv[4],+process.argv[5],process.argv[6]||'x',process.argv[7]||'holo'];
(async()=>{const {b,page,msgs,cdp}=await open({w,h});
await cdp.send('Performance.enable');
if(thr>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:thr});
const R={ship,w,thr,view};if(process.env.ND)await page.addInitScript(()=>localStorage.setItem('sc.nodefer','1'));const t0=Date.now();
await page.goto('http://127.0.0.1:4360/codex/ship/'+ship+'?view='+view,{waitUntil:'commit'});
await page.waitForSelector('h1',{state:'visible',timeout:120000});R.h1ms=Date.now()-t0;
await page.waitForSelector('sc-codex-holo-stage canvas, sc-codex-holo-stage svg',{state:'visible',timeout:120000}).catch(()=>{});R.stageMs=Date.now()-t0;
await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(4000);
const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));R.nodes=m.Nodes;
R.lt=await page.evaluate(()=>({n:window.__long.length,max:Math.max(0,...window.__long.map(x=>x[1])),sum:window.__long.reduce((a,x)=>a+x[1],0),cls:+window.__cls.toFixed(3)}));
R.byHost=await page.evaluate(()=>{const o={};document.querySelectorAll('*').forEach(e=>{});for(const h of document.querySelectorAll('[class*=ng-star],*')){}
 const hosts=[...document.querySelectorAll('*')].filter(e=>e.tagName.startsWith('SC-'));const own=new Map();
 for(const h of hosts){let n=h.querySelectorAll('*').length;for(const c of h.querySelectorAll('*')){}own.set(h,n)}
 const res={};for(const h of hosts){let n=own.get(h);const t=h.tagName.toLowerCase();res[t]=Math.max(res[t]||0,n)}
 return Object.entries(res).sort((a,b)=>b[1]-a[1]).slice(0,8)});
R.layoutNodes=await page.evaluate(()=>[...document.querySelectorAll('sc-codex-hardpoint-layout')].map(e=>e.querySelectorAll('*').length));
R.small=await page.evaluate(()=>{const out={};for(const e of document.querySelectorAll('body *')){if(e.children.length||!e.textContent.trim())continue;const fs=parseFloat(getComputedStyle(e).fontSize);if(fs<13){const host=e.closest('[_nghost-ng-c],sc-codex-hardpoint-layout,sc-codex-holo-table,sc-codex-holo-inspector,sc-codex-holo-patch,sc-codex-holo-share');const k=(e.closest('sc-codex-hardpoint-layout,sc-codex-holo-table,sc-codex-holo-inspector,sc-codex-holo-patch,sc-codex-holo-share,sc-codex-holo-stage,sc-codex-holo-strip')||{tagName:'?'}).tagName.toLowerCase()+' '+e.tagName.toLowerCase()+'.'+[...e.classList].filter(c=>!c.startsWith('ng-')).join('.')+' '+fs;out[k]=(out[k]||0)+1}}return out});
R.msgs=msgs.slice(0,5);
fs.writeFileSync(`docs/qa/holotisch-qualitaet/round3/C-${tag}-${ship}-${w}-x${thr}.json`,JSON.stringify(R,null,1));console.log(JSON.stringify(R));await b.close()})().catch(e=>{console.error('ERR',e.message.slice(0,300));process.exit(1)});
