const {open}=require('../round1/lib.cjs');
(async()=>{for(const [w,h,view] of [[1280,800,'holo'],[375,812,'holo'],[1280,800,'classic']]){const {b,page}=await open({w,h});
await page.goto('http://127.0.0.1:4360/codex/ship/AEGS_Idris_M?view='+view,{waitUntil:'commit'});
await page.waitForSelector('sc-codex-hardpoint-layout',{timeout:120000});await page.waitForTimeout(3000);
const info=await page.evaluate(()=>({slots:document.querySelectorAll('sc-codex-hardpoint-layout li.slot').length,ph:document.querySelectorAll('.sec-ph').length}));
await page.evaluate(()=>{const l=document.querySelector('sc-codex-hardpoint-layout');l.scrollIntoView()});await page.waitForTimeout(1500);
await page.screenshot({path:`docs/qa/holotisch-qualitaet/round3/C-shot-${view}-${w}.png`});
console.log(view,w,JSON.stringify(info),JSON.stringify(await page.evaluate(()=>({slots:document.querySelectorAll('sc-codex-hardpoint-layout li.slot').length,ph:document.querySelectorAll('.sec-ph').length}))));await b.close()}})();
