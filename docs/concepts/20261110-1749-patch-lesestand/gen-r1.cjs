// Generates rounds/01.html of the patch read-state concept. Run: node gen-r1.cjs
const fs = require('fs');
const path = require('path');

const S = ':is([data-design], .design-ov-scale) .mock-pb';

const css = `
${S}{position:relative;min-height:100%;box-sizing:border-box;background:radial-gradient(ellipse 70% 40% at 50% 0%,#10293a 0%,#081622 55%,#050b13 100%);color:#cfe8f3;font:14px/1.45 "Segoe UI",system-ui,sans-serif;--a:#52c1e6;--ok:#3fd08a;--warn:#e2b04a;--ink:#eef9fd;--mut:#8fb0c2;--dim:#5f7f91;--line:rgba(82,193,230,.22);--panel:rgba(13,30,43,.72);--disp:"Orbitron","Eurostile","Segoe UI",system-ui,sans-serif;padding-bottom:56px}
${S} *{box-sizing:border-box}
${S} :where(h1,h2,h3,p,ul,ol,li){margin:0;padding:0;list-style:none;font-weight:inherit;font-size:inherit}
${S} .mock-btn{font:inherit;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;white-space:nowrap}
${S} .mock-btn:hover{border-color:var(--a);color:#fff}
${S} .mock-btn.mock-primary{background:var(--a);border-color:var(--a);color:#04121b;font-weight:600}
${S} .mock-btn.mock-quiet{border-color:transparent;color:var(--mut);padding-inline:8px}
${S} .mock-top{display:flex;align-items:center;gap:16px;padding:10px 24px;border-bottom:1px solid var(--line);background:rgba(5,11,19,.7);font-size:13px;color:var(--mut)}
${S} .mock-top b{color:var(--ink);font-weight:600}
${S} .mock-top .mock-search{margin-left:auto;border:1px solid var(--line);border-radius:8px;padding:6px 12px;min-width:240px;color:var(--dim)}
${S} .mock-page{max-width:1180px;margin:0 auto;padding:40px 24px 0;display:flex;flex-direction:column;gap:14px}
${S} .mock-stack{position:relative;display:flex;flex-direction:column;gap:14px;padding-left:36px}
${S} .mock-stack::before{content:'';position:absolute;left:16px;top:14px;bottom:14px;width:2px;border-radius:2px;background:linear-gradient(180deg,rgba(82,193,230,.55),var(--ok) 45%,rgba(95,127,145,.35))}
${S} .mock-node{position:relative}
${S} .mock-node::before{content:'';position:absolute;left:-26px;top:30px;width:10px;height:10px;border-radius:50%;background:var(--dim);border:2px solid #050b13}
${S} .mock-node.mock-live::before{width:14px;height:14px;left:-28px;top:28px;background:var(--ok);box-shadow:0 0 12px var(--ok)}
${S} .mock-node.mock-next::before{background:var(--a)}
${S} .mock-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
${S} .mock-live .mock-card{border-color:rgba(63,208,138,.55);background:linear-gradient(135deg,rgba(63,208,138,.1),var(--panel) 60%)}
${S} .mock-next .mock-card{border-color:rgba(82,193,230,.45);background:linear-gradient(135deg,rgba(82,193,230,.1),var(--panel) 60%)}
${S} .mock-old .mock-card{opacity:.86}
${S} .mock-ch{display:grid;grid-template-columns:116px 150px minmax(0,1fr) auto;align-items:center;gap:10px 18px;padding:14px 16px}
${S} .mock-live .mock-ch{padding-block:20px}
${S} .mock-status{display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 8px;border-radius:6px;font-family:var(--disp);font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;text-align:center;color:var(--dim);background:rgba(95,127,145,.16)}
${S} .mock-status small{font-family:"Segoe UI",system-ui,sans-serif;font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;opacity:.85;white-space:nowrap}
${S} .mock-live .mock-status{color:#04121b;background:var(--ok);box-shadow:0 0 18px rgba(63,208,138,.35)}
${S} .mock-next .mock-status{color:var(--a);background:rgba(82,193,230,.2)}
${S} .mock-ver{font-family:var(--disp);font-size:18px;font-weight:600;color:var(--ink)}
${S} .mock-live .mock-ver{font-size:30px}
${S} .mock-next .mock-ver{font-size:23px}
${S} .mock-sent{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12.5px;color:var(--mut)}
${S} .mock-sent b{color:var(--ink);font-weight:500;font-size:13.5px}
${S} .mock-teaser{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
${S} .mock-teaser i{display:block;width:96px;height:60px;border-radius:6px;border:1px solid rgba(82,193,230,.35);background:linear-gradient(135deg,#123247,#0a1c2a 60%,#16405a)}
${S} .mock-teaser i.mock-rest{width:40px;border-style:dashed;background:none;display:flex;align-items:center;justify-content:center;color:var(--mut);font-style:normal}
${S} .mock-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid rgba(63,208,138,.45);color:var(--ok);font-size:12px;white-space:nowrap}
${S} .mock-chip.mock-early{border-color:var(--line);color:var(--dim)}
${S} .mock-inset{border-top:1px solid rgba(82,193,230,.12);padding:12px 16px 14px;display:flex;flex-direction:column;gap:8px;font-size:12.5px;color:var(--mut)}
${S} .mock-inset b{color:var(--ink);font-weight:600}
${S} .mock-rail{position:relative;height:8px;border-radius:4px;background:rgba(95,127,145,.25)}
${S} .mock-rail::before{content:'';position:absolute;inset:0 38% 0 0;border-radius:4px;background:linear-gradient(90deg,var(--ok),var(--a))}
${S} .mock-rail::after{content:'';position:absolute;right:14%;top:-4px;width:2px;height:16px;background:var(--ink)}
${S} .mock-subs{position:relative;margin:0 16px 14px 150px;padding-left:16px;display:flex;flex-direction:column}
${S} .mock-subs::before{content:'';position:absolute;left:0;top:-4px;bottom:14px;width:2px;border-radius:2px;background:rgba(82,193,230,.35)}
${S} .mock-subs-h{padding:0 0 4px 10px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
${S} .mock-sv{position:relative;display:grid;grid-template-columns:14px 62px minmax(0,1fr) auto 104px 96px;gap:10px;align-items:center;padding:7px 10px;border-radius:8px;min-height:40px;font-size:13px;color:var(--mut);text-decoration:none}
${S} .mock-sv:hover{background:rgba(82,193,230,.08);color:var(--ink)}
${S} .mock-sv .mock-sl{font-family:var(--disp);font-size:12.5px;color:var(--ink)}
${S} .mock-sv .mock-svt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .mock-sv time{text-align:right;font-size:12px;color:var(--dim);white-space:nowrap}
${S} .mock-sv em{font-style:normal;font-size:12px;color:var(--dim)}
${S} .mock-tags{display:inline-flex;gap:6px}
${S} .mock-tag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);background:rgba(95,127,145,.22);white-space:nowrap}
${S} .mock-tag.mock-t-live{color:#04121b;background:var(--ok)}
${S} .mock-tag.mock-t-ptu{color:var(--a);background:rgba(82,193,230,.2)}
${S} .mock-dot{width:9px;height:9px;border-radius:50%;background:transparent;justify-self:center}
${S} .mock-dot.mock-unread{background:var(--a);box-shadow:0 0 8px var(--a)}
${S} .mock-dot.mock-read{background:none;width:auto;height:auto;color:var(--dim);font-size:12px}
${S} .mock-sv.mock-is-unread .mock-svt,${S} .mock-sv.mock-is-unread .mock-sl{color:#fff;font-weight:600}
${S} .mock-more{align-self:flex-start;font:inherit;font-size:12.5px;color:var(--mut);background:none;border:0;padding:8px 10px;cursor:pointer}
${S} .mock-more:hover{color:var(--a)}
${S} .mock-bundle{margin:2px 0 0;border:1px dashed rgba(95,127,145,.45);border-radius:8px}
${S} .mock-bundle>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:12.5px;color:var(--mut)}
${S} .mock-bundle>summary::-webkit-details-marker{display:none}
${S} .mock-bundle>summary::before{content:'›';color:var(--a);font-size:15px;transition:transform .16s}
${S} .mock-bundle[open]>summary::before{transform:rotate(90deg)}
${S} .mock-bundle>summary b{color:var(--ink);font-weight:600}
${S} .mock-bundle>summary span{margin-left:auto;color:var(--dim)}
${S} .mock-bundle>summary:hover{color:var(--ink)}
${S} .mock-fold{display:flex;align-items:center;gap:8px;padding:10px 16px;border:1px dashed rgba(95,127,145,.4);border-radius:10px;color:var(--mut);font-size:12.5px}
${S} .mock-fold::before{content:'›';color:var(--a)}
${S} .mock-new{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;background:var(--a);color:#04121b;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
${S} .mock-list{display:flex;flex-direction:column;gap:5px;font-size:13.5px;color:#cfe8f3}
${S} .mock-list li{position:relative;padding-left:16px}
${S} .mock-list li::before{content:'';position:absolute;left:2px;top:9px;width:5px;height:5px;border-radius:50%;background:var(--a)}
${S} .mock-list li.mock-fix::before{background:var(--ok)}
${S} .mock-list li.mock-known::before{background:var(--warn)}
${S} .mock-kicker{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}

/* ── d1: Neu-Leiste über dem Zeitstrahl ── */
${S} .d1-inbox{border:1px solid rgba(82,193,230,.6);border-radius:14px;background:linear-gradient(135deg,rgba(82,193,230,.16),rgba(13,30,43,.85) 55%);box-shadow:0 0 34px -14px var(--a);overflow:hidden}
${S} .d1-inbox-h{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
${S} .d1-inbox-h h2{font-family:var(--disp);font-size:15px;letter-spacing:.08em;color:#fff}
${S} .d1-inbox-h .d1-count{color:var(--a);font-size:13px}
${S} .d1-inbox-h .mock-btn{margin-left:auto}
${S} .d1-hero{display:grid;grid-template-columns:190px minmax(0,1fr) auto;gap:18px;align-items:start;padding:16px}
${S} .d1-hero-v{display:flex;flex-direction:column;gap:6px}
${S} .d1-hero-v strong{font-family:var(--disp);font-size:30px;color:#fff;line-height:1}
${S} .d1-hero-v small{color:var(--mut);font-size:12px}
${S} .d1-hero-act{display:flex;flex-direction:column;gap:8px;align-items:stretch}
${S} .d1-item{display:grid;grid-template-columns:14px 62px minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:9px 16px;border-top:1px solid var(--line);font-size:13px;color:var(--mut)}
${S} .d1-item b{color:var(--ink);font-family:var(--disp);font-size:12.5px}
${S} .d1-done{display:flex;align-items:center;gap:12px;padding:10px 16px;border:1px solid rgba(63,208,138,.35);border-radius:12px;background:rgba(63,208,138,.07);color:var(--mut);font-size:13px}
${S} .d1-done b{color:var(--ok);font-weight:600}
${S} .d1-done .mock-btn{margin-left:auto}

/* ── d2: Live-Karte zeigt den neuesten Stand ── */
${S} .d2-card{position:relative}
${S} .d2-card.d2-unread{box-shadow:inset 4px 0 0 var(--a),0 0 34px -16px var(--a)}
${S} .d2-ver{display:flex;flex-direction:column;gap:4px}
${S} .d2-ver small{font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;font-weight:400;color:var(--mut)}
${S} .d2-ver small b{color:#fff;font-family:var(--disp);font-weight:600}
${S} .d2-delta{margin:0 16px 12px 150px;padding:14px 16px;border:1px solid rgba(82,193,230,.45);border-radius:10px;background:rgba(5,14,22,.6);display:flex;flex-direction:column;gap:10px}
${S} .d2-delta-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
${S} .d2-delta-h h3{font-family:var(--disp);font-size:15px;color:#fff}
${S} .d2-delta-h time{margin-left:auto;font-size:12px;color:var(--dim)}
${S} .d2-cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
${S} .d2-cols h4{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:600}
${S} .d2-act{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
${S} .d2-act span{margin-left:auto;font-size:12px;color:var(--dim)}
${S} .d2-trail{margin:0 16px 14px 150px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;color:var(--mut)}
${S} .d2-trail a{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;border:1px solid rgba(95,127,145,.4);color:var(--mut);text-decoration:none;font-family:var(--disp);font-size:11.5px}
${S} .d2-trail a:hover{border-color:var(--a);color:#fff}
${S} .d2-trail a.d2-cur{border-color:var(--a);color:#fff}
${S} .d2-trail a i{font-style:normal;color:var(--ok);font-family:"Segoe UI",system-ui,sans-serif}
${S} .d2-readline{margin:0 16px 12px 150px;display:flex;align-items:center;gap:12px;font-size:13px;color:var(--mut)}
${S} .d2-readline b{color:var(--ok);font-weight:600}
${S} .d2-readline .mock-btn{margin-left:auto}
${S} .d2-hint{display:inline-flex;align-items:center;gap:8px;margin-top:2px;font-size:12px;color:var(--a)}

/* ── d3: Liste links, Lesen rechts ── */
${S} .d3-split{display:grid;grid-template-columns:320px minmax(0,1fr);gap:16px;align-items:start}
${S} .d3-side{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
${S} .d3-filter{display:flex;gap:6px;padding:10px;border-bottom:1px solid var(--line)}
${S} .d3-filter span{flex:1;text-align:center;padding:6px 8px;border-radius:999px;font-size:12.5px;color:var(--mut);border:1px solid transparent}
${S} .d3-filter span.d3-on{border-color:var(--a);color:#fff;background:rgba(82,193,230,.14)}
${S} .d3-group{padding:10px 12px 4px;display:flex;align-items:center;gap:8px;font-family:var(--disp);font-size:12px;color:var(--ink)}
${S} .d3-group .mock-tag{margin-left:auto}
${S} .d3-row{display:grid;grid-template-columns:12px 58px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 12px;font-size:12.5px;color:var(--mut);border-left:3px solid transparent;text-decoration:none}
${S} .d3-row:hover{background:rgba(82,193,230,.08)}
${S} .d3-row b{font-family:var(--disp);font-size:12px;color:var(--ink);font-weight:500}
${S} .d3-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .d3-row time{font-size:11.5px;color:var(--dim)}
${S} .d3-row.d3-sel{background:rgba(82,193,230,.14);border-left-color:var(--a);color:#fff}
${S} .d3-row.d3-unread b,${S} .d3-row.d3-unread span{color:#fff;font-weight:600}
${S} .d3-side .mock-bundle{margin:4px 10px 8px}
${S} .d3-side .mock-fold{margin:8px 10px 10px;border-radius:8px}
${S} .d3-pane{border:1px solid rgba(82,193,230,.45);border-radius:12px;background:var(--panel);display:flex;flex-direction:column;min-height:560px}
${S} .d3-pane-h{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 20px;border-bottom:1px solid var(--line)}
${S} .d3-pane-h h2{font-family:var(--disp);font-size:24px;color:#fff}
${S} .d3-pane-h time{margin-left:auto;font-size:12.5px;color:var(--dim)}
${S} .d3-body{padding:18px 20px;display:flex;flex-direction:column;gap:18px;flex:1}
${S} .d3-body h3{margin-bottom:8px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);font-weight:600}
${S} .d3-bar{display:flex;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid var(--line);background:rgba(5,11,19,.6);border-radius:0 0 12px 12px}
${S} .d3-bar span{margin-left:auto;font-size:12px;color:var(--dim)}
${S} .d3-kbd{display:inline-block;padding:0 6px;border:1px solid var(--line);border-radius:4px;font-size:11px;color:var(--mut)}
${S} .d3-calm{align-items:center;justify-content:center;text-align:center;gap:14px}
${S} .d3-calm .d3-check{width:64px;height:64px;border-radius:50%;border:2px solid var(--ok);display:flex;align-items:center;justify-content:center;font-size:30px;color:var(--ok);box-shadow:0 0 26px -6px var(--ok)}
${S} .d3-calm h2{font-family:var(--disp);font-size:20px;color:#fff}
${S} .d3-calm p{color:var(--mut);max-width:46ch}
${S} .d3-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;width:100%;max-width:640px}
${S} .d3-facts div{border:1px solid var(--line);border-radius:10px;padding:10px 12px;text-align:left;font-size:12px;color:var(--mut)}
${S} .d3-facts b{display:block;color:var(--ink);font-family:var(--disp);font-size:15px;margin-bottom:2px}

@container device (max-width: 520px){
${S} .mock-top{padding:10px 14px}
${S} .mock-top .mock-search{display:none}
${S} .mock-page{padding:14px 12px 0}
${S} .mock-stack{padding-left:18px}
${S} .mock-stack::before{left:5px}
${S} .mock-node::before{left:-17px;top:14px}
${S} .mock-node.mock-live::before{left:-19px;top:12px}
${S} .mock-ch{grid-template-columns:104px minmax(0,1fr);padding:12px}
${S} .mock-ch .mock-sent,${S} .mock-ch .mock-chip{grid-column:1 / -1;justify-self:start}
${S} .mock-live .mock-ver{font-size:24px}
${S} .mock-teaser i{width:84px;height:52px}
${S} .mock-subs,${S} .d2-delta,${S} .d2-trail,${S} .d2-readline{margin:0 12px 12px}
${S} .mock-sv{grid-template-columns:14px 56px minmax(0,1fr) auto}
${S} .mock-sv em,${S} .mock-sv .mock-chip,${S} .mock-sv time{display:none}
${S} .d1-hero{grid-template-columns:minmax(0,1fr)}
${S} .d1-hero-act{flex-direction:row;flex-wrap:wrap}
${S} .d1-item{grid-template-columns:14px 56px minmax(0,1fr)}
${S} .d1-item time,${S} .d1-item .mock-btn{display:none}
${S} .d1-inbox-h{flex-wrap:wrap}
${S} .d2-cols{grid-template-columns:minmax(0,1fr)}
${S} .d3-split{grid-template-columns:minmax(0,1fr)}
${S} .d3-pane{min-height:0}
${S} .d3-facts{grid-template-columns:minmax(0,1fr)}
${S} .d3-bar{flex-wrap:wrap}
}
`;

// ── shared pieces ────────────────────────────────────────────────────────────
const top = `<div class="mock-top"><span>Verse</span><span>›</span><b>Patches</b><span class="mock-search">Patches durchsuchen …</span></div>`;

const teaser = `<span class="mock-teaser"><i></i><i></i><i></i><i></i><i></i><i class="mock-rest">…</i></span>`;

function nextCard(extra = '') {
  return `<div class="mock-node mock-next"><div class="mock-card">
  <div class="mock-ch"><span class="mock-status">Als Nächstes<small>Q4 2026</small></span><span class="mock-ver">Alpha 4.11</span>
    <span class="mock-sent"><b>PTU erwartet in ~3 Wochen</b>${extra}${teaser}</span><span></span></div>
  <div class="mock-inset"><span><b>Nächster Live-Patch ~ 16. Dez.</b> · in ~5 Wochen · im üblichen Takt</span><div class="mock-rail"></div><span>Alpha 4.10 live seit 7. Okt. · üblich 68 Tage · Alpha 4.11</span></div>
</div></div>`;
}

const lastCard = `<div class="mock-node mock-old"><div class="mock-card">
  <div class="mock-ch"><span class="mock-status">Abgelöst<small>am 7. Okt.</small></span><span class="mock-ver">Alpha 4.9</span>
    <span class="mock-sent"><b>Live 12. Aug. – 7. Okt.</b><span>3 Hotfixes, letzter 24. Sept.</span></span><span class="mock-chip">84 % stabil</span></div>
  <div class="mock-subs"><span class="mock-more">6 Versionen anzeigen</span></div>
</div></div>`;

const fold = `<div class="mock-node"><div class="mock-fold">Ältere Patches · 4.8 · 4.7 · 4.6</div></div>`;

/** One sub-version row. state: 'unread' | 'read' | '' */
function sv(ver, title, tags, stab, when, state = '') {
  const dot = state === 'unread' ? '<span class="mock-dot mock-unread"></span>'
    : state === 'read' ? '<span class="mock-dot mock-read">✓</span>' : '<span class="mock-dot"></span>';
  const st = stab ? `<span class="mock-chip">${stab}</span>` : '<em>noch früh</em>';
  return `<a class="mock-sv${state === 'unread' ? ' mock-is-unread' : ''}"${state === 'unread' ? ' data-m="row-new"' : ''}>${dot}<span class="mock-sl">${ver}</span><span class="mock-svt">${title}</span><span class="mock-tags">${tags}</span>${st}<time>${when}</time></a>`;
}
const T_LIVE = '<span class="mock-tag mock-t-live">Live</span>';
const T_PTU = '<span class="mock-tag mock-t-ptu">PTU</span>';
const T_HF = '<span class="mock-tag">Hotfix</span>';

const olderRows = (state) => [
  sv('4.10.2', 'Alpha 4.10.2 Hotfix', T_LIVE + T_HF, '81 %', 'vor 12 Tagen', state),
  sv('4.10.2', 'Alpha 4.10.2 LIVE Patch Notes', T_LIVE, '74 %', 'vor 3 Wochen', state),
  sv('4.10.1', 'Alpha 4.10.1 LIVE Patch Notes', T_LIVE, '69 %', 'vor 4 Wochen', state),
  sv('4.10.0', 'Alpha 4.10.0 LIVE Release Notes', T_LIVE, '62 %', 'vor 5 Wochen', state),
].join('');

const bundle = (label = '4 frühere Updates der 4.10', right = 'alle gelesen ✓') =>
  `<details class="mock-bundle" data-m="bundle"><summary><b>${label}</b> 4.10.2 Hotfix · 4.10.2 · 4.10.1 · 4.10.0<span>${right}</span></summary>${olderRows('read')}<span class="mock-more">5 frühere Test-Builds anzeigen</span></details>`;

const liveHead = (verHtml = '<span class="mock-ver">Alpha 4.10</span>') =>
  `<div class="mock-ch"><span class="mock-status">Live<small>seit 34 Tagen</small></span>${verHtml}
    <span class="mock-sent"><b>Seit 7. Okt. live</b><span>2 Hotfixes, letzter 29. Okt. · nächster Live-Patch in ~5 Wochen (Schätzung)</span></span><span class="mock-chip">78 % stabil</span></div>`;

const bullets = {
  feat: ['Neue Waffe: LBCO Skarnov Rifle', 'Neue Missionen: Vanduul Incursion'],
  fix: ['Performance und Feinschliff für IAE und Vanduul Incursion', '4-GB-Grenze des Vulkan-Pipeline-Caches entfernt'],
  known: ['mobiGlas-Karte ruckelt in Pyro', 'ASOP-Terminal braucht teils zwei Versuche'],
};
const li = (arr, cls = '') => arr.map((t) => `<li${cls ? ` class="${cls}"` : ''}>${t}</li>`).join('');

function anno(id, n, side, target, q, x = 50, y = 40) {
  return `<div class="anno" data-anno="${id}" data-anno-side="${side}" data-anno-target="${target.replace(/"/g, '&quot;')}" style="--anno-x:${x}%;--anno-y:${y}%"><button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{anno.pin_label}}">${n}</button><div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false"><button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}"><span class="anno-bubble-question">${q}</span></button><div class="anno-bubble-body"><textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea><div class="attach-slot" data-attach-slot="anno-${id}"></div></div></div></div>`;
}
const layer = (...a) => `<div class="anno-layer" data-anno-layer>${a.join('')}</div>`;

// ── d1 ───────────────────────────────────────────────────────────────────────
const d1s1 = `<div class="mock-pb d1">${top}<div class="mock-page">
  <section class="d1-inbox" data-m="inbox">
    <div class="d1-inbox-h"><h2>NEU FÜR DICH</h2><span class="d1-count">2 ungelesen seit deinem letzten Besuch (3. Nov.)</span><a class="mock-btn" data-screen-link="next" data-m="all-read">✓ Alles gelesen</a></div>
    <div class="d1-hero">
      <div class="d1-hero-v"><span class="mock-tags">${T_PTU}<span class="mock-new">Neu</span></span><strong>4.10.3</strong><small>PTU Patch Notes · vor 2 Std.</small></div>
      <ul class="mock-list">${li(bullets.feat.slice(0, 1))}${li(bullets.fix.slice(0, 2), 'mock-fix')}${li(bullets.known.slice(0, 1), 'mock-known')}<li style="color:var(--mut)">+ 2 weitere Änderungen</li></ul>
      <div class="d1-hero-act"><a class="mock-btn mock-primary">Ganz lesen →</a><a class="mock-btn" data-screen-link="next">✓ Gelesen</a></div>
    </div>
    <div class="d1-item"><span class="mock-dot mock-unread"></span><b>4.11</b><span>2 neue Roadmap-Einträge: „Engineering Tier 0“, „Genesis-Wolken auf Hurston“</span><time>gestern</time><a class="mock-btn mock-quiet">✓</a></div>
  </section>
  <div class="mock-stack">
    ${nextCard()}
    <div class="mock-node mock-live"><div class="mock-card">${liveHead()}
      <div class="mock-subs"><span class="mock-subs-h">Versionen von 4.10</span>
        ${sv('4.10.3', 'Alpha 4.10.3 PTU Patch Notes', T_PTU, '', 'vor 2 Std.', 'unread')}
        ${bundle()}
      </div></div></div>
    ${lastCard}${fold}
  </div></div></div>
${layer(
  anno('r1-d1-s1-a1', 1, 'bottom', '[data-m="all-read"]', 'Reicht dir ein Knopf „Alles gelesen“, oder willst du jede Patch-Note einzeln abhaken können (beides ist hier drin)?'),
  anno('r1-d1-s1-a2', 2, 'right', '[data-m="row-new"] .mock-sl', '4.10.3 ist erst im PTU. Soll oben immer der neueste Build stehen (auch PTU), oder nur, was schon live spielbar ist?'),
  anno('r1-d1-s1-a3', 3, 'bottom', '[data-m="bundle"] summary b', 'Die kleinen Patches darunter sind zu einer Zeile gebündelt (Klick klappt auf). Reicht die Liste, oder willst du zusätzlich eine zusammengefasste Änderungsliste über alle vier?'),
)}`;

const d1s2 = `<div class="mock-pb d1">${top}<div class="mock-page">
  <div class="d1-done" data-m="done"><b>✓ Du bist auf Stand</b><span>Zuletzt gelesen: 4.10.3 · heute 17:52</span><a class="mock-btn mock-quiet" data-screen-link="prev">Rückgängig</a></div>
  <div class="mock-stack">
    ${nextCard()}
    <div class="mock-node mock-live"><div class="mock-card">${liveHead()}
      <div class="mock-subs"><span class="mock-subs-h">Versionen von 4.10</span>
        ${sv('4.10.3', 'Alpha 4.10.3 PTU Patch Notes', T_PTU, '', 'vor 2 Std.', 'read')}
        ${bundle()}
      </div></div></div>
    ${lastCard}${fold}
  </div></div></div>
${layer(
  anno('r1-d1-s2-a1', 1, 'bottom', '[data-m="done"] b', 'Wenn alles gelesen ist, schrumpft die Leiste auf diese eine Zeile. Soll sie dann ganz verschwinden, oder ist die Bestätigung so richtig?'),
)}`;

// ── d2 ───────────────────────────────────────────────────────────────────────
const d2ver = `<span class="mock-ver d2-ver">Alpha 4.10<small>neuester Stand <b>4.10.3</b></small></span>`;
const trail = (cur) => `<div class="d2-trail" data-m="trail"><span>Verlauf:</span><a class="${cur ? 'd2-cur' : ''}">4.10.3 ${cur ? '' : '<i>✓</i>'}</a><a>4.10.2 Hotfix <i>✓</i></a><a>4.10.2 <i>✓</i></a><a>4.10.1 <i>✓</i></a><a>4.10.0 <i>✓</i></a><span class="mock-more" style="padding:0 4px">+ 5 Test-Builds</span></div>`;

const d2s1 = `<div class="mock-pb d2">${top}<div class="mock-page">
  <div class="mock-stack">
    ${nextCard('<span class="d2-hint"><span class="mock-new">Neu</span> 2 Roadmap-Einträge seit deinem letzten Besuch</span>')}
    <div class="mock-node mock-live"><div class="mock-card d2-card d2-unread">${liveHead(d2ver)}
      <div class="d2-delta" data-m="delta">
        <div class="d2-delta-h"><span class="mock-new">Neu für dich</span><h3>Das ändert 4.10.3</h3>${T_PTU}<time>vor 2 Std.</time></div>
        <div class="d2-cols">
          <div><h4>Neu · 2</h4><ul class="mock-list">${li(bullets.feat)}</ul></div>
          <div><h4>Behoben · 2</h4><ul class="mock-list">${li(bullets.fix, 'mock-fix')}</ul></div>
          <div><h4>Bekannte Probleme · 2</h4><ul class="mock-list">${li(bullets.known, 'mock-known')}</ul></div>
        </div>
        <div class="d2-act"><a class="mock-btn mock-primary" data-screen-link="next" data-m="read">✓ Gelesen</a><a class="mock-btn">Im Dossier lesen →</a><span>Lesezeit ~1 Min.</span></div>
      </div>
      ${trail(true)}
    </div></div>
    ${lastCard}${fold}
  </div></div></div>
${layer(
  anno('r1-d2-s1-a1', 1, 'top', '[data-m="delta"] h3', 'Die Änderungen stehen direkt auf der Karte, ohne Klick ins Dossier. Sind drei Spalten (Neu / Behoben / Bekannte Probleme) die richtige Kürzung, oder willst du hier den vollen Text?'),
  anno('r1-d2-s1-a2', 2, 'right', '[data-m="read"]', 'Soll „gelesen“ erst mit diesem Klick gelten, oder schon automatisch, sobald du die Seite ein paar Sekunden offen hattest?'),
  anno('r1-d2-s1-a3', 3, 'bottom', '[data-m="trail"] span', 'Die früheren kleinen Patches sind nur noch eine Zeile aus Marken. Reicht das, oder brauchst du pro Version wieder Stabilität und Datum wie heute?'),
)}`;

const d2s2 = `<div class="mock-pb d2">${top}<div class="mock-page">
  <div class="mock-stack">
    ${nextCard()}
    <div class="mock-node mock-live"><div class="mock-card d2-card">${liveHead(d2ver)}
      <div class="d2-readline" data-m="readline"><b>✓ 4.10.3 gelesen</b><span>heute 17:52 · seitdem nichts Neues</span><a class="mock-btn mock-quiet" data-screen-link="prev">Nochmal lesen</a></div>
      ${trail(false)}
    </div></div>
    ${lastCard}${fold}
  </div></div></div>
${layer(
  anno('r1-d2-s2-a1', 1, 'bottom', '[data-m="readline"] b', 'Nach dem Lesen fällt die Karte auf zwei Zeilen zusammen. Zu wenig (du willst die drei Spalten weiter sehen), oder genau richtig ruhig?'),
)}`;

// ── d3 ───────────────────────────────────────────────────────────────────────
function d3side(read) {
  const u = (on) => (on && !read ? '<span class="mock-dot mock-unread"></span>' : '<span class="mock-dot"></span>');
  return `<aside class="d3-side">
    <div class="d3-filter" data-m="filter"><span class="${read ? '' : 'd3-on'}">Ungelesen · ${read ? 0 : 2}</span><span class="${read ? 'd3-on' : ''}">Alle</span></div>
    <div class="d3-group">Alpha 4.11 <span class="mock-tag mock-t-ptu">Als Nächstes</span></div>
    <a class="d3-row${read ? '' : ' d3-unread'}">${u(true)}<b>4.11</b><span>2 neue Roadmap-Einträge</span><time>gestern</time></a>
    <div class="d3-group">Alpha 4.10 ${T_LIVE}</div>
    <a class="d3-row${read ? '' : ' d3-unread d3-sel'}" data-m="row-sel">${u(true)}<b>4.10.3</b><span>PTU Patch Notes</span><time>2 Std.</time></a>
    <details class="mock-bundle" data-m="bundle"><summary><b>4.10.0 – 4.10.2</b><span>4 gelesen ✓</span></summary>
      <a class="d3-row"><span class="mock-dot"></span><b>4.10.2</b><span>Hotfix</span><time>12 Tg.</time></a>
      <a class="d3-row"><span class="mock-dot"></span><b>4.10.2</b><span>LIVE Patch Notes</span><time>3 Wo.</time></a>
      <a class="d3-row"><span class="mock-dot"></span><b>4.10.1</b><span>LIVE Patch Notes</span><time>4 Wo.</time></a>
      <a class="d3-row"><span class="mock-dot"></span><b>4.10.0</b><span>LIVE Release Notes</span><time>5 Wo.</time></a>
    </details>
    <div class="d3-group">Alpha 4.9 <span class="mock-tag">Abgelöst</span></div>
    <details class="mock-bundle"><summary><b>4.9.0 – 4.9.2</b><span>6 gelesen ✓</span></summary></details>
    <div class="mock-fold">Ältere Patches · 4.8 · 4.7 · 4.6</div>
  </aside>`;
}

const d3s1 = `<div class="mock-pb d3">${top}<div class="mock-page"><div class="d3-split">
  ${d3side(false)}
  <article class="d3-pane">
    <div class="d3-pane-h"><h2>Alpha 4.10.3</h2>${T_PTU}<span class="mock-chip mock-early">Stabilität: noch früh</span><time>veröffentlicht vor 2 Std.</time></div>
    <div class="d3-body">
      <div><h3>Neu · 2</h3><ul class="mock-list">${li(bullets.feat)}</ul></div>
      <div><h3>Behoben · 2</h3><ul class="mock-list">${li(bullets.fix, 'mock-fix')}</ul></div>
      <div><h3>Bekannte Probleme · 2</h3><ul class="mock-list">${li(bullets.known, 'mock-known')}</ul></div>
      <div><a class="mock-btn mock-quiet">Original auf Spectrum ↗</a><a class="mock-btn mock-quiet">Ganzes Dossier zu 4.10 →</a></div>
    </div>
    <div class="d3-bar" data-m="bar"><a class="mock-btn mock-primary" data-screen-link="next" data-m="next">✓ Gelesen &amp; weiter</a><a class="mock-btn">Später</a><span>1 von 2 ungelesen · <i class="d3-kbd">J</i> <i class="d3-kbd">K</i> blättern</span></div>
  </article>
</div></div></div>
${layer(
  anno('r1-d3-s1-a1', 1, 'top', '[data-m="next"]', '„Gelesen &amp; weiter“ hakt ab und springt zur nächsten ungelesenen Note. Willst du so durchklicken, oder lieber frei in der Liste wählen und nur abhaken?'),
  anno('r1-d3-s1-a2', 2, 'right', '[data-m="filter"] span', 'Die Liste startet auf „Ungelesen“. Richtig so, oder soll sie immer alle Versionen zeigen und Ungelesenes nur hervorheben?'),
  anno('r1-d3-s1-a3', 3, 'right', '[data-m="bundle"] summary b', 'Kleine Patches sind als Spanne „4.10.0 – 4.10.2“ gebündelt. Soll ein Klick darauf rechts eine zusammengefasste Sicht aller vier zeigen, oder nur die Liste aufklappen?'),
)}`;

const d3s2 = `<div class="mock-pb d3">${top}<div class="mock-page"><div class="d3-split">
  ${d3side(true)}
  <article class="d3-pane">
    <div class="d3-body d3-calm" data-m="calm">
      <span class="d3-check">✓</span><h2>Alles gelesen</h2>
      <p>Du kennst jeden Stand bis 4.10.3. Sobald RSI etwas Neues veröffentlicht, steht es hier oben.</p>
      <div class="d3-facts"><div><b>4.10 live</b>seit 34 Tagen · 78 % stabil</div><div><b>~ 16. Dez.</b>nächster Live-Patch (Schätzung)</div><div><b>4.11</b>PTU erwartet in ~3 Wochen</div></div>
      <a class="mock-btn mock-quiet" data-screen-link="prev">4.10.3 nochmal öffnen</a>
    </div>
  </article>
</div></div></div>
${layer(
  anno('r1-d3-s2-a1', 1, 'top', '[data-m="calm"] h2', 'Ist alles gelesen, zeigt die rechte Seite den Lagebericht (Live-Stand, nächster Patch). Passt das, oder soll dort immer die neueste Note offen bleiben?'),
)}`;

const icon = (d) => `&lt;svg viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.8&quot;&gt;${d}&lt;/svg&gt;`;
const I1 = icon('&lt;rect x=&quot;3&quot; y=&quot;3&quot; width=&quot;18&quot; height=&quot;6&quot; rx=&quot;2&quot;/&gt;&lt;path d=&quot;M5 14h14M5 18h14&quot;/&gt;');
const I2 = icon('&lt;rect x=&quot;3&quot; y=&quot;5&quot; width=&quot;18&quot; height=&quot;14&quot; rx=&quot;2&quot;/&gt;&lt;path d=&quot;M7 10h10M7 14h6&quot;/&gt;');
const I3 = icon('&lt;rect x=&quot;3&quot; y=&quot;4&quot; width=&quot;18&quot; height=&quot;16&quot; rx=&quot;2&quot;/&gt;&lt;path d=&quot;M9 4v16M12 9h6M12 13h6&quot;/&gt;');

const design = (id, label, motto, traits, ic, color, active, s1, s2, demo) => `
<section data-design="${id}" data-nav-label="${label}"${active ? ' data-design-active="true"' : ' hidden'} data-screen-fit="full" data-design-motto="${motto}" data-design-traits="${traits}" data-design-icon="${ic}" data-design-color="${color}" data-ov-fit="component" data-ov-demo="${demo}">
<section id="${id}-s1" data-nav-label="Neues ungelesen" data-screen data-screen-active="true">${s1}</section>
<section id="${id}-s2" data-nav-label="Alles gelesen" data-screen hidden>${s2}</section>
</section>`;

const html = `<section data-iteration="1" data-iteration-template="design" data-tab-label="Runde 1" data-design-set="alternatives" data-viewports="desktop phone">
<style>${css}</style>
<header class="iteration-intro"><h2>{{iteration.tab}} 1 · Wo steht das Neue, und was passiert nach dem Lesen?</h2><p>Drei Wege für dieselbe Lage: 4.10 ist live und gelesen, 4.10.3 ist neu. Fest steht in allen dreien: der Lesestand hängt am Konto (alle Geräte, ohne Anmeldung nur in diesem Browser), gelesen wird je Patch-Note, und die kleinen Patches unter dem neuesten sind gebündelt.</p></header>
${design('d1', 'Neu-Leiste oben', 'Leiste „Neu für dich“ über dem Zeitstrahl', 'Eigene Leiste ganz oben sammelt alles Ungelesene, der Zeitstrahl darunter bleibt wie heute|Ein Knopf „Alles gelesen“ für die ganze Leiste, danach schrumpft sie auf eine Zeile|Neueste Note groß mit 4 Stichpunkten, weitere Neuigkeiten als kurze Zeilen darunter', I1, '#e2b04a', true, d1s1, d1s2, '.d1-inbox')}
${design('d2', 'Live-Karte mit neuestem Stand', 'Die Live-Karte zeigt, was 4.10.3 ändert', 'Keine Extra-Leiste: die Änderungen stehen in drei Spalten direkt auf der Live-Karte|Nach „Gelesen“ fällt die Karte auf zwei Zeilen zusammen|Frühere kleine Patches als eine Zeile aus Marken mit Haken statt als Tabelle', I2, '#3fd08a', false, d2s1, d2s2, '.d2-card')}
${design('d3', 'Liste links, Lesen rechts', 'Zwei Spalten wie ein Postfach', 'Links alle Versionen als schmale Liste mit Ungelesen-Punkten, rechts der volle Text|„Gelesen &amp; weiter“ springt zur nächsten ungelesenen Note, Tasten J / K blättern|Filter Ungelesen / Alle, kleine Patches als Spanne 4.10.0 – 4.10.2', I3, '#c58af9', false, d3s1, d3s2, '.d3-split')}
</section>
`;

fs.writeFileSync(path.join(__dirname, 'rounds', '01.html'), html.replace(/\r\n/g, '\n'));
console.log('rounds/01.html', html.length, 'bytes');
