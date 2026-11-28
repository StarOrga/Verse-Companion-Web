// Carries the boot splash's animation across a reload that happens while the app is still
// opening (a newer build became ready, see SwUpdateService): the page that reloads leaves a
// note in sessionStorage with how long its splash had been running, and this script seeks the
// new document's splash to that point, so the logo and the streaks run on instead of starting
// over. Loaded right behind the splash markup in index.html, not deferred, so it runs before
// the first frame. Keep the key and the note's shape in step with core/boot-splash.ts.
// External file because the CSP forbids inline scripts.
(function () {
  var KEY = 'sc.boot.resume';
  // A note older than this belongs to a reload that never came; the splash starts normally.
  var MAX_GAP_MS = 5000;
  try {
    var raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);
    var note = JSON.parse(raw);
    var gap = Date.now() - Number(note.at);
    var age = Number(note.age);
    if (!(gap >= 0 && gap < MAX_GAP_MS) || !(age > 0)) return;
    var splash = document.querySelector('.scb');
    if (!splash) return;
    // The stage shows at once: it was on screen a moment ago.
    splash.classList.add('scb-resume');
    var elapsed = age + gap;
    if (typeof splash.getAnimations === 'function') {
      var running = splash.getAnimations({ subtree: true });
      for (var i = 0; i < running.length; i++) {
        var at = Number(running[i].currentTime) || 0;
        running[i].currentTime = at + elapsed;
      }
    }
    // The orbiting dots are SMIL, on the logo's own timeline.
    var svg = splash.querySelector('svg');
    if (svg && typeof svg.setCurrentTime === 'function') svg.setCurrentTime(elapsed / 1000);
  } catch (e) {
    // Storage blocked or an old engine: the splash simply starts from the beginning.
  }
})();
