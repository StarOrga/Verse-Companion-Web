const {open}=require('../round1/lib.cjs');
(async()=>{const {b,page,cdp}=await open({w:1280,h:800});
await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
await page.goto('http://127.0.0.1:4340/codex/ship/AEGS_Idris_M?view=holo',{waitUntil:'commit'});
await page.waitForSelector('sc-codex-holo-table',{timeout:120000});await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(4000);
await page.locator('button[aria-label*="wap" i]').first().waitFor();
// warm: open+close once
await page.locator('button[aria-label*="wap" i]').first().click();await page.waitForTimeout(2500);await page.keyboard.press('Escape');await page.waitForTimeout(2000);
await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');
await page.locator('button[aria-label*="wap" i]').first().click();await page.waitForTimeout(2500);
const {profile}=await cdp.send('Profiler.stop');
const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const self=new Map();
const dt=profile.timeDeltas;profile.samples.forEach((id,i)=>{self.set(id,(self.get(id)||0)+dt[i]/1000)});
const parent=new Map();profile.nodes.forEach(n=>(n.children||[]).forEach(c=>parent.set(c,n.id)));
const agg={};for(const [id,t] of self){const n=nodes.get(id);const k=n.callFrame.functionName+' '+n.callFrame.url.split('/').pop()+':'+n.callFrame.lineNumber;agg[k]=(agg[k]||0)+t}
console.log(Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>Math.round(v)+'ms '+k).join('\n'));
// callers of getBoundingClientRect/focus
for(const nm of ['getBoundingClientRect','focus']){let best=null;for(const [id,t] of self){const n=nodes.get(id);if(n.callFrame.functionName===nm&&(!best||t>best.t))best={id,t}}
 if(best){const chain=[];let id=best.id;while(id&&chain.length<7){const n=nodes.get(id);chain.push(n.callFrame.functionName+'@'+n.callFrame.url.split('/').pop()+':'+n.callFrame.lineNumber);id=parent.get(id)}console.log(nm,Math.round(best.t)+'ms',chain.join(' < '))}}
await b.close()})().catch(e=>{console.error('ERR',e.message.slice(0,300))});
