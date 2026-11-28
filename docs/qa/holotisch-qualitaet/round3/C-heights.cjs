const {open}=require('../round1/lib.cjs');
(async()=>{const {b,page}=await open({w:+process.argv[2]||1280,h:800});
await page.goto('http://127.0.0.1:4360/codex/ship/AEGS_Idris_M?view=holo',{waitUntil:'commit'});
await page.waitForSelector('sc-codex-hardpoint-layout',{timeout:120000});await page.waitForTimeout(6000);
const r=await page.evaluate(()=>{const out=[];document.querySelectorAll('sc-codex-hardpoint-layout').forEach((l,i)=>{l.querySelectorAll('details.mod-sec,details.mod-sub').forEach(d=>{const ul=d.querySelector(':scope > ul.sec-rows');const r=d.getBoundingClientRect();out.push(i+' '+d.dataset.sec+' open='+d.open+' y='+Math.round(r.top+scrollY)+' h='+Math.round(r.height)+' rows='+(ul?ul.querySelectorAll(':scope > li').length:0)+' els='+d.querySelectorAll('*').length)})});return out});
console.log(r.join('\n'));await b.close()})();
