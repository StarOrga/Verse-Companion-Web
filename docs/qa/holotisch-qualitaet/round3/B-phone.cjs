const {open}=require('../round1/lib.cjs');
(async()=>{const {b,page}=await open({w:375,h:812,ctx:{isMobile:true,hasTouch:true}});
await page.goto('http://127.0.0.1:4340/codex/ship/AEGS_Idris_M?view=holo',{waitUntil:'commit'});
await page.waitForSelector('sc-codex-holo-einsatz',{timeout:120000});await page.waitForTimeout(5000);
const r=await page.evaluate(()=>{const e=document.querySelector('sc-codex-holo-einsatz');const vt=e.querySelector('.vt'),sub=e.querySelector('.sub');
 return{vt:vt.textContent,vtW:vt.scrollWidth,vtC:vt.clientWidth,sub:sub.textContent,subW:sub.scrollWidth,subC:sub.clientWidth,btn:e.querySelector('.einsatz').getBoundingClientRect().width}});
console.log(JSON.stringify(r));
await page.screenshot({path:'docs/qa/holotisch-qualitaet/round3/B-phone-pill.png',clip:{x:0,y:150,width:375,height:160}});
// publishHeight check: topbar var before/after modal
const v=()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--sc-topbar-h')+'|'+getComputedStyle(document.documentElement).getPropertyValue('--sc-bar-stack-h'));
console.log('var before',await v());
await b.close()})().catch(e=>{console.error('ERR',e.message.slice(0,300))});
