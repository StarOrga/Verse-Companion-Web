const {open}=require('../round1/lib.cjs');
(async()=>{const {b,page}=await open({w:+process.argv[2],h:+process.argv[3]});
await page.goto('http://127.0.0.1:4360/codex/ship/AEGS_Idris_M?view=holo',{waitUntil:'commit'});
await page.waitForSelector('sc-codex-hardpoint-layout',{timeout:120000});await page.waitForTimeout(3000);
const H=await page.evaluate(()=>document.documentElement.scrollHeight);
for(let y=0;y<H+800;y+=500){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(200)}
await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(800);
const r=await page.evaluate(()=>{const out={};for(const e of document.querySelectorAll('body *')){if(e.closest('svg'))continue;if([...e.childNodes].every(n=>n.nodeType!==3||!n.textContent.trim()))continue;const fs=parseFloat(getComputedStyle(e).fontSize);if(fs<13){let h=e.parentElement;while(h&&!h.tagName.includes('-'))h=h.parentElement;const k=(h?h.tagName.toLowerCase():'?')+' '+e.tagName.toLowerCase()+'.'+[...e.classList].filter(c=>!c.startsWith('ng-')).join('.')+' '+fs.toFixed(1);out[k]=(out[k]||0)+1}}return out});
console.log(Object.entries(r).filter(([k])=>/hardpoint-layout|holo-table|holo-inspector|holo-patch|holo-share/.test(k)).map(([k,v])=>k+' x'+v).join('\n')||'none from my files');
console.log('--- others:',Object.keys(r).filter(k=>!/hardpoint-layout|holo-table|holo-inspector|holo-patch|holo-share/.test(k)).length);await b.close()})();
