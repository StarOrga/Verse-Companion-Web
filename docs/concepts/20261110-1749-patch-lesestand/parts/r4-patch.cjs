// Applies the round 4 CSS changes (text sizes closer to the app, bigger planet, PTU timeline rows).
const fs = require('fs');
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
const rep = [
  ['font:15px/1.5 "Segoe UI"', 'font:14px/1.5 "Segoe UI"'],
  ['.mock-planet{position:absolute;left:-260px;top:110px;width:440px;height:440px;', '.mock-planet{position:absolute;left:-400px;top:70px;width:580px;height:580px;'],
  ['.mock-switch a{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:999px;color:var(--mut);text-decoration:none;font-size:15px;', '.mock-switch a{display:inline-flex;align-items:center;gap:8px;padding:7px 18px;border-radius:999px;color:var(--mut);text-decoration:none;font-size:14px;'],
  ['.mock-box-h h2{font-family:var(--disp);font-size:28px;', '.mock-box-h h2{font-family:var(--disp);font-size:22px;'],
  ['.mock-box-h .mock-when b{display:block;color:var(--ink);font-size:16px}', '.mock-box-h .mock-when b{display:block;color:var(--ink);font-size:14.5px}'],
  ['.mock-list{display:flex;flex-direction:column;gap:6px;font-size:15px;', '.mock-list{display:flex;flex-direction:column;gap:5px;font-size:14px;'],
  ['.mock-items{display:flex;flex-direction:column;gap:6px;font-size:14.5px}', '.mock-items{display:flex;flex-direction:column;gap:5px;font-size:14px}'],
  ['.mock-ver{font-family:var(--disp);font-size:20px;', '.mock-ver{font-family:var(--disp);font-size:16px;'],
  ['.mock-r-live .mock-ver{font-size:26px}', '.mock-r-live .mock-ver{font-size:21px}'],
  ['.mock-sent b{color:var(--ink);font-weight:500;font-size:15px}', '.mock-sent b{color:var(--ink);font-weight:500;font-size:14px}'],
  ['.mock-sent{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:14px;', '.mock-sent{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:13px;'],
  ['.mock-dh h1{font-family:var(--disp);font-size:30px;', '.mock-dh h1{font-family:var(--disp);font-size:24px;'],
  ['.mock-tile h4{font-size:18px;', '.mock-tile h4{font-size:16px;'],
  ['.mock-textonly h4{font-size:18px;', '.mock-textonly h4{font-size:16px;'],
  ['.mock-tile p{font-size:14.5px;', '.mock-tile p{font-size:14px;'],
  ['.mock-textonly p{font-size:14.5px;', '.mock-textonly p{font-size:14px;'],
  ['.mock-stab strong{font-family:var(--disp);font-size:34px;', '.mock-stab strong{font-family:var(--disp);font-size:26px;'],
  ['.mock-sec h3{display:flex;align-items:center;gap:10px;font-family:var(--disp);font-size:16px;', '.mock-sec h3{display:flex;align-items:center;gap:10px;font-family:var(--disp);font-size:14.5px;'],
  ['.mock-date b{font-family:var(--disp);font-size:15px;', '.mock-date b{font-family:var(--disp);font-size:13.5px;'],
];
for (const [a, b] of rep) {
  if (!s.includes(a)) { console.error('MISSING: ' + a.slice(0, 70)); process.exitCode = 1; continue; }
  s = s.split(a).join(b);
}
// PTU timeline rows: a <details> card whose summary is the card head
const extra = "${S} details.mock-tb > summary{list-style:none;cursor:pointer}\n${S} details.mock-tb > summary::-webkit-details-marker{display:none}\n${S} details.mock-tb > summary .mock-dot{justify-self:end}\n${S} details.mock-tb > .mock-list{padding:0 18px 14px 18px;margin-left:96px}\n${S} details.mock-tb[open]{border-color:rgba(82,193,230,.5)}\n${S} details.mock-tb:hover{border-color:var(--a)}\n";
s = s.replace('${S} .mock-date b{', extra + '${S} .mock-date b{');
fs.writeFileSync(f, s);
console.log('patched');
