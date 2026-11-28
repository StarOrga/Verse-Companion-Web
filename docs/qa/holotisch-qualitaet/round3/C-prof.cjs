const {open}=require('../round1/lib.cjs');const fs=require('fs');
(async()=>{const {b,page,cdp}=await open({w:1280,h:800});
await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');
await page.goto('http://127.0.0.1:4360/codex/ship/AEGS_Idris_M?view=holo',{waitUntil:'commit'});
await page.waitForSelector('sc-codex-hardpoint-layout',{timeout:120000});await page.waitForTimeout(6000);
const {profile}=await cdp.send('Profiler.stop');
const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const self=new Map();
const dt=profile.timeDeltas;profile.samples.forEach((id,i)=>self.set(id,(self.get(id)||0)+dt[i]));
const parent=new Map();profile.nodes.forEach(n=>(n.children||[]).forEach(c=>parent.set(c,n.id)));
const byFn={};for(const [id,t] of self){const n=nodes.get(id);const k=(n.callFrame.functionName||'(anon)')+' '+n.callFrame.url.split('/').pop().split('?')[0].slice(0,30)+':'+n.callFrame.lineNumber;byFn[k]=(byFn[k]||0)+t}
console.log(Object.entries(byFn).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,v])=>(v/1000).toFixed(0)+'ms '+k).join(String.fromCharCode(10)));
await b.close()})();
