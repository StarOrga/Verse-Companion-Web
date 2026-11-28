const {open}=require('../round1/lib.cjs');
const thr=+process.argv[2]||1;
(async()=>{const {b,page,cdp}=await open({w:1280,h:800});await cdp.send('Performance.enable');if(thr>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:thr});
await page.goto('http://127.0.0.1:4360/codex/ship/AEGS_Idris_M?view=holo',{waitUntil:'commit'});
await page.waitForSelector('sc-codex-hardpoint-layout',{timeout:120000});await page.waitForTimeout(8000);
const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
console.log(['LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration','LayoutCount','RecalcStyleCount','Nodes'].map(k=>k+'='+(+m[k]).toFixed(2)).join(' '));
// per-subtree element counts
console.log(await page.evaluate(()=>[...document.querySelectorAll('sc-codex-hardpoint-layout,sc-codex-holo-table,sc-codex-holo-stage,sc-codex-holo-strip')].map(e=>e.tagName+':'+e.querySelectorAll('*').length+' open='+e.querySelectorAll('details[open]').length+' slots='+e.querySelectorAll('li.slot').length).join('\n')));
await b.close()})();
