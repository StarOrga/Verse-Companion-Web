// Builds gen-r5.cjs from gen-r4.cjs: images that lead the eye on the board, a generated
// stand-in image where a patch has none, and the patch's own pictures back in the dossier.
const fs = require('fs');
const dir = process.argv[2];
let s = fs.readFileSync(dir + '/gen-r4.cjs', 'utf8');

const swap = (a, b) => { if (!s.includes(a)) throw new Error('MISSING: ' + a.slice(0, 80)); s = s.split(a).join(b); };

// ids, class prefix, round number
s = s.split('mock-r4').join('mock-r5').split('r4-d1').join('r5-d1');
swap("'rounds', '04.html'", "'rounds', '05.html'");
s = s.split('rounds/04.html').join('rounds/05.html');
swap('data-iteration="4"', 'data-iteration="5"');
swap('data-tab-label="Runde 4"', 'data-tab-label="Runde 5"');
swap('{{iteration.tab}} 4 · Einheitlich und ruhiger', '{{iteration.tab}} 5 · Bilder führen den Blick');
s = s.replace(/<header class="iteration-intro">([\s\S]*?)<p>[\s\S]*?<\/p><\/header>/, '<header class="iteration-intro">$1<p>Ein Vorschlag für Bilder: oben je ein großes Bild, das zur Seite hin ausläuft, in der Zeitleiste ein Bild am rechten Rand jeder Karte, und wo ein Patch kein Bild hat, ein erzeugtes Ersatzbild. Im Dossier sind die Bilder des Patches wieder dabei.</p></header>');
swap('data-design-improved="PTU-Zeitleiste, kleinere Schrift"', 'data-design-improved="Bilder auf Board und im Dossier"');

// CSS
const css = `
/* eye-leading images: a big picture that fades into the box, text stays on the dark side */
\${S} .mock-box{position:relative;overflow:hidden}
\${S} .mock-box > *:not(.mock-hero){position:relative;z-index:1}
\${S} .mock-hero{position:absolute;z-index:0;top:0;right:0;bottom:0;width:58%;background:radial-gradient(ellipse at 70% 30%,rgba(255,196,120,.35),transparent 55%),linear-gradient(135deg,#1d4b63,#0c2232 45%,#3a2a14);-webkit-mask-image:linear-gradient(to left,#000 35%,transparent);mask-image:linear-gradient(to left,#000 35%,transparent);opacity:.9}
\${S} .mock-hero.mock-hero-next{background:radial-gradient(ellipse at 65% 40%,rgba(120,220,255,.35),transparent 55%),linear-gradient(160deg,#123a52,#06121c 50%,#1f4f66)}
\${S} .mock-hero small{position:absolute;right:12px;bottom:10px;font-size:11px;color:rgba(255,255,255,.65)}
\${S} .mock-thumbs{display:flex;gap:6px}
\${S} .mock-thumbs i{display:block;width:84px;height:50px;border-radius:6px;border:1px solid rgba(82,193,230,.35);background:linear-gradient(135deg,#16405a,#0a1c2a 55%,#1d4b63)}
\${S} .mock-thumbs i:nth-child(2){background:linear-gradient(160deg,#3a2a14,#141008 55%,#5a3d16)}
\${S} .mock-thumbs i:nth-child(3){background:linear-gradient(120deg,#203d2a,#0a1a10 55%,#2f5a3a)}
\${S} .mock-thumbs i.mock-more{display:flex;align-items:center;justify-content:center;width:44px;border-style:dashed;background:none;color:var(--mut);font-style:normal}
/* timeline: one picture on the right edge of every card */
\${S} .mock-ch{position:relative}
\${S} .mock-ch > *:not(.mock-rowimg){position:relative;z-index:1}
\${S} .mock-rowimg{position:absolute;z-index:0;top:0;right:0;bottom:0;width:300px;border-radius:0 12px 0 0;background:linear-gradient(135deg,#16405a,#0a1c2a 50%,#3a2a14);-webkit-mask-image:linear-gradient(to left,#000 30%,transparent);mask-image:linear-gradient(to left,#000 30%,transparent);opacity:.75}
\${S} .mock-rowimg.mock-img-next{background:linear-gradient(160deg,#123a52,#06121c 50%,#1f4f66)}
/* generated stand-in: patch colour, grid lines and the version number */
\${S} .mock-synth{background:repeating-linear-gradient(115deg,rgba(82,193,230,.10) 0 2px,transparent 2px 22px),radial-gradient(circle at 80% 50%,rgba(82,193,230,.25),transparent 60%),#0a1824}
\${S} .mock-synth::after{content:attr(data-v);position:absolute;right:18px;top:50%;transform:translateY(-50%);font-family:var(--disp);font-size:40px;font-weight:700;color:rgba(143,227,255,.22);letter-spacing:.04em}
/* dossier gallery */
\${S} .mock-gal{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
\${S} .mock-gal i{display:block;height:120px;border-radius:8px;border:1px solid rgba(82,193,230,.3);background:linear-gradient(135deg,#16405a,#0a1c2a 55%,#1d4b63)}
\${S} .mock-gal i:nth-child(2){background:linear-gradient(160deg,#3a2a14,#141008 55%,#5a3d16)}
\${S} .mock-gal i:nth-child(3){background:linear-gradient(120deg,#203d2a,#0a1a10 55%,#2f5a3a)}
\${S} .mock-gal i:nth-child(4){background:linear-gradient(200deg,#3b1d2a,#12080d 55%,#5a2a3a)}
`;
swap('@container device (max-width: 520px){', css + '\n@container device (max-width: 520px){\n${S} .mock-hero,${S} .mock-rowimg{width:100%;opacity:.35}\n${S} .mock-gal{grid-template-columns:repeat(2,minmax(0,1fr))}');

// header boxes
swap('<section class="mock-box mock-now mock-unread" data-m="now">', '<section class="mock-box mock-now mock-unread" data-m="now"><div class="mock-hero" data-m="hero"><small>Bild aus den Patch Notes</small></div>');
swap('<section class="mock-box mock-now" data-m="now-read">', '<section class="mock-box mock-now" data-m="now-read"><div class="mock-hero"><small>Bild aus den Patch Notes</small></div>');
swap('${trio(open)}', '${trio(open)}\n  <div class="mock-thumbs" data-m="thumbs"><i></i><i></i><i></i><i class="mock-more">+11</i></div>');
swap('<section class="mock-box mock-next" data-m="next">', '<section class="mock-box mock-next" data-m="next"><div class="mock-hero mock-hero-next"></div>');

// timeline rows
swap('<div class="mock-ch"><span class="mock-pill">Als Nächstes</span>', '<div class="mock-ch"><span class="mock-rowimg mock-img-next"></span><span class="mock-pill">Als Nächstes</span>');
swap('<div class="mock-ch"><span class="mock-pill">Live</span>', '<div class="mock-ch"><span class="mock-rowimg" data-m="rowimg"></span><span class="mock-pill">Live</span>');
swap('<div class="mock-ch"><span class="mock-pill">Abgelöst</span>', '<div class="mock-ch"><span class="mock-rowimg mock-synth" data-v="4.9" data-m="synth"></span><span class="mock-pill">Abgelöst</span>');

// dossier: Vanduul Incursion with its picture again, plus the patch's picture gallery
s = s.replace(/<div class="mock-textonly" data-m="textonly">[\s\S]*?<\/div>/, '<div class="mock-tile"><div class="mock-img mock-img2"></div><div><h4>Vanduul Incursion</h4><p>Neue Missionsreihe: Vanduul-Angriffe auf Außenposten, als Gruppe spielbar, mit eigenen Belohnungen.</p></div></div>\n        <p class="mock-kicker">Bilder aus diesem Patch · 4</p><div class="mock-gal" data-m="gal"><i></i><i></i><i></i><i></i></div>');

// pins for the changed screens
const pins = {
  s1: `anno('r5-d1-s1-a1', 1, 'bottom', '[data-m="hero"] small', 'Oben läuft je ein großes Bild des Patches zur Seite hin aus, der Text bleibt auf der dunklen Seite. Führt das den Blick so, wie du es meintest?', 'Großes Bild oben'),
  anno('r5-d1-s1-a2', 2, 'left', '[data-m="rowimg"]', 'Jede Karte der Zeitleiste bekommt rechts ein Bild, das in die Karte ausläuft. So ist der leere Platz rechts gefüllt. Passt das?', 'Bild in jeder Karte'),
  anno('r5-d1-s1-a3', 3, 'left', '[data-m="synth"]', 'Hat ein Patch kein Bild, erzeugen wir eins: Patch-Farbe, Linienmuster und die Versionsnummer groß und blass. Gut so, oder lieber KI-erzeugte Bilder (kostet pro Bild und braucht Prüfung)?', 'Ersatzbild ohne KI')`,
  s3: `anno('r5-d1-s3-a1', 1, 'bottom', '[data-m="now-read"] .mock-readnote', 'Auch gelesen bleibt das Bild stehen. Soll es nach dem Lesen blasser werden, oder gleich bleiben?')`,
  s4: `anno('r5-d1-s4-a1', 1, 'top', '[data-m="gal"]', 'Alle Bilder aus den Patch Notes stehen als Galerie unter den Inhalten, ein Klick öffnet sie groß. Reicht das, oder sollen sie in die einzelnen Punkte?', 'Bilder des Patches zurück')`,
};
for (const [k, body] of Object.entries(pins)) {
  const re = new RegExp('(const ' + k + ' = [\\s\\S]*?\\$\\{layer\\()[\\s\\S]*?(\\)\\}`;)');
  if (!re.test(s)) throw new Error('no layer for ' + k);
  s = s.replace(re, (_, a, b) => a + '\n  ' + body + ',\n' + b);
}

fs.writeFileSync(dir + '/gen-r5.cjs', s);
console.log('gen-r5.cjs written');
