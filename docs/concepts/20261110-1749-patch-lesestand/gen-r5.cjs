// Generates rounds/05.html of the patch read-state concept. Run: node gen-r2.cjs
// Round 2 = the owner's chat feedback of 2026-11-19 (verbatim in briefs/02.md).
const fs = require('fs');
const path = require('path');

const S = ':is([data-design], .design-ov-scale) .mock-r5';

const css = `
${S}{position:relative;min-height:100%;box-sizing:border-box;overflow:hidden;background:radial-gradient(ellipse 70% 40% at 50% 0%,#10293a 0%,#081622 55%,#050b13 100%);color:#cfe8f3;font:14px/1.5 "Segoe UI",system-ui,sans-serif;--a:#52c1e6;--ok:#3fd08a;--warn:#e2b04a;--ink:#eef9fd;--mut:#9dbccd;--dim:#6f8fa1;--line:rgba(82,193,230,.22);--panel:rgba(13,30,43,.78);--disp:"Orbitron","Eurostile","Segoe UI",system-ui,sans-serif;padding-bottom:64px}
${S} *{box-sizing:border-box}
${S} :where(h1,h2,h3,h4,p,ul,ol,li){margin:0;padding:0;list-style:none;font-weight:inherit;font-size:inherit}
${S} .mock-btn{font:inherit;font-size:14px;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:999px;padding:7px 15px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;min-height:38px;white-space:nowrap}
${S} .mock-btn:hover{border-color:var(--a);color:#fff}
${S} .mock-btn.mock-primary{background:var(--a);border-color:var(--a);color:#04121b;font-weight:600}
${S} .mock-btn.mock-quiet{border-color:transparent;color:var(--mut);padding-inline:8px}
${S} .mock-top{position:relative;z-index:1;display:flex;align-items:center;gap:16px;padding:12px 28px;border-bottom:1px solid var(--line);background:rgba(5,11,19,.75);font-size:14px;color:var(--mut)}
${S} .mock-top b{color:var(--ink);font-weight:600}
${S} .mock-top .mock-search{margin-left:auto;border:1px solid var(--line);border-radius:8px;padding:7px 12px;min-width:260px;color:var(--dim)}
${S} .mock-planet{position:absolute;left:-400px;top:70px;width:580px;height:580px;border-radius:50%;background:radial-gradient(circle at 62% 38%,#3b7fa0,#123047 55%,#06121c 75%);box-shadow:0 0 80px -10px rgba(82,193,230,.45);opacity:.75;pointer-events:none}
/* the app's page frame: max(1280px, 67 % of the window), margin clamp(16px, 2.5 %, 64px) */
${S} .mock-page{position:relative;z-index:1;width:min(calc(100% - 2 * clamp(16px, 2.5%, 64px)), max(1280px, 67%));margin:0 auto;padding:34px 0 0;display:flex;flex-direction:column;gap:18px}
${S} .mock-tag{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);background:rgba(111,143,161,.22);white-space:nowrap}
${S} .mock-t-live{color:#04121b;background:var(--ok)}
${S} .mock-t-ptu{color:var(--a);background:rgba(82,193,230,.2)}
${S} .mock-new{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;background:var(--a);color:#04121b;font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
${S} .mock-list{display:flex;flex-direction:column;gap:5px;font-size:14px;color:#d8edf6}
${S} .mock-list li{position:relative;padding-left:18px}
${S} .mock-list li::before{content:'';position:absolute;left:2px;top:10px;width:6px;height:6px;border-radius:50%;background:var(--a)}
${S} .mock-list li.mock-fix::before{background:var(--ok)}
${S} .mock-list li.mock-known::before{background:var(--warn)}
${S} .mock-kicker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);font-weight:600}

/* switch */
${S} .mock-switchrow{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
${S} .mock-switch{display:inline-flex;padding:4px;border:1px solid var(--line);border-radius:999px;background:rgba(5,11,19,.6)}
${S} .mock-switch a{display:inline-flex;align-items:center;gap:8px;padding:7px 18px;border-radius:999px;color:var(--mut);text-decoration:none;font-size:14px;cursor:pointer}
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
${S} .mock-box-h h2{font-family:var(--disp);font-size:22px;color:#fff;line-height:1.1}
${S} .mock-box-h .mock-when{margin-left:auto;text-align:right;font-size:14px;color:var(--mut)}
${S} .mock-box-h .mock-when b{display:block;color:var(--ink);font-size:14.5px}
${S} .mock-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
${S} .mock-acts span{margin-left:auto;font-size:13px;color:var(--dim)}
${S} .mock-trio{display:flex;gap:8px;flex-wrap:wrap}
${S} .mock-trio a{display:inline-flex;align-items:baseline;gap:6px;padding:4px 12px;border:1px solid var(--line);border-radius:999px;font-size:13.5px;color:var(--mut);text-decoration:none;cursor:pointer;min-height:32px;align-items:center}
${S} .mock-trio a:hover{border-color:var(--a);color:var(--ink)}
${S} .mock-trio a.mock-open{border-color:var(--ok);background:rgba(63,208,138,.12);color:var(--ink)}
${S} .mock-trio b{font-family:var(--disp);font-size:14px;color:var(--ink)}
${S} .mock-pop{position:absolute;z-index:3;left:20px;right:20px;top:calc(100% - 8px);border:1px solid rgba(63,208,138,.55);border-radius:12px;background:#07131d;box-shadow:0 18px 40px -10px rgba(0,0,0,.7);padding:14px 16px;display:flex;flex-direction:column;gap:8px}
${S} .mock-pop-h{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--mut)}
${S} .mock-pop-h b{font-family:var(--disp);color:#fff;font-size:15px}
${S} .mock-pop-h a{margin-left:auto;color:var(--mut);text-decoration:none;cursor:pointer;font-size:18px;line-height:1}
${S} .mock-pop li{display:flex;gap:10px;font-size:14.5px;color:#d8edf6;padding:3px 0;border-bottom:1px solid rgba(82,193,230,.1)}
${S} .mock-pop li small{margin-left:auto;color:var(--dim);font-size:12.5px;white-space:nowrap}
${S} .mock-box.mock-next{position:relative}
${S} .mock-readnote{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ok)}
${S} .mock-build{border-top:1px solid var(--line)}
${S} .mock-build summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:16px 140px minmax(0,1fr) auto 110px;gap:12px;align-items:center;padding:12px 18px;font-size:14.5px;color:var(--mut)}
${S} .mock-build summary::-webkit-details-marker{display:none}
${S} .mock-build summary b{font-family:var(--disp);font-size:14px;color:var(--ink)}
${S} .mock-build summary time{text-align:right;font-size:13px;color:var(--dim)}
${S} .mock-build[open] summary span{color:#fff;font-weight:600}
${S} .mock-build .mock-list{padding:0 18px 14px 186px;font-size:14px}
${S} .mock-wavehead{display:flex;align-items:center;gap:10px;padding:12px 18px 6px;font-family:var(--disp);font-size:13px;letter-spacing:.08em;color:var(--a);text-transform:uppercase}
${S} .mock-wavehead span{font-family:"Segoe UI",system-ui,sans-serif;letter-spacing:0;text-transform:none;color:var(--dim);font-size:13px}
${S} .mock-textonly{padding:12px 16px;border:1px solid var(--line);border-radius:10px;background:rgba(5,14,22,.55)}
${S} .mock-textonly h4{font-size:16px;color:#fff;font-weight:600;margin-bottom:6px}
${S} .mock-textonly p{font-size:14px;color:var(--mut)}
${S} .mock-trio .mock-c-ok b{color:var(--ok)}
${S} .mock-trio .mock-c-maybe b{color:var(--a)}
${S} .mock-trio .mock-c-late b{color:var(--warn)}
${S} .mock-items{display:flex;flex-direction:column;gap:5px;font-size:14px}
${S} .mock-items li{display:flex;gap:10px;align-items:baseline}
${S} .mock-items li i{font-style:normal;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:1px 8px;border-radius:999px;flex:none}
${S} .mock-items .mock-i-ok{color:#04121b;background:var(--ok)}
${S} .mock-items .mock-i-maybe{color:var(--a);background:rgba(82,193,230,.18)}
${S} .mock-items .mock-i-late{color:#1d1503;background:var(--warn)}
${S} .mock-done{display:flex;align-items:center;gap:12px;font-size:15px;color:var(--mut)}
${S} .mock-done b{color:var(--ok)}

/* timeline with date gutter */
/* the cards keep the frame width; rail and dates hang out to the left of it */
${S} .mock-tl{position:relative;display:flex;flex-direction:column;gap:14px;padding-left:0}
${S} .mock-tl::before{content:'';position:absolute;left:-22px;top:16px;bottom:16px;width:2px;border-radius:2px;background:linear-gradient(180deg,rgba(82,193,230,.55),var(--ok) 40%,rgba(111,143,161,.35))}
${S} .mock-row{position:relative}
${S} .mock-row::before{content:'';position:absolute;left:-27px;top:26px;width:12px;height:12px;border-radius:50%;background:var(--dim);border:2px solid #050b13}
${S} .mock-row.mock-r-live::before{width:16px;height:16px;left:-29px;top:24px;background:var(--ok);box-shadow:0 0 12px var(--ok)}
${S} .mock-row.mock-r-next::before{background:var(--a)}
${S} .mock-row > a.mock-card{display:block;color:inherit;text-decoration:none;cursor:pointer}
${S} .mock-row > a.mock-card:hover{border-color:var(--a)}
${S} .mock-date{position:absolute;left:-168px;top:16px;width:128px;text-align:right;display:flex;flex-direction:column;gap:1px}
${S} details.mock-tb > summary{list-style:none;cursor:pointer}
${S} details.mock-tb > summary::-webkit-details-marker{display:none}
${S} details.mock-tb > summary .mock-dot{justify-self:end}
${S} details.mock-tb > .mock-list{padding:0 18px 14px 18px;margin-left:96px}
${S} details.mock-tb[open]{border-color:rgba(82,193,230,.5)}
${S} details.mock-tb:hover{border-color:var(--a)}
${S} .mock-date b{font-family:var(--disp);font-size:13.5px;color:var(--ink);font-weight:600}
${S} .mock-date small{font-size:12.5px;color:var(--dim)}
${S} .mock-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
${S} .mock-r-live .mock-card{border-color:rgba(63,208,138,.5)}
${S} .mock-r-next .mock-card{border-color:rgba(82,193,230,.4)}
${S} .mock-r-old .mock-card{opacity:.85}
${S} .mock-ch{display:grid;grid-template-columns:96px 170px minmax(0,1fr) auto;align-items:center;gap:10px 18px;padding:14px 18px}
${S} .mock-pill{justify-self:start;padding:5px 12px;border-radius:6px;font-family:var(--disp);font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--dim);background:rgba(111,143,161,.16)}
${S} .mock-r-live .mock-pill{color:#04121b;background:var(--ok)}
${S} .mock-r-next .mock-pill{color:var(--a);background:rgba(82,193,230,.2)}
${S} .mock-ver{font-family:var(--disp);font-size:16px;font-weight:600;color:var(--ink)}
${S} .mock-r-live .mock-ver{font-size:21px}
${S} .mock-sent{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:13px;color:var(--mut)}
${S} .mock-sent b{color:var(--ink);font-weight:500;font-size:14px}
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
${S} .mock-dh h1{font-family:var(--disp);font-size:24px;color:#fff}
${S} .mock-dh .mock-btn{margin-left:auto}
${S} .mock-dsub{font-size:14.5px;color:var(--mut)}
${S} .mock-sec{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:16px 18px;display:flex;flex-direction:column;gap:12px}
${S} .mock-sec h3{display:flex;align-items:center;gap:10px;font-family:var(--disp);font-size:14.5px;color:#fff;letter-spacing:.04em}
${S} .mock-sec h3 i{font-style:normal;font-size:12px;color:var(--dim);font-family:"Segoe UI",system-ui,sans-serif;letter-spacing:0}
${S} .mock-tile{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:10px;background:rgba(5,14,22,.55)}
${S} .mock-img{height:168px;border-radius:8px;border:1px solid rgba(82,193,230,.35);background:linear-gradient(135deg,#16405a,#0a1c2a 55%,#1d4b63)}
${S} .mock-img.mock-img2{background:linear-gradient(160deg,#3a2a14,#141008 55%,#5a3d16)}
${S} .mock-tile h4{font-size:16px;color:#fff;font-weight:600;margin-bottom:6px}
${S} .mock-tile p{font-size:14px;color:var(--mut)}
${S} .mock-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
${S} .mock-stab{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
${S} .mock-stab strong{font-family:var(--disp);font-size:26px;color:var(--ok)}
${S} .mock-stab p{font-size:14px;color:var(--mut);max-width:52ch}
${S} .mock-vote{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:15px;color:var(--ink)}
${S} .mock-vote b{margin-right:6px;font-weight:600}
${S} .mock-collapsed{display:flex;align-items:center;gap:10px;font-size:14.5px;color:var(--mut)}
${S} .mock-collapsed b{font-family:var(--disp);font-size:15px;color:#fff;font-weight:600}
${S} .mock-collapsed span{margin-left:auto;color:var(--dim);font-size:13px}


/* eye-leading images: a big picture that fades into the box, text stays on the dark side */
${S} .mock-box{position:relative;overflow:hidden}
${S} .mock-box > *:not(.mock-hero){position:relative;z-index:1}
${S} .mock-hero{position:absolute;z-index:0;top:0;right:0;bottom:0;width:58%;background:radial-gradient(ellipse at 70% 30%,rgba(255,196,120,.35),transparent 55%),linear-gradient(135deg,#1d4b63,#0c2232 45%,#3a2a14);-webkit-mask-image:linear-gradient(to left,#000 35%,transparent);mask-image:linear-gradient(to left,#000 35%,transparent);opacity:.9}
${S} .mock-hero.mock-hero-next{background:radial-gradient(ellipse at 65% 40%,rgba(120,220,255,.35),transparent 55%),linear-gradient(160deg,#123a52,#06121c 50%,#1f4f66)}
${S} .mock-hero small{position:absolute;right:12px;bottom:10px;font-size:11px;color:rgba(255,255,255,.65)}
${S} .mock-thumbs{display:flex;gap:6px}
${S} .mock-thumbs i{display:block;width:84px;height:50px;border-radius:6px;border:1px solid rgba(82,193,230,.35);background:linear-gradient(135deg,#16405a,#0a1c2a 55%,#1d4b63)}
${S} .mock-thumbs i:nth-child(2){background:linear-gradient(160deg,#3a2a14,#141008 55%,#5a3d16)}
${S} .mock-thumbs i:nth-child(3){background:linear-gradient(120deg,#203d2a,#0a1a10 55%,#2f5a3a)}
${S} .mock-thumbs i.mock-more{display:flex;align-items:center;justify-content:center;width:44px;border-style:dashed;background:none;color:var(--mut);font-style:normal}
/* timeline: one picture on the right edge of every card */
${S} .mock-ch{position:relative}
${S} .mock-ch > *:not(.mock-rowimg){position:relative;z-index:1}
${S} .mock-rowimg{position:absolute;z-index:0;top:0;right:0;bottom:0;width:300px;border-radius:0 12px 0 0;background:linear-gradient(135deg,#16405a,#0a1c2a 50%,#3a2a14);-webkit-mask-image:linear-gradient(to left,#000 30%,transparent);mask-image:linear-gradient(to left,#000 30%,transparent);opacity:.75}
${S} .mock-rowimg.mock-img-next{background:linear-gradient(160deg,#123a52,#06121c 50%,#1f4f66)}
/* generated stand-in: patch colour, grid lines and the version number */
${S} .mock-synth{background:repeating-linear-gradient(115deg,rgba(82,193,230,.10) 0 2px,transparent 2px 22px),radial-gradient(circle at 80% 50%,rgba(82,193,230,.25),transparent 60%),#0a1824}
${S} .mock-synth::after{content:attr(data-v);position:absolute;right:18px;top:50%;transform:translateY(-50%);font-family:var(--disp);font-size:40px;font-weight:700;color:rgba(143,227,255,.22);letter-spacing:.04em}
/* dossier gallery */
${S} .mock-gal{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
${S} .mock-gal i{display:block;height:120px;border-radius:8px;border:1px solid rgba(82,193,230,.3);background:linear-gradient(135deg,#16405a,#0a1c2a 55%,#1d4b63)}
${S} .mock-gal i:nth-child(2){background:linear-gradient(160deg,#3a2a14,#141008 55%,#5a3d16)}
${S} .mock-gal i:nth-child(3){background:linear-gradient(120deg,#203d2a,#0a1a10 55%,#2f5a3a)}
${S} .mock-gal i:nth-child(4){background:linear-gradient(200deg,#3b1d2a,#12080d 55%,#5a2a3a)}

@container device (max-width: 520px){
${S} .mock-hero,${S} .mock-rowimg{width:100%;opacity:.35}
${S} .mock-gal{grid-template-columns:repeat(2,minmax(0,1fr))}
${S} .mock-top{padding:10px 14px}
${S} .mock-top .mock-search{display:none}
${S} .mock-planet{display:none}
${S} .mock-page{padding:16px 12px 0}
${S} .mock-head,${S} .mock-trio,${S} .mock-cols,${S} .mock-dos,${S} .mock-tile{grid-template-columns:minmax(0,1fr)}
${S} .mock-toc{display:none}
${S} .mock-box-h .mock-when{margin-left:0;text-align:left}
${S} .mock-page{width:auto;margin:0;padding:16px 12px 0 34px}
${S} .mock-tl::before{left:-22px}
${S} .mock-pop{left:0;right:0}
${S} .mock-build summary{grid-template-columns:16px 90px minmax(0,1fr)}
${S} .mock-build summary time,${S} .mock-build summary .mock-tag{display:none}
${S} .mock-build .mock-list{padding:0 14px 12px 30px}
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

const sw = (mode) => `<div class="mock-switchrow"><div class="mock-switch" data-m="switch"><a class="${mode === 'live' ? 'mock-on' : ''}" data-screen-link="r5-d1-s1">Live<small>was du spielst</small></a><a class="${mode === 'ptu' ? 'mock-on mock-ptu' : ''}" data-screen-link="r5-d1-s2">PTU<small>Test-Server</small></a></div><p>${mode === 'live' ? 'PTU-Builds stehen im eigenen Reiter, sie stören die Live-Ansicht nicht.' : 'Alles, was gerade getestet wird. Kann sich bis Live noch ändern.'}</p></div>`;

// ── shared boxes ─────────────────────────────────────────────────────────────
const trio = (open) => `<div class="mock-trio" data-m="trio"><a class="mock-c-ok${open ? ' mock-open' : ''}" data-screen-link="${open ? 'r5-d1-s1' : 'r5-d1-s5'}"><b>14</b>bestätigt</a><a class="mock-c-maybe"><b>9</b>möglich</a><a class="mock-c-late"><b>3</b>verschoben</a></div>`;

const pop = `<div class="mock-pop" data-m="pop"><div class="mock-pop-h"><b>14 bestätigt für 5.0</b>laut RSI-Roadmap<a data-screen-link="r5-d1-s1" aria-label="Schließen">×</a></div>
  <ul><li>Engineering Tier 0<small>Gameplay</small></li><li>Server-Meshing: dynamische Server<small>Technik</small></li><li>Neues Schiff: Drake Golem OX<small>Schiffe</small></li><li>Mission Boards überarbeitet<small>Missionen</small></li><li>Hangar-Aufzüge mit Warteschlange<small>Komfort</small></li><li>+ 9 weitere<small>alle im PTU-Reiter</small></li></ul></div>`;

const nextBox = (open) => `<section class="mock-box mock-next" data-m="next"><div class="mock-hero mock-hero-next"></div>
  <div class="mock-box-h"><span class="mock-kicker">Als Nächstes auf Live</span></div>
  <div class="mock-box-h"><h2>Alpha 5.0</h2><span class="mock-tag mock-t-ptu">im PTU · Welle 3</span><span class="mock-when"><b>Kein offizielles Datum</b>Schätzung: ~ Feb. 2027</span></div>
  ${trio(open)}
  <div class="mock-thumbs" data-m="thumbs"><i></i><i></i><i></i><i class="mock-more">+11</i></div>
  <ul class="mock-items"><li><i class="mock-i-ok">bestätigt</i>Engineering Tier 0</li><li><i class="mock-i-ok">bestätigt</i>Server-Meshing: dynamische Server</li><li><i class="mock-i-maybe">möglich</i>Genesis-Planeten-Tech auf Hurston</li><li><i class="mock-i-late">verschoben</i>Quantum-Interdiction 2.0, neu: nach 5.0</li></ul>
  <div class="mock-acts"><a class="mock-btn" data-screen-link="r5-d1-s2" data-m="all50">Alles zu 5.0 im PTU →</a><span>Quelle: RSI-Roadmap, Stand heute</span></div>
  ${open ? pop : ''}
</section>`;

const NOW_LIST = `<ul class="mock-list">${li(NEWS)}${li(FIX.slice(0, 2), 'mock-fix')}</ul>`;

const nowUnread = `<section class="mock-box mock-now mock-unread" data-m="now"><div class="mock-hero" data-m="hero"><small>Bild aus den Patch Notes</small></div>
  <div class="mock-box-h"><span class="mock-kicker">Gerade auf Live gekommen</span><span class="mock-new">Neu für dich</span></div>
  <div class="mock-box-h"><h2>Alpha 4.10.3</h2><span class="mock-tag mock-t-live">Live</span><span class="mock-when"><b>seit 12. Nov. 2026</b>vor 7 Tagen</span></div>
  ${NOW_LIST}
  <div class="mock-acts"><a class="mock-btn mock-primary" data-screen-link="r5-d1-s4">Ganz lesen →</a><a class="mock-btn" data-screen-link="r5-d1-s3" data-m="read">✓ Gelesen</a><span>Lesezeit ~2 Min.</span></div>
</section>`;

const nowRead = `<section class="mock-box mock-now" data-m="now-read"><div class="mock-hero"><small>Bild aus den Patch Notes</small></div>
  <div class="mock-box-h"><span class="mock-kicker">Gerade auf Live</span><span class="mock-readnote" data-m="readnote">✓ gelesen am 19. Nov.</span></div>
  <div class="mock-box-h"><h2>Alpha 4.10.3</h2><span class="mock-tag mock-t-live">Live</span><span class="mock-when"><b>seit 12. Nov. 2026</b>vor 7 Tagen</span></div>
  ${NOW_LIST}
  <div class="mock-acts"><a class="mock-btn" data-screen-link="r5-d1-s4">Nochmal lesen →</a><a class="mock-btn mock-quiet" data-screen-link="r5-d1-s1">als ungelesen markieren</a></div>
</section>`;

function sv(ver, title, tag, when, state, top1 = false) {
  const dot = state === 'unread' ? '<span class="mock-dot mock-unread"></span>' : '<span class="mock-dot mock-read">✓</span>';
  return `<a class="mock-sv${top1 ? ' mock-top1' : ''}" data-screen-link="r5-d1-s4">${dot}<b>${ver}</b><span>${title}</span>${tag}<time>${when}</time></a>`;
}
const T_LIVE = '<span class="mock-tag mock-t-live">Live</span>';

const timeline = (read) => `<div class="mock-tl" data-m="tl">
  <div class="mock-row mock-r-next"><div class="mock-date"><b>offen</b><small>kein Datum</small></div><a class="mock-card" data-screen-link="r5-d1-s2" data-m="row50">
    <div class="mock-ch"><span class="mock-rowimg mock-img-next"></span><span class="mock-pill">Als Nächstes</span><span class="mock-ver">Alpha 5.0</span><span class="mock-sent"><b>Im PTU seit 4. Nov., Welle 3</b><span>Klick: alle Test-Builds im PTU-Reiter</span></span><span></span></div>
  </a></div>
  <div class="mock-row mock-r-live" data-m="live-row"><div class="mock-date" data-m="date"><b>26. Aug. 2026</b><small>seit 85 Tagen</small></div><div class="mock-card">
    <div class="mock-ch"><span class="mock-rowimg" data-m="rowimg"></span><span class="mock-pill">Live</span><span class="mock-ver">Alpha 4.10</span><span class="mock-sent"><b>Neuester Stand: 4.10.3 vom 12. Nov.</b><span>3 Updates seit dem Start · nächster Live-Patch: 5.0</span></span><span class="mock-chip">81 % stabil</span></div>
    <div class="mock-subs">
      ${sv('4.10.3', 'Alpha 4.10.3 LIVE Patch Notes', T_LIVE, '12. Nov.', read ? 'read' : 'unread', true)}
      <div class="mock-bundle" data-m="bundle"><b>3 frühere Updates</b> 4.10.2 · 4.10.1 · 4.10.0<span>alle gelesen ✓</span></div>
    </div>
  </div></div>
  <div class="mock-row mock-r-old"><div class="mock-date"><b>12. Juni 2026</b><small>75 Tage live</small></div><div class="mock-card">
    <div class="mock-ch"><span class="mock-rowimg mock-synth" data-v="4.9" data-m="synth"></span><span class="mock-pill">Abgelöst</span><span class="mock-ver">Alpha 4.9</span><span class="mock-sent"><b>Live bis 26. Aug.</b><span>3 Hotfixes</span></span><span class="mock-chip">84 % stabil</span></div>
  </div></div>
  <div class="mock-row"><div class="mock-fold">Ältere Patches · 4.8 · 4.7 · 4.6</div></div>
</div>`;

// ── screens ──────────────────────────────────────────────────────────────────
const s1 = `<div class="mock-r5">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowUnread}${nextBox(false)}</div>
  ${timeline(false)}
</div></div>
${layer(
  anno('r5-d1-s1-a1', 1, 'bottom', '[data-m="hero"] small', 'Oben läuft je ein großes Bild des Patches zur Seite hin aus, der Text bleibt auf der dunklen Seite. Führt das den Blick so, wie du es meintest?', 'Großes Bild oben'),
  anno('r5-d1-s1-a2', 2, 'left', '[data-m="rowimg"]', 'Jede Karte der Zeitleiste bekommt rechts ein Bild, das in die Karte ausläuft. So ist der leere Platz rechts gefüllt. Passt das?', 'Bild in jeder Karte'),
  anno('r5-d1-s1-a3', 3, 'left', '[data-m="synth"]', 'Hat ein Patch kein Bild, erzeugen wir eins: Patch-Farbe, Linienmuster und die Versionsnummer groß und blass. Gut so, oder lieber KI-erzeugte Bilder (kostet pro Bild und braucht Prüfung)?', 'Ersatzbild ohne KI'),
)}`;

const s5 = `<div class="mock-r5">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowUnread}${nextBox(true)}</div>
  ${timeline(false)}
</div></div>
${layer(
  anno('r5-d1-s5-a1', 1, 'left', '[data-m="pop"] .mock-pop-h b', 'Die aufgeklappte Liste zeigt die ersten Einträge mit Bereich, der Rest steht im PTU-Reiter. Reicht das, oder soll hier jeder Eintrag mit kurzer Beschreibung stehen?'),
)}`;

function build(open, ver, title, when, items, unread = false) {
  const dot = unread ? '<span class="mock-dot mock-unread"></span>' : '<span class="mock-dot mock-read">✓</span>';
  return `<details class="mock-build"${open ? ' open' : ''}><summary>${dot}<b>${ver}</b><span>${title}</span><span class="mock-tag mock-t-ptu">PTU</span><time>${when}</time></summary><ul class="mock-list">${items}</ul></details>`;
}

function tbuild(open, date, ago, wave, ver, title, items, unread = false) {
  const dot = unread ? '<span class="mock-dot mock-unread"></span>' : '<span class="mock-dot mock-read">✓</span>';
  const cls = wave === 'Evocati' ? 'mock-row mock-r-old' : 'mock-row mock-r-next';
  return `<div class="${cls}"><div class="mock-date"><b>${date}</b><small>${ago}</small></div><details class="mock-card mock-tb"${open ? ' open' : ''}><summary class="mock-ch"><span class="mock-pill">${wave}</span><span class="mock-ver">${ver}</span><span class="mock-sent"><b>${title}</b><span>${open ? 'aufgeklappt' : 'klicken zum Aufklappen'}</span></span>${dot}</summary><ul class="mock-list">${items}</ul></details></div>`;
}

const s2 =`<div class="mock-r5">${top}<div class="mock-page">
  ${sw('ptu')}
  <section class="mock-box mock-next" data-m="ptu">
    <div class="mock-box-h"><span class="mock-kicker">Gerade im Test</span><span class="mock-new">1 neu</span></div>
    <div class="mock-box-h"><h2>Alpha 5.0 PTU</h2><span class="mock-tag mock-t-ptu">Welle 3</span><span class="mock-when"><b>neuester Build 13228337</b>gestern</span></div>
    <ul class="mock-list"><li>Welle 3: alle Backer mit PTU-Zugang</li><li class="mock-fix">Stabilitätsfixes für Server-Meshing</li><li class="mock-known">Bekannt: Mission Boards laden teils leer</li></ul>
    <div class="mock-acts"><a class="mock-btn mock-primary">Build-Notes lesen →</a><a class="mock-btn">✓ Gelesen</a><span>Original auf Spectrum ↗</span></div>
  </section>
  <div class="mock-tl" data-m="builds">
    ${tbuild(true, '18. Nov.', 'gestern', 'Welle 3', 'Build 13228337', 'Alpha 5.0 PTU Patch Notes', `<li class="mock-fix">Server-Meshing: weniger Abbrüche beim Serverwechsel</li><li class="mock-fix">Drake Golem OX: Bohrkopf nimmt wieder Schaden</li><li class="mock-known">Bekannt: Mission Boards laden teils leer</li>`, true)}
    ${tbuild(false, '16. Nov.', 'vor 3 Tagen', 'Welle 3', 'Build 13214006', 'Alpha 5.0 PTU Patch Notes', '<li class="mock-fix">Hangar-Aufzüge: Warteschlange zeigt die Position</li><li>Engineering: Sicherungen in allen Startschiffen</li>')}
    ${tbuild(false, '15. Nov.', 'vor 4 Tagen', 'Welle 3', 'Build 13198112', 'Welle 3 geöffnet: alle Backer', '<li>Welle 3 geöffnet</li><li class="mock-fix">Performance in Lorville</li>')}
    ${tbuild(false, '12. Nov.', 'vor 7 Tagen', 'Welle 1', 'Build 13171540', 'Alpha 5.0 PTU Patch Notes', '<li>Engineering Tier 0 zum Testen frei</li>')}
    ${tbuild(false, '4. Nov.', 'vor 15 Tagen', 'Welle 1', 'Build 13145020', 'Erster 5.0-Build im PTU', '<li>Erster 5.0-Build im PTU</li>')}
    ${tbuild(false, 'Okt. 2026', 'Tech-Preview', 'Evocati', 'Build 13119881', 'Genesis / Mission Boards (NDA)', '<li>Nur Evocati, Inhalte unter NDA</li>')}
  </div>
  <div class="mock-hint">Was davon sicher auf Live kommt, steht im Reiter <a data-screen-link="r5-d1-s1">Live</a> unter „Als Nächstes“.</div>
</div></div>
${layer(
  anno('r5-d1-s2-a1', 1, 'right', '[data-m="builds"] details[open] .mock-ver', 'Der PTU hat jetzt dieselbe Zeitleiste wie Live: jeder Build eine Zeile mit Datum links, Welle als Kästchen, der neueste aufgeklappt. Einheitlich genug?', 'Zeitleiste auch im PTU'),
)}`;

const s3 = `<div class="mock-r5">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowRead}${nextBox(false)}</div>
  ${timeline(true)}
</div></div>
${layer(
  anno('r5-d1-s3-a1', 1, 'bottom', '[data-m="now-read"] .mock-readnote', 'Auch gelesen bleibt das Bild stehen. Soll es nach dem Lesen blasser werden, oder gleich bleiben?'),
)}`;

const s4 = `<div class="mock-r5">${top}<div class="mock-page">
  <div class="mock-dos">
    <nav class="mock-toc" data-m="toc"><a class="mock-on"><i>1</i>Was steckt drin</a><a><i>2</i>Stabilität</a><a><i>3</i>Community</a><a><i>4</i>Dein Urteil</a><a><i>5</i>Erste Schritte</a><a><i>6</i>Wann kommt der nächste</a></nav>
    <div class="mock-main">
      <div class="mock-dh"><h1>Alpha 4.10.3</h1><span class="mock-tag mock-t-live">Live</span><a class="mock-btn" data-m="rsi">Original bei RSI ↗</a></div>
      <p class="mock-dsub">Live seit 12. Nov. 2026 · drittes Update von Alpha 4.10 · <a class="mock-btn mock-quiet" data-screen-link="r5-d1-s1">← zurück zu den Patches</a></p>
      <section class="mock-sec"><h3>1 · Was steckt drin <i>neu und behoben</i></h3>
        <div class="mock-tile" data-m="tile"><div class="mock-img"></div><div><h4>LBCO Skarnov Rifle</h4><p>Neues Sturmgewehr von Lightning Bolt Co., in den Waffenläden von Area18 und Orison erhältlich.</p></div></div>
        <div class="mock-tile"><div class="mock-img mock-img2"></div><div><h4>Vanduul Incursion</h4><p>Neue Missionsreihe: Vanduul-Angriffe auf Außenposten, als Gruppe spielbar, mit eigenen Belohnungen.</p></div></div>
        <p class="mock-kicker">Bilder aus diesem Patch · 4</p><div class="mock-gal" data-m="gal"><i></i><i></i><i></i><i></i></div>
        <div class="mock-cols"><div><p class="mock-kicker">Behoben · 129</p><ul class="mock-list">${li(FIX, 'mock-fix')}</ul></div><div><p class="mock-kicker">Bekannte Probleme · 4</p><ul class="mock-list"><li class="mock-known">Mission Boards laden teils leer</li><li class="mock-known">Vanduul Incursion: Belohnung kommt manchmal doppelt</li><li class="mock-known">mobiGlas-Karte ruckelt in Pyro</li><li class="mock-known">+ 1 weiteres im Original</li></ul></div></div>
      </section>
      <section class="mock-sec" data-m="stab"><h3>2 · Stabilität</h3>
        <div class="mock-stab"><strong>81 %</strong><p>Spieler berichten auf Spectrum überwiegend von stabilen Sitzungen, Abstürze vor allem bei Vanduul Incursion in großen Gruppen.</p></div>
      </section>
      <section class="mock-sec"><h3>3 · Community <i>aus Spectrum</i></h3><div class="mock-collapsed"><b>24 Beiträge</b>„Skarnov fühlt sich gut an“, „IAE läuft deutlich runder“ …<span>aufklappen</span></div></section>
      <section class="mock-sec" data-m="vote"><h3>4 · Dein Urteil</h3><div class="mock-vote"><b>Wie läuft 4.10.3 bei dir?</b><a class="mock-btn">Stabil</a><a class="mock-btn">Geht so</a><a class="mock-btn">Instabil</a><a class="mock-btn mock-quiet">Kann ich nicht sagen</a></div></section>
      <section class="mock-sec" data-m="first"><h3>5 · Erste Schritte in diesem Patch</h3><div class="mock-collapsed"><b>Nichts zu tun</b>kein Wipe, Langzeit-Speicher (LTP) bleibt erhalten. Bei einem Wipe stünde hier z. B. „Waffen und Rüstung neu kaufen“.<span>aufklappen</span></div></section>
      <section class="mock-sec"><h3>6 · Wann kommt der nächste</h3><div class="mock-collapsed"><b>Alpha 5.0</b>im PTU, kein Datum, Schätzung ~ Feb. 2027 · darin: so bereitest du dich auf 5.0 vor<span>aufklappen</span></div></section>
    </div>
  </div>
</div></div>
${layer(
  anno('r5-d1-s4-a1', 1, 'top', '[data-m="gal"]', 'Alle Bilder aus den Patch Notes stehen als Galerie unter den Inhalten, ein Klick öffnet sie groß. Reicht das, oder sollen sie in die einzelnen Punkte?', 'Bilder des Patches zurück'),
)}`;

const icon = '&lt;svg viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.8&quot;&gt;&lt;rect x=&quot;3&quot; y=&quot;4&quot; width=&quot;8&quot; height=&quot;7&quot; rx=&quot;2&quot;/&gt;&lt;rect x=&quot;13&quot; y=&quot;4&quot; width=&quot;8&quot; height=&quot;7&quot; rx=&quot;2&quot;/&gt;&lt;path d=&quot;M4 15h16M4 19h11&quot;/&gt;&lt;/svg&gt;';

const html = `<section data-iteration="5" data-iteration-template="design" data-tab-label="Runde 5" data-viewports="desktop phone">
<style>${css}</style>
<header class="iteration-intro"><h2>{{iteration.tab}} 5 · Bilder führen den Blick</h2><p>Ein Vorschlag für Bilder: oben je ein großes Bild, das zur Seite hin ausläuft, in der Zeitleiste ein Bild am rechten Rand jeder Karte, und wo ein Patch kein Bild hat, ein erzeugtes Ersatzbild. Im Dossier sind die Bilder des Patches wieder dabei.</p></header>
<section data-design="r5-d1" data-nav-label="Live zuerst" data-design-active="true" data-screen-fit="full" data-design-icon="${icon}" data-design-improved="Bilder auf Board und im Dossier">
<section id="r5-d1-s1" data-nav-label="Patches · Live" data-screen data-screen-active="true">${s1}</section>
<section id="r5-d1-s2" data-nav-label="Patches · PTU" data-screen hidden>${s2}</section>
<section id="r5-d1-s5" data-nav-label="Live · bestätigt offen" data-screen hidden>${s5}</section>
<section id="r5-d1-s3" data-nav-label="Live · gelesen" data-screen hidden>${s3}</section>
<section id="r5-d1-s4" data-nav-label="Dossier 4.10.3" data-screen hidden>${s4}</section>
</section>
</section>
`;

fs.writeFileSync(path.join(__dirname, 'rounds', '05.html'), html.replace(/\r\n/g, '\n'));
console.log('rounds/05.html', html.length, 'bytes');
