const {open}=require('../round1/lib.cjs');
(async()=>{const {b,page}=await open({w:+process.argv[2]||1280,h:800});
await page.goto('http://127.0.0.1:4360/codex/ship/'+(process.argv[3]||'AEGS_Idris_M')+'?view=holo',{waitUntil:'commit'});
await page.waitForSelector('sc-codex-hardpoint-layout',{timeout:120000});await page.waitForTimeout(3000);
const H=await page.evaluate(()=>document.documentElement.scrollHeight);
for(let y=0;y<H+800;y+=500){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(250)}
await page.waitForTimeout(1500);
const r=await page.evaluate(()=>{const out=[];document.querySelectorAll('sc-codex-hardpoint-layout details.mod-sec,sc-codex-hardpoint-layout details.mod-sub').forEach(d=>{const ul=d.querySelector(':scope > ul.sec-rows');if(!ul)return;out.push(d.dataset.sec+' rows='+ul.querySelectorAll(':scope > li').length+' kids='+ul.querySelectorAll('li.kid').length+' h='+Math.round(ul.getBoundingClientRect().height))});return out});
console.log(r.join('\n'));await b.close()})();
