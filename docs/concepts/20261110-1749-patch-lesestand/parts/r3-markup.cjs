// ── shared boxes ─────────────────────────────────────────────────────────────
const trio = (open) => `<div class="mock-trio" data-m="trio"><a class="mock-c-ok${open ? ' mock-open' : ''}" data-screen-link="${open ? 'r3-d1-s1' : 'r3-d1-s5'}"><b>14</b>bestätigt</a><a class="mock-c-maybe"><b>9</b>möglich</a><a class="mock-c-late"><b>3</b>verschoben</a></div>`;

const pop = `<div class="mock-pop" data-m="pop"><div class="mock-pop-h"><b>14 bestätigt für 5.0</b>laut RSI-Roadmap<a data-screen-link="r3-d1-s1" aria-label="Schließen">×</a></div>
  <ul><li>Engineering Tier 0<small>Gameplay</small></li><li>Server-Meshing: dynamische Server<small>Technik</small></li><li>Neues Schiff: Drake Golem OX<small>Schiffe</small></li><li>Mission Boards überarbeitet<small>Missionen</small></li><li>Hangar-Aufzüge mit Warteschlange<small>Komfort</small></li><li>+ 9 weitere<small>alle im PTU-Reiter</small></li></ul></div>`;

const nextBox = (open) => `<section class="mock-box mock-next" data-m="next">
  <div class="mock-box-h"><span class="mock-kicker">Als Nächstes auf Live</span></div>
  <div class="mock-box-h"><h2>Alpha 5.0</h2><span class="mock-tag mock-t-ptu">im PTU · Welle 3</span><span class="mock-when"><b>Kein offizielles Datum</b>Schätzung: ~ Feb. 2027</span></div>
  ${trio(open)}
  <ul class="mock-items"><li><i class="mock-i-ok">bestätigt</i>Engineering Tier 0</li><li><i class="mock-i-ok">bestätigt</i>Server-Meshing: dynamische Server</li><li><i class="mock-i-maybe">möglich</i>Genesis-Planeten-Tech auf Hurston</li><li><i class="mock-i-late">verschoben</i>Quantum-Interdiction 2.0, neu: nach 5.0</li></ul>
  <div class="mock-acts"><a class="mock-btn" data-screen-link="r3-d1-s2" data-m="all50">Alles zu 5.0 im PTU →</a><span>Quelle: RSI-Roadmap, Stand heute</span></div>
  ${open ? pop : ''}
</section>`;

const NOW_LIST = `<ul class="mock-list">${li(NEWS)}${li(FIX.slice(0, 2), 'mock-fix')}</ul>`;

const nowUnread = `<section class="mock-box mock-now mock-unread" data-m="now">
  <div class="mock-box-h"><span class="mock-kicker">Gerade auf Live gekommen</span><span class="mock-new">Neu für dich</span></div>
  <div class="mock-box-h"><h2>Alpha 4.10.3</h2><span class="mock-tag mock-t-live">Live</span><span class="mock-when"><b>seit 12. Nov. 2026</b>vor 7 Tagen</span></div>
  ${NOW_LIST}
  <div class="mock-acts"><a class="mock-btn mock-primary" data-screen-link="r3-d1-s4">Ganz lesen →</a><a class="mock-btn" data-screen-link="r3-d1-s3" data-m="read">✓ Gelesen</a><span>Lesezeit ~2 Min.</span></div>
</section>`;

const nowRead = `<section class="mock-box mock-now" data-m="now-read">
  <div class="mock-box-h"><span class="mock-kicker">Gerade auf Live</span><span class="mock-readnote" data-m="readnote">✓ gelesen am 19. Nov.</span></div>
  <div class="mock-box-h"><h2>Alpha 4.10.3</h2><span class="mock-tag mock-t-live">Live</span><span class="mock-when"><b>seit 12. Nov. 2026</b>vor 7 Tagen</span></div>
  ${NOW_LIST}
  <div class="mock-acts"><a class="mock-btn" data-screen-link="r3-d1-s4">Nochmal lesen →</a><a class="mock-btn mock-quiet" data-screen-link="r3-d1-s1">als ungelesen markieren</a></div>
</section>`;

function sv(ver, title, tag, when, state, top1 = false) {
  const dot = state === 'unread' ? '<span class="mock-dot mock-unread"></span>' : '<span class="mock-dot mock-read">✓</span>';
  return `<a class="mock-sv${top1 ? ' mock-top1' : ''}" data-screen-link="r3-d1-s4">${dot}<b>${ver}</b><span>${title}</span>${tag}<time>${when}</time></a>`;
}
const T_LIVE = '<span class="mock-tag mock-t-live">Live</span>';

const timeline = (read) => `<div class="mock-tl" data-m="tl">
  <div class="mock-row mock-r-next"><div class="mock-date"><b>offen</b><small>kein Datum</small></div><a class="mock-card" data-screen-link="r3-d1-s2" data-m="row50">
    <div class="mock-ch"><span class="mock-pill">Als Nächstes</span><span class="mock-ver">Alpha 5.0</span><span class="mock-sent"><b>Im PTU seit 4. Nov., Welle 3</b><span>Klick: alle Test-Builds im PTU-Reiter</span></span><span></span></div>
  </a></div>
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
const s1 = `<div class="mock-r3">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowUnread}${nextBox(false)}</div>
  ${timeline(false)}
</div></div>
${layer(
  anno('r3-d1-s1-a1', 1, 'left', '[data-m="trio"] a', 'Die Zahlen sind jetzt kleine Knöpfe in einer Zeile, dafür passt eine 4. Zeile darunter. Ein Klick klappt die Liste auf (nächste Seite). So dezent genug?', 'Zahlen dezent, klickbar'),
  anno('r3-d1-s1-a2', 2, 'right', '[data-m="date"] b', 'Die Karten haben jetzt die volle Seitenbreite der App, Zeitleiste und Daten stehen links außerhalb. Passt die Breite jetzt zu dem, was du von der Seite kennst?', 'Volle App-Breite'),
  anno('r3-d1-s1-a3', 3, 'bottom', '[data-m="row50"] .mock-ver', 'Die 5.0-Zeile und „Alles zu 5.0“ führen beide in den PTU-Reiter. Richtig so?', '5.0 führt in den PTU'),
)}`;

const s5 = `<div class="mock-r3">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowUnread}${nextBox(true)}</div>
  ${timeline(false)}
</div></div>
${layer(
  anno('r3-d1-s5-a1', 1, 'left', '[data-m="pop"] .mock-pop-h b', 'Die aufgeklappte Liste zeigt die ersten Einträge mit Bereich, der Rest steht im PTU-Reiter. Reicht das, oder soll hier jeder Eintrag mit kurzer Beschreibung stehen?'),
)}`;

function build(open, ver, title, when, items, unread = false) {
  const dot = unread ? '<span class="mock-dot mock-unread"></span>' : '<span class="mock-dot mock-read">✓</span>';
  return `<details class="mock-build"${open ? ' open' : ''}><summary>${dot}<b>${ver}</b><span>${title}</span><span class="mock-tag mock-t-ptu">PTU</span><time>${when}</time></summary><ul class="mock-list">${items}</ul></details>`;
}

const s2 = `<div class="mock-r3">${top}<div class="mock-page">
  ${sw('ptu')}
  <section class="mock-box mock-next" data-m="ptu">
    <div class="mock-box-h"><span class="mock-kicker">Gerade im Test</span><span class="mock-new">1 neu</span></div>
    <div class="mock-box-h"><h2>Alpha 5.0 PTU</h2><span class="mock-tag mock-t-ptu">Welle 3</span><span class="mock-when"><b>neuester Build 13228337</b>gestern</span></div>
    <ul class="mock-list"><li>Welle 3: alle Backer mit PTU-Zugang</li><li class="mock-fix">Stabilitätsfixes für Server-Meshing</li><li class="mock-known">Bekannt: Mission Boards laden teils leer</li></ul>
    <div class="mock-acts"><a class="mock-btn mock-primary">Build-Notes lesen →</a><a class="mock-btn">✓ Gelesen</a><span>Original auf Spectrum ↗</span></div>
  </section>
  <div class="mock-card" data-m="builds">
    <div class="mock-wavehead">Welle 3 <span>alle Backer · seit 15. Nov.</span></div>
    ${build(true, 'Build 13228337', 'Alpha 5.0 PTU Patch Notes', 'gestern', `<li class="mock-fix">Server-Meshing: weniger Abbrüche beim Serverwechsel</li><li class="mock-fix">Drake Golem OX: Bohrkopf nimmt wieder Schaden</li><li class="mock-known">Bekannt: Mission Boards laden teils leer</li>`, true)}
    ${build(false, 'Build 13214006', 'Alpha 5.0 PTU Patch Notes', 'vor 3 Tagen', '<li class="mock-fix">Hangar-Aufzüge: Warteschlange zeigt die Position</li><li>Engineering: Sicherungen in allen Startschiffen</li>')}
    ${build(false, 'Build 13198112', 'Alpha 5.0 PTU Patch Notes', 'vor 4 Tagen', '<li>Welle 3 geöffnet</li><li class="mock-fix">Performance in Lorville</li>')}
    <div class="mock-wavehead">Welle 1 <span>Concierge und Subscriber · ab 4. Nov.</span></div>
    ${build(false, 'Build 13171540', 'Alpha 5.0 PTU Patch Notes', '12. Nov.', '<li>Engineering Tier 0 zum Testen frei</li>')}
    ${build(false, 'Build 13145020', 'Alpha 5.0 PTU Patch Notes', '8. Nov.', '<li>Erster 5.0-Build im PTU</li>')}
    <div class="mock-wavehead">Evocati <span>Tech-Preview unter NDA</span></div>
    ${build(false, 'Build 13119881', 'Genesis / Mission Boards Tech-Preview', 'Okt.', '<li>Nur Evocati, Inhalte unter NDA</li>')}
  </div>
  <div class="mock-hint">Was davon sicher auf Live kommt, steht im Reiter <a data-screen-link="r3-d1-s1">Live</a> unter „Als Nächstes“.</div>
</div></div>
${layer(
  anno('r3-d1-s2-a1', 1, 'right', '[data-m="builds"] .mock-build[open] summary b', 'Jetzt steht jeder einzelne Build mit seinen Änderungen da, nach Welle gruppiert, der neueste aufgeklappt. Ein Klick klappt jeden Build auf. So detailliert genug?', 'Jeder Build mit Inhalt'),
)}`;

const s3 = `<div class="mock-r3">${top}<div class="mock-page">
  ${sw('live')}
  <div class="mock-head">${nowRead}${nextBox(false)}</div>
  ${timeline(true)}
</div></div>
${layer(
  anno('r3-d1-s3-a1', 1, 'bottom', '[data-m="readnote"]', 'Nach „Gelesen“ bleibt alles stehen, nur der „Neu“-Hinweis und das Leuchten verschwinden, oben steht klein „✓ gelesen am …“, und der Knopf heißt „Nochmal lesen“. Unaufdringlich genug?', 'Inhalt bleibt sichtbar'),
)}`;

const s4 = `<div class="mock-r3">${top}<div class="mock-page">
  <div class="mock-dos">
    <nav class="mock-toc" data-m="toc"><a class="mock-on"><i>1</i>Was steckt drin</a><a><i>2</i>Stabilität</a><a><i>3</i>Community</a><a><i>4</i>Dein Urteil</a><a><i>5</i>Erste Schritte</a><a><i>6</i>Wann kommt der nächste</a></nav>
    <div class="mock-main">
      <div class="mock-dh"><h1>Alpha 4.10.3</h1><span class="mock-tag mock-t-live">Live</span><a class="mock-btn" data-m="rsi">Original bei RSI ↗</a></div>
      <p class="mock-dsub">Live seit 12. Nov. 2026 · drittes Update von Alpha 4.10 · <a class="mock-btn mock-quiet" data-screen-link="r3-d1-s1">← zurück zu den Patches</a></p>
      <section class="mock-sec"><h3>1 · Was steckt drin <i>neu und behoben</i></h3>
        <div class="mock-tile" data-m="tile"><div class="mock-img"></div><div><h4>LBCO Skarnov Rifle</h4><p>Neues Sturmgewehr von Lightning Bolt Co., in den Waffenläden von Area18 und Orison erhältlich.</p></div></div>
        <div class="mock-textonly" data-m="textonly"><h4>Vanduul Incursion</h4><p>Neue Missionsreihe: Vanduul-Angriffe auf Außenposten, als Gruppe spielbar, mit eigenen Belohnungen. Für diesen Punkt gibt es kein Bild, also nur Text über die volle Breite.</p></div>
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
  anno('r3-d1-s4-a1', 1, 'left', '[data-m="textonly"] h4', 'Mit Bild: Bild links, Text rechts. Ohne Bild: nur Text über die volle Breite, wie hier. Passt das?', 'Ohne Bild nur Text'),
  anno('r3-d1-s4-a2', 2, 'top', '[data-m="first"] h3', '„Vorbereiten“ ist aufgeteilt: „Erste Schritte in diesem Patch“ (nur falls nötig, z. B. nach einem Wipe) steht hier, „So bereitest du dich auf 5.0 vor“ steckt unter „Wann kommt der nächste“. Gut so?', 'Erste Schritte statt Vorbereiten'),
)}`;

