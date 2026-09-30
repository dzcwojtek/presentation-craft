// Runs before first paint (loaded without defer). Hides the elements that
// animate in on load so they don't flash visible before main.js starts, and
// sets up the intro (hands video + tagline) that plays first.
// Failsafe: if main.js never runs, content is revealed after 7s anyway
// (main.js cancels this as soon as it starts and takes over the timing).
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  // Every load starts at the top (a reload mid-page would otherwise skip the intro).
  if (!location.hash && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (location.hash) return; // deep link (e.g. #signup): go straight to the content
  root.classList.add('is-entering', 'is-intro', 'is-loading');
  window.__pcFailsafe = setTimeout(function () { root.classList.remove('is-entering', 'is-intro', 'is-loading'); }, 7000);

  // No scrolling until everything has appeared (main.js removes .is-loading
  // once the intro and the entry animation are done). Input is blocked
  // rather than hiding the scrollbar, so nothing shifts when it unlocks.
  var locked = function () { return root.classList.contains('is-loading'); };
  var block = function (e) { if (locked() && e.cancelable) e.preventDefault(); };
  var keys = [' ', 'Spacebar', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
  window.addEventListener('wheel', block, { passive: false });
  window.addEventListener('touchmove', block, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (locked() && keys.indexOf(e.key) !== -1 && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) e.preventDefault();
  });
  // anything else that scrolls it (a dragged scrollbar, a focused link) goes back to the top
  window.addEventListener('scroll', function () { if (locked() && window.scrollY) window.scrollTo(0, 0); });
})();
