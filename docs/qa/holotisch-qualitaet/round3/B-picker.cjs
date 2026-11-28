const {open}=require('../round1/lib.cjs');const fs=require('fs');
const D='docs/qa/holotisch-qualitaet/round3/';
const [w,h,thr,tag]=[+process.argv[2],+process.argv[3],+process.argv[4],process.argv[5]||'x'];
(async()=>{const {b,page,msgs,cdp}=await open({w,h});
if(thr>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:thr});
await page.goto('http://127.0.0.1:4340/codex/ship/AEGS_Idris_M?view=holo',{waitUntil:'commit'});
await page.waitForSelector('h1',{state:'visible',timeout:120000});
await page.waitForSelector('sc-codex-holo-table',{timeout:120000}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(4000);
const R={w,thr,tag,runs:[]};
for(let i=0;i<3;i++){
 await page.evaluate(()=>{window.__long=[]});
 const r=await page.evaluate(async()=>{const btn=document.querySelector('button[aria-label*="wap" i]');const t=performance.now();btn.click();
  const sync=performance.now()-t;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const toFrame=performance.now()-t;
  return{sync:Math.round(sync),toFrame:Math.round(toFrame)}});
 await page.waitForTimeout(1500);
 const lt=await page.evaluate(()=>window.__long);
 const act=await page.evaluate(()=>({tag:document.activeElement.tagName,cls:document.activeElement.className.toString().slice(0,30),dlg:!!document.querySelector('[role=dialog]')}));
 R.runs.push({...r,lt:lt.length,max:Math.max(0,...lt.map(x=>x[1])),sum:lt.reduce((a,x)=>a+x[1],0),act});
 if(i==0)await page.screenshot({path:D+`B-swap-${tag}-x${thr}.png`});
 await page.keyboard.press('Escape');await page.waitForTimeout(1200);
}
R.msgs=msgs.slice(0,5);console.log(JSON.stringify(R));fs.writeFileSync(D+`B-picker-${tag}-x${thr}.json`,JSON.stringify(R,null,1));await b.close()})().catch(e=>{console.error('ERR',e.message.slice(0,300));process.exit(1)});
