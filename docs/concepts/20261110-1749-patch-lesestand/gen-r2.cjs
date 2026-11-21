// Generates rounds/02.html of the patch read-state concept. Run: node gen-r2.cjs
// Round 2 = the owner's chat feedback of 2026-11-19 (verbatim in briefs/02.md).
const fs = require('fs');
const path = require('path');

const S = ':is([data-design], .design-ov-scale) .mock-r2';

const css = `
${S}{position:relative;min-height:100%;box-sizing:border-box;overflow:hidden;background:radial-gradient(ellipse 70% 40% at 50% 0%,#10293a 0%,#081622 55%,#050b13 100%);color:#cfe8f3;font:15px/1.5 "Segoe UI",system-ui,sans-serif;--a:#52c1e6;--ok:#3fd08a;--warn:#e2b04a;--ink:#eef9fd;--mut:#9dbccd;--dim:#6f8fa1;--line:rgba(82,193,230,.22);--panel:rgba(13,30,43,.78);--disp:"Orbitron","Eurostile","Segoe UI",system-ui,sans-serif;padding-bottom:64px}
${S} *{box-sizing:border-box}
${S} :where(h1,h2,h3,h4,p,ul,ol,li){margin:0;padding:0;list-style:none;font-weight:inherit;font-size:inherit}
${S} .mock-btn{font:inherit;font-size:14px;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:999px;padding:7px 15px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;min-height:38px;white-space:nowrap}
${S} .mock-btn:hover{border-color:var(--a);color:#fff}
${S} .mock-btn.mock-primary{background:var(--a);border-color:var(--a);color:#04121b;font-weight:600}
${S} .mock-btn.mock-quiet{border-color:transparent;color:var(--mut);padding-inline:8px}
${S} .mock-top{position:relative;z-index:1;display:flex;align-items:center;gap:16px;padding:12px 28px;border-bottom:1px solid var(--line);background:rgba(5,11,19,.75);font-size:14px;color:var(--mut)}
${S} .mock-top b{color:var(--ink);font-weight:600}
${S} .mock-top .mock-search{margin-left:auto;border:1px solid var(--line);border-radius:8px;padding:7px 12px;min-width:260px;color:var(--dim)}
${S} .mock-planet{position:absolute;left:-150px;top:150px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle at 62% 38%,#3b7fa0,#123047 55%,#06121c 75%);box-shadow:0 0 60px -10px rgba(82,193,230,.45);opacity:.75;pointer-events:none}
${S} .mock-page{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:34px 28px 0;display:flex;flex-direction:column;gap:18px}
${S} .mock-tag{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);background:rgba(111,143,161,.22);white-space:nowrap}
${S} .mock-t-live{color:#04121b;background:var(--ok)}
${S} .mock-t-ptu{color:var(--a);background:rgba(82,193,230,.2)}
${S} .mock-new{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;background:var(--a);color:#04121b;font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
${S} .mock-list{display:flex;flex-direction:column;gap:6px;font-size:15px;color:#d8edf6}
${S} .mock-list li{position:relative;padding-left:18px}
${S} .mock-list li::before{content:'';position:absolute;left:2px;top:10px;width:6px;height:6px;border-radius:50%;background:var(--a)}
${S} .mock-list li.mock-fix::before{background:var(--ok)}
${S} .mock-list li.mock-known::before{background:var(--warn)}
${S} .mock-kicker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);font-weight:600}

/* switch */
${S} .mock-switchrow{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
${S} .mock-switch{display:inline-flex;padding:4px;border:1px solid var(--line);border-radius:999px;background:rgba(5,11,19,.6)}
${S} .mock-switch a{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:999px;color:var(--mut);text-decoration:none;font-size:15px;cursor:pointer}
${S} .mock-switch a.mock-on{background:var(--ok);color:#04121b;font-weight:700}
${S} .mock-switch a.mock-on.mock-ptu{background:var(--a)}
${S} .mock-switch small{font-size:12px;opacity:.85}
${S} .mock-switchrow p{font-size:14px;color:var(--dim)}

/* header: now live | next on live */
${S} .mock-head{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:18px}
${S} .mock-box{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:12px}
${S} .mock-box.mock-now{border-color:rgba(63,208,138,.55);background:linear-gradient(135deg,rgba(63,208,138,.12),var(--panel) 60%)}
${S} .mock-box.mock-unread{box-shadow:inset 4px 0 0 var(--a),0 0 30px -14px var(--a)}
${S} .mock-box.mock-next{border-color:rgba(82,193,230,.5);background:linear-gradient(135deg,rgba(82,193,230,.12),var(--panel) 60%)}
${S} .mock-box-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
${S} .mock-box-h h2{font-family:var(--disp);font-size:28px;color:#fff;line-height:1.1}
${S} .mock-box-h .mock-when{margin-left:auto;text-align:right;font-size:14px;color:var(--mut)}
${S} .mock-box-h .mock-when b{display:block;color:var(--ink);font-size:16px}
${S} .mock-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
${S} .mock-acts span{margin-left:auto;font-size:13px;color:var(--dim)}
${S} .mock-trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
${S} .mock-trio div{border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;font-size:13.5px;color:var(--mut)}
${S} .mock-trio b{font-family:var(--disp);font-size:22px;color:var(--ink)}
${S} .mock-trio .mock-c-ok b{color:var(--ok)}
${S} .mock-trio .mock-c-maybe b{color:var(--a)}
${S} .mock-trio .mock-c-late b{color:var(--warn)}
${S} .mock-items{display:flex;flex-direction:column;gap:6px;font-size:14.5px}
${S} .mock-items li{display:flex;gap:10px;align-items:baseline}
${S} .mock-items li i{font-style:normal;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:1px 8px;border-radius:999px;flex:none}
${S} .mock-items .mock-i-ok{color:#04121b;background:var(--ok)}
${S} .mock-items .mock-i-maybe{color:var(--a);background:rgba(82,193,230,.18)}
${S} .mock-items .mock-i-late{color:#1d1503;background:var(--warn)}
${S} .mock-done{display:flex;align-items:center;gap:12px;font-size:15px;color:var(--mut)}
${S} .mock-done b{color:var(--ok)}

/* timeline with date gutter */
${S} .mock-tl{position:relative;display:flex;flex-direction:column;gap:14px;padding-left:150px}
${S} .mock-tl::before{content:'';position:absolute;left:128px;top:16px;bottom:16px;width:2px;border-radius:2px;background:linear-gradient(180deg,rgba(82,193,230,.55),var(--ok) 40%,rgba(111,143,161,.35))}
${S} .mock-row{position:relative}
${S} .mock-row::before{content:'';position:absolute;left:-27px;top:26px;width:12px;height:12px;border-radius:50%;background:var(--dim);border:2px solid #050b13}
${S} .mock-row.mock-r-live::before{width:16px;height:16px;left:-29px;top:24px;background:var(--ok);box-shadow:0 0 12px var(--ok)}
${S} .mock-row.mock-r-next::before{background:var(--a)}
${S} .mock-date{position:absolute;left:-150px;top:16px;width:106px;text-align:right;display:flex;flex-direction:column;gap:1px}
${S} .mock-date b{font-family:var(--disp);font-size:15px;color:var(--ink);font-weight:600}
${S} .mock-date small{font-size:12.5px;color:var(--dim)}
${S} .mock-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
${S} .mock-r-live .mock-card{border-color:rgba(63,208,138,.5)}
${S} .mock-r-next .mock-card{border-color:rgba(82,193,230,.4)}
${S} .mock-r-old .mock-card{opacity:.85}
${S} .mock-ch{display:grid;grid-template-columns:96px 170px minmax(0,1fr) auto;align-items:center;gap:10px 18px;padding:14px 18px}
${S} .mock-pill{justify-self:start;padding:5px 12px;border-radius:6px;font-family:var(--disp);font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--dim);background:rgba(111,143,161,.16)}
${S} .mock-r-live .mock-pill{color:#04121b;background:var(--ok)}
${S} .mock-r-next .mock-pill{color:var(--a);background:rgba(82,193,230,.2)}
${S} .mock-ver{font-family:var(--disp);font-size:20px;font-weight:600;color:var(--ink)}
${S} .mock-r-live .mock-ver{font-size:26px}
${S} .mock-sent{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:14px;color:var(--mut)}
${S} .mock-sent b{color:var(--ink);font-weight:500;font-size:15px}
${S} .mock-chip{display:inline-flex;align-items:center;padding:4px 11px;border-radius:999px;border:1px solid rgba(63,208,138,.45);color:var(--ok);font-size:13px;white-space:nowrap}
${S} .mock-subs{margin:0 18px 14px 18px;border-top:1px solid var(--line);padding-top:8px;display:flex;flex-direction:column}
${S} .mock-sv{display:grid;grid-template-columns:16px 70px minmax(0,1fr) auto 110px;gap:12px;align-items:center;padding:8px 10px;border-radius:8px;min-height:42px;font-size:14px;color:var(--mut);text-decoration:none}
${S} .mock-sv:hover{background:rgba(82,193,230,.08);color:var(--ink)}
${S} .mock-sv b{font-family:var(--disp);font-size:14px;color:var(--ink);font-weight:500}
${S} .mock-sv span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .mock-sv time{text-align:right;font-size:13px;color:var(--dim);white-space:nowrap}
${S} .mock-sv.mock-top1 b,${S} .mock-sv.mock-top1 span{color:#fff;font-weight:600}
${S} .mock-dot{width:10px;height:10px;border-radius:50%;justify-self:center}
${S} .mock-dot.mock-unread{background:var(--a);box-shadow:0 0 8px var(--a)}
${S} .mock-dot.mock-read{width:auto;height:auto;color:var(--dim);font-size:13px}
${S} .mock-bundle{display:flex;align-items:center;gap:10px;padding:9px 10px;font-size:14px;color:var(--mut);border-radius:8px}
${S} .mock-bundle::before{content:'›';color:var(--a);font-size:16px}
${S} .mock-bundle b{color:var(--ink);font-weight:600}
${S} .mock-bundle span{margin-left:auto;color:var(--dim)}
${S} .mock-fold{display:flex;align-items:center;gap:8px;padding:11px 16px;border:1px dashed rgba(111,143,161,.4);border-radius:10px;color:var(--mut);font-size:14px}
${S} .mock-fold::before{content:'›';color:var(--a)}
${S} .mock-hint{display:flex;align-items:center;gap:10px;padding:10px 16px;border:1px dashed rgba(82,193,230,.4);border-radius:10px;font-size:14px;color:var(--mut)}
${S} .mock-hint a{color:var(--a);text-decoration:none;cursor:pointer}

/* PTU screen */
${S} .mock-wave{display:grid;grid-template-columns:16px 120px minmax(0,1fr) auto 120px;gap:12px;align-items:center;padding:12px 18px;border-top:1px solid var(--line);font-size:14.5px;color:var(--mut)}
${S} .mock-wave b{font-family:var(--disp);font-size:14px;color:var(--ink)}
${S} .mock-wave time{text-align:right;font-size:13px;color:var(--dim)}
${S} .mock-wave.mock-top1 span{color:#fff;font-weight:600}

/* dossier */
${S} .mock-dos{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;align-items:start}
${S} .mock-toc{position:sticky;top:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:10px;display:flex;flex-direction:column;gap:2px}
${S} .mock-toc a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;color:var(--mut);text-decoration:none;font-size:14px}
${S} .mock-toc a i{font-style:normal;font-family:var(--disp);font-size:12px;color:var(--dim);width:16px}
${S} .mock-toc a.mock-on{background:rgba(82,193,230,.14);color:#fff}
${S} .mock-main{display:flex;flex-direction:column;gap:18px}
${S} .mock-dh{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
${S} .mock-dh h1{font-family:var(--disp);font-size:30px;color:#fff}
${S} .mock-dh .mock-btn{margin-left:auto}
${S} .mock-dsub{font-size:14.5px;color:var(--mut)}
${S} .mock-sec{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:16px 18px;display:flex;flex-direction:column;gap:12px}
${S} .mock-sec h3{display:flex;align-items:center;gap:10px;font-family:var(--disp);font-size:16px;color:#fff;letter-spacing:.04em}
${S} .mock-sec h3 i{font-style:normal;font-size:12px;color:var(--dim);font-family:"Segoe UI",system-ui,sans-serif;letter-spacing:0}
${S} .mock-tile{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:10px;background:rgba(5,14,22,.55)}
${S} .mock-img{height:168px;border-radius:8px;border:1px solid rgba(82,193,230,.35);background:linear-gradient(135deg,#16405a,#0a1c2a 55%,#1d4b63)}
${S} .mock-img.mock-img2{background:linear-gradient(160deg,#3a2a14,#141008 55%,#5a3d16)}
${S} .mock-tile h4{font-size:18px;color:#fff;font-weight:600;margin-bottom:6px}
${S} .mock-tile p{font-size:14.5px;color:var(--mut)}
${S} .mock-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
${S} .mock-stab{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
${S} .mock-stab strong{font-family:var(--disp);font-size:34px;color:var(--ok)}
${S} .mock-stab p{font-size:14px;color:var(--mut);max-width:52ch}
${S} .mock-vote{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:15px;color:var(--ink)}
${S} .mock-vote b{margin-right:6px;font-weight:600}
${S} .mock-collapsed{display:flex;align-items:center;gap:10px;font-size:14.5px;color:var(--mut)}
${S} .mock-collapsed b{font-family:var(--disp);font-size:15px;color:#fff;font-weight:600}
${S} .mock-collapsed span{margin-left:auto;color:var(--dim);font-size:13px}

@container device (max-width: 520px){
${S} .mock-top{padding:10px 14px}
${S} .mock-top .mock-search{display:none}
${S} .mock-planet{display:none}
${S} .mock-page{padding:16px 12px 0}
${S} .mock-head,${S} .mock-trio,${S} .mock-cols,${S} .mock-dos,${S} .mock-tile{grid-template-columns:minmax(0,1fr)}
${S} .mock-toc{display:none}
${S} .mock-box-h .mock-when{margin-left:0;text-align:left}
${S} .mock-tl{padding-left:22px}
${S} .mock-tl::before{left:6px}
${S} .mock-row::before{left:-21px}
${S} .mock-row.mock-r-live::before{left:-23px}
${S} .mock-date{position:static;width:auto;text-align:left;flex-direction:row;gap:8px;margin-bottom:4px}
${S} .mock-ch{grid-template-columns:auto minmax(0,1fr);padding:12px}
${S} .mock-ch .mock-sent,${S} .mock-ch .mock-chip{grid-column:1 / -1;justify-self:start}
${S} .mock-sv,${S} .mock-wave{grid-template-columns:16px 60px minmax(0,1fr)}
${S} .mock-sv time,${S} .mock-sv .mock-tag,${S} .mock-wave time,${S} .mock-wave .mock-tag{display:none}
${S} .mock-img{height:140px}
}
`;

const li = (arr, cls = '') => arr.map((t) => `<li${cls ? ` class="${cls}"` : ''}>${t}</li>`).join('');
const NEWS = ['Neue Waffe: LBCO Skarnov Rifle', 'Neue Missionen: Vanduul Incursion'];
const FIX = ['129 Fehler behoben, darunter mehrere Exploits', 'Performance für IAE und Vanduul Incursion', '4-GB-Grenze des Vulkan-Pipeline-Caches entfernt'];

function anno(id, n, side, target, q, improved = '') {
  const imp = improved ? `<p class="anno-bubble-improved"><strong>{{design.change_improved}}</strong> ${improved}</p>` : '';
  return `<div class="anno" data-anno="${id}" data-anno-side="${side}" data-anno-target="${target.replace(/"/g, '&quot;')}" style="--anno-x:50%;--anno-y:40%"><button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{anno.pin_label}}">${n}</button><div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false">${imp}<button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}"><span class="anno-bubble-question">${q}</span></button><div class="anno-bubble-body"><textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea><div class="attach-slot" data-attach-slot="anno-${id}"></div></div></div></div>`;
}
const layer = (...a) => `<div class="anno-layer" data-anno-layer>${a.join('')}</div>`;

const top = `<div class="mock-top"><span>Verse</span><span>›</span><b>Patches</b><span class="mock-search">Patches durchsuchen …</span></div><span class="mock-planet" data-m="planet"></span>`;

const sw = (mode) => `<div class="mock-switchrow"><div class="mock-switch" data-m="switch"><a class="${mode === 'live' ? 'mock-on' : ''}" data-screen-link="r2-d1-s1">Live<small>was du spielst</small></a><a class="${mode === 'ptu' ? 'mock-on mock-ptu' : ''}" data-screen-link="r2-d1-s2">PTU<small>Test-Server</small></a></div><p>${mode === 'live' ? 'PTU-Builds stehen im eigenen Reiter, sie stören die Live-Ansicht nicht.' : 'Alles, was gerade getestet wird. Kann sich bis Live noch ändern.'}</p></div>`;

// ── shared boxes ─────────────────────────────────────────────────────────────
const nextBox = `<section class="mock-box mock-next" data-m="next">
  <div class="mock-box-h"><span class="mock-kicker">Als Nächstes auf Live</span></div>
  <div class="mock-box-h"><h2>Alpha 5.0</h2><span class="mock-tag mock-t-ptu">im PTU · Welle 3</span><span class="mock-when"><b>Kein offizielles Datum</b>Schätzung: ~ Feb. 2027</span></div>
  <div class="mock-trio" data-m="trio"><div class="mock-c-ok"><b>14</b>bestätigt</div><div class="mock-c-maybe"><b>9</b>möglich</div><div class="mock-c-late"><b>3</b>verschoben</div></div>
  <ul class="mock-items"><li><i class="mock-i-ok">bestätigt</i>Engineering Tier 0</li><li><i class="mock-i-maybe">möglich</i>Genesis-Planeten-Tech auf Hurston</li><li><i class="mock-i-late">verschoben</i>Quantum-Interdiction 2.0, neu: nach 5.0</li></ul>
  <div class="mock-acts"><a class="mock-btn">Alles zu 5.0 →</a><span>Quelle: RSI-Roadmap, Stand heute</span></div>
</section>`;

const nowUnread = `<section class="mock-box mock-now mock-unread" data-m="now">
  <div class="mock-box-h"><span class="mock-kicker">Gerade auf Live gekommen</span><span class="mock-new">Neu für dich</span></div>
  <div class="mock-box-h"><h2>Alpha 4.10.3</h2><span class="mock-tag mock-t-live">Live</span><span class="mock-when"><b>seit 12. Nov. 2026</b>vor 7 Tagen</span></div>
  <ul class="mock-list">${li(NEWS)}${li(FIX.slice(0, 2), 'mock-fix')}</ul>
  <div class="mock-acts"><a class="mock-btn mock-primary" data-screen-link="r2-d1-s4">Ganz lesen →</a><a class="mock-btn" data-screen-link="r2-d1-s3" data-m="read">✓ Gelesen</a><span>Lesezeit ~2 Min.</span></div>
</section>`;

const nowRead = `<section class="mock-box mock-now" data-m="now-read">
  <div class="mock-box-h"><span class="mock-kicker">Gerade auf Live</span></div>
  <div class="mock-box-h"><h2>Alpha 4.10.3</h2><span class="mock-tag mock-t-live">Live</span><span class="mock-when"><b>seit 12. Nov. 2026</b>vor 7 Tagen</span></div>
  <div class="mock-done"><b>✓ Du bist auf Stand</b>gelesen am 19. Nov. · seitdem nichts Neues</div>
  <div class="mock-acts"><a class="mock-btn" data-screen-link="r2-d1-s4">Nochmal lesen</a><a class="mock-btn mock-quiet" data-screen-link="r2-d1-s1">Als ungelesen markieren</a></div>
</section>`;

function sv(ver, title, tag, when, state, top1 = false) {
  const dot = state === 'unread' ? '<span class="mock-dot mock-unread"></span>' : '<span class="mock-dot mock-read">✓</span>';
  return `<a class="mock-sv${top1 ? ' mock-top1' : ''}"><b>${ver}</b>`.replace('<b>', `${dot}<b>`) + `<span>${title}</span>${tag}<time>${when}</time></a>`;
}
const T_LIVE = '<span class="mock-tag mock-t-live">Live</span>';
const T_HF = '<span class="mock-tag">Hotfix</span>';

const timeline = (read) => `<div class="mock-tl" data-m="tl">
  <div class="mock-row mock-r-next"><div class="mock-date"><b>offen</b><small>kein Datum</small></div><div class="mock-card">
    <div class="mock-ch"><span class="mock-pill">Als Nächstes</span><span class="mock-ver">Alpha 5.0</span><span class="mock-sent"><b>Im PTU seit 4. Nov., Welle 3</b><span>Die Test-Builds stehen im Reiter PTU</span></span><span></span></div>
  </div></div>
  <div class="mock-row mock-r-live" data-m="live-row"><div class="mock-date" data-m="date"><b>26. Aug. 2026</b><small>seit 85 Tagen</small></div><div class="mock-card">
    <div class="mock-ch"><span class="mock-pill">Live</span><span class="mock-ver">Alpha 4.10</span><span class="mock-sent"><b>Neuester Stand: 4.10.3 vom 12. Nov.</b><span>3 Updates seit dem Start · nächster Live-Patch: 5.0</span></span><span class="mock-chip">81 % stabil</span></div>
    <div class="mock-subs">
      ${sv('4.10.3', 'Alpha 4.10.3 LIVE Patch Notes', T_LIVE, '12. Nov.', read ? 'read' : 'unread', true)}
      <div class="mock-bundle" data-m="bundle"><b>3 frühere Updates</b> 4.10.2 · 4.10.1 · 4.10.0<span>alle gelesen ✓</span></div>
    </div>
  </div></div>
  <div class="mock-row mock-r-old"><div class="mock-date"><b>12. Juni 2026</b><small>75 Tage live</small></div><div class="mock-card">
    <div class="mock-ch"><span class="mock-pill">Abgelöst</span><span class="mock-ver">Alpha 4.9</span><span class="mock-sent"><b>Live bis 26. Aug.</b><span>3 Hotfixes</span></span><span class="mock-chip">84 % stabil</span></div>
  </div></div>
  <div class="mock-row"><div class="mock-fold">Ältere Patches · 4.8 · 4.7 · 4.6</div></div>
</div>`;

// ── screens ──────────────────────────────────────────────────────────────────
const s1 = `<div class="mock-r2">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowUnread}${nextBox}</div>
  ${timeline(false)}
</div></div>
${layer(
  anno('r2-d1-s1-a1', 1, 'bottom', '[data-m="switch"] a', 'Live ist immer der Start, PTU ein eigener Reiter. Soll sich die Seite merken, wenn du einmal auf PTU umgeschaltet hast, oder immer auf Live öffnen?', 'Live und PTU getrennt'),
  anno('r2-d1-s1-a2', 2, 'left', '[data-m="trio"]', 'Für 5.0 zählen wir die Roadmap-Einträge nach bestätigt / möglich / verschoben. So wie du es von SC Focus kennst, oder fehlt dir dort etwas?', 'Nächster Live-Patch oben rechts'),
  anno('r2-d1-s1-a3', 3, 'right', '[data-m="date"] b', 'Datum und Tage stehen jetzt links an der Zeitleiste, im Kästchen nur noch „Live“. Passt das so?', 'Datum an der Zeitleiste'),
)}`;

const s2 = `<div class="mock-r2">${top}<div class="mock-page">
  ${sw('ptu')}
  <section class="mock-box mock-next" data-m="ptu">
    <div class="mock-box-h"><span class="mock-kicker">Gerade im Test</span><span class="mock-new">1 neu</span></div>
    <div class="mock-box-h"><h2>Alpha 5.0 PTU</h2><span class="mock-tag mock-t-ptu">Welle 3</span><span class="mock-when"><b>neuester Build 13228337</b>gestern</span></div>
    <ul class="mock-list"><li>Welle 3: alle Backer mit PTU-Zugang</li><li class="mock-fix">Stabilitätsfixes für Server-Meshing</li><li class="mock-known">Bekannt: Mission Boards laden teils leer</li></ul>
    <div class="mock-acts"><a class="mock-btn mock-primary">Build-Notes lesen →</a><a class="mock-btn">✓ Gelesen</a><span>Original auf Spectrum ↗</span></div>
  </section>
  <div class="mock-card" data-m="waves">
    <div class="mock-wave mock-top1"><span class="mock-dot mock-unread"></span><b>Welle 3</b><span>Alpha 5.0 PTU · Build 13228337</span><span class="mock-tag mock-t-ptu">PTU</span><time>gestern</time></div>
    <div class="mock-wave"><span class="mock-dot mock-read">✓</span><b>Welle 1</b><span>Alpha 5.0 PTU · 4 Builds</span><span class="mock-tag mock-t-ptu">PTU</span><time>seit 4. Nov.</time></div>
    <div class="mock-wave"><span class="mock-dot mock-read">✓</span><b>Evocati</b><span>Tech-Preview Genesis / Mission Boards (NDA)</span><span class="mock-tag">Evocati</span><time>Okt.</time></div>
  </div>
  <div class="mock-hint">Was davon sicher auf Live kommt, steht im Reiter <a data-screen-link="r2-d1-s1">Live</a> unter „Als Nächstes“.</div>
</div></div>
${layer(
  anno('r2-d1-s2-a1', 1, 'bottom', '[data-m="ptu"] h2', 'Hier steht nur der neueste Test-Build groß, die Wellen darunter als Liste. Reicht das für den PTU, oder willst du dort auch die gleiche Zeitleiste wie bei Live?'),
  anno('r2-d1-s2-a2', 2, 'left', '[data-m="waves"] .mock-wave:last-child b', 'Evocati-Builds stehen mit im PTU-Reiter. Drinlassen oder weglassen (die meisten kommen da eh nicht rein)?'),
)}`;

const s3 = `<div class="mock-r2">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowRead}${nextBox}</div>
  ${timeline(true)}
</div></div>
${layer(
  anno('r2-d1-s3-a1', 1, 'bottom', '[data-m="now-read"] .mock-done b', 'Gelesen: die linke Box wird ruhig und zeigt nur noch „Du bist auf Stand“. Kommt 4.10.4, wird sie wieder groß. Passt das?', 'Lesestand bleibt erhalten'),
)}`;

const s4 = `<div class="mock-r2">${top}<div class="mock-page">
  <div class="mock-dos">
    <nav class="mock-toc" data-m="toc"><a class="mock-on"><i>1</i>Was steckt drin</a><a><i>2</i>Stabilität</a><a><i>3</i>Community</a><a><i>4</i>Dein Urteil</a><a><i>5</i>Wann kommt der nächste</a><a><i>6</i>Vorbereiten</a></nav>
    <div class="mock-main">
      <div class="mock-dh"><h1>Alpha 4.10.3</h1><span class="mock-tag mock-t-live">Live</span><a class="mock-btn" data-m="rsi">Original bei RSI ↗</a></div>
      <p class="mock-dsub">Live seit 12. Nov. 2026 · drittes Update von Alpha 4.10 · <a class="mock-btn mock-quiet" data-screen-link="r2-d1-s1">← zurück zu den Patches</a></p>
      <section class="mock-sec"><h3>1 · Was steckt drin <i>neu und behoben</i></h3>
        <div class="mock-tile" data-m="tile"><div class="mock-img"></div><div><h4>LBCO Skarnov Rifle</h4><p>Neues Sturmgewehr von Lightning Bolt Co., in den Waffenläden von Area18 und Orison erhältlich.</p></div></div>
        <div class="mock-tile"><div class="mock-img mock-img2"></div><div><h4>Vanduul Incursion</h4><p>Neue Missionsreihe: Vanduul-Angriffe auf Außenposten, als Gruppe spielbar, mit eigenen Belohnungen.</p></div></div>
        <div class="mock-cols"><div><p class="mock-kicker">Behoben · 129</p><ul class="mock-list">${li(FIX, 'mock-fix')}</ul></div><div><p class="mock-kicker">Bekannte Probleme</p><ul class="mock-list"><li class="mock-known">laut RSI-Notes, Liste im Original</li></ul></div></div>
      </section>
      <section class="mock-sec" data-m="stab"><h3>2 · Stabilität</h3>
        <div class="mock-stab"><strong>81 %</strong><p>Spieler berichten auf Spectrum überwiegend von stabilen Sitzungen, Abstürze vor allem bei Vanduul Incursion in großen Gruppen.</p></div>
      </section>
      <section class="mock-sec"><h3>3 · Community <i>aus Spectrum</i></h3><div class="mock-collapsed"><b>24 Beiträge</b>„Skarnov fühlt sich gut an“, „IAE läuft deutlich runder“ …<span>aufklappen</span></div></section>
      <section class="mock-sec" data-m="vote"><h3>4 · Dein Urteil</h3><div class="mock-vote"><b>Wie läuft 4.10.3 bei dir?</b><a class="mock-btn">Stabil</a><a class="mock-btn">Geht so</a><a class="mock-btn">Instabil</a><a class="mock-btn mock-quiet">Kann ich nicht sagen</a></div></section>
      <section class="mock-sec"><h3>5 · Wann kommt der nächste</h3><div class="mock-collapsed"><b>Alpha 5.0</b>im PTU, kein offizielles Datum, Schätzung ~ Feb. 2027<span>aufklappen</span></div></section>
      <section class="mock-sec"><h3>6 · Vorbereiten</h3><div class="mock-collapsed"><b>Kein Wipe</b>Langzeit-Speicher (LTP) bleibt erhalten<span>aufklappen</span></div></section>
    </div>
  </div>
</div></div>
${layer(
  anno('r2-d1-s4-a1', 1, 'top', '[data-m="tile"] h4', 'Eigene Darstellung statt RSI-Kopie: Bild links, Text rechts, damit die Fläche gefüllt ist. Gefällt dir das so?', 'Bild links, Text rechts'),
  anno('r2-d1-s4-a2', 2, 'bottom', '[data-m="toc"] a:nth-child(6)', 'Diese Reihenfolge (Inhalt zuerst, dann Stabilität, Community, Urteil, nächster Patch, Vorbereiten) gilt dann für jedes Dossier, auch für den Hauptpatch 4.10. Einverstanden?', 'Gleiche Reihenfolge überall'),
  anno('r2-d1-s4-a3', 3, 'top', '[data-m="vote"] b', 'Die Zahl ist überall offen sichtbar, also fällt „Erst dein Urteil, dann die Zahl“ weg: einfach eine Frage, drei Knöpfe. Oder soll die Blind-Abstimmung bleiben und die Zahl dafür bis zur Abgabe überall versteckt sein?', 'Keine Blind-Abstimmung mehr'),
)}`;

const icon = '&lt;svg viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.8&quot;&gt;&lt;rect x=&quot;3&quot; y=&quot;4&quot; width=&quot;8&quot; height=&quot;7&quot; rx=&quot;2&quot;/&gt;&lt;rect x=&quot;13&quot; y=&quot;4&quot; width=&quot;8&quot; height=&quot;7&quot; rx=&quot;2&quot;/&gt;&lt;path d=&quot;M4 15h16M4 19h11&quot;/&gt;&lt;/svg&gt;';

const html = `<section data-iteration="2" data-iteration-template="design" data-tab-label="Runde 2" data-viewports="desktop phone">
<style>${css}</style>
<header class="iteration-intro"><h2>{{iteration.tab}} 2 · Live zuerst, PTU auf Wunsch</h2><p>Dein Feedback aus dem Chat in einem Entwurf: oben die drei Fragen, mit denen du kommst (was ist gerade live, was kommt als Nächstes auf Live, was läuft im PTU), darunter die Zeitleiste mit Datum, und ein Dossier mit neuer Reihenfolge. Echte Lage: 4.10.3 seit 12. Nov. live, 5.0 im PTU ohne Datum.</p></header>
<section data-design="r2-d1" data-nav-label="Live zuerst" data-design-active="true" data-screen-fit="full" data-design-icon="${icon}" data-design-improved="Live und PTU getrennt, 4.10.3 ganz oben">
<section id="r2-d1-s1" data-nav-label="Patches · Live" data-screen data-screen-active="true">${s1}</section>
<section id="r2-d1-s2" data-nav-label="Patches · PTU" data-screen hidden>${s2}</section>
<section id="r2-d1-s3" data-nav-label="Live · gelesen" data-screen hidden>${s3}</section>
<section id="r2-d1-s4" data-nav-label="Dossier 4.10.3" data-screen hidden>${s4}</section>
</section>
</section>
`;

fs.writeFileSync(path.join(__dirname, 'rounds', '02.html'), html.replace(/\r\n/g, '\n'));
console.log('rounds/02.html', html.length, 'bytes');
