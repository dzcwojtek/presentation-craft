import { LESSONS, PEEK, STORY_MS, MEDIA_SIZE } from './lessons.js';

/* ==========================================================================
   Presentation Craft — interactions
   - entry animation on load (fade + rise + blur, top to bottom)
   - nav reveal after the intro scrolls away
   - fixed card pile → stories viewer (swipe, 5s autoplay, hold to pause)
   - lesson modal
   - email signup → /api/subscribe
   ========================================================================== */

const root = document.documentElement;
root.classList.add('js');
clearTimeout(window.__pcFailsafe); // boot.js's safety net: this script handles the timing now

const $ = (id) => document.getElementById(id);
const els = {
  nav: $('nav'),
  navInner: $('navInner'),
  hello: $('hello'),
  rail: $('ctaRail'),
  spacer: $('lessons'),
  stage: $('stage'),
  deck: $('deck'),
  progress: $('progress'),
  caption: $('caption'),
  prev: $('prevBtn'),
  next: $('nextBtn'),
  dialog: $('lesson'),
  panel: $('lessonPanel'),
  scroll: $('lessonScroll'),
  scrim: $('lessonScrim'),
  head: $('lessonHead'),
  grabber: $('lessonGrabber'),
  slide: $('lessonSlide'),
  body: $('lessonBody'),
  title: $('lessonTitle'),
  play: $('lessonPlay'),
  close: $('lessonClose'),
  form: $('signup'),
  input: $('email'),
  msg: $('signupMsg'),
};

const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqDesktop = matchMedia('(min-width: 900px)');
const clamp = (min, v, max) => Math.min(max, Math.max(min, v));
const N = LESSONS.length;
const smooth = () => (mqReduce.matches ? 'auto' : 'smooth');

const S = {
  mode: 'peek', // peek ⇄ stories
  index: 0,
  offset: 0, // carousel position relative to S.index, in slots (drag / spring)
  vel: 0,    // carousel velocity, slots per second (smoothed)
  grab: 0,   // 0…1: how "picked up" the held card is (eases in/out)
  dragging: false,
  hold: false,
  dialog: false,
};
let M = null; // cached viewport metrics

/* Shared entry animation: fade in, rise 12px, blur 12→0. Used on page load,
   by the nav logo (via CSS vars, fade + blur only) and by story captions. */
const ENTRANCE = {
  start: 120,     // ms before the first element
  stagger: 90,    // ms between steps
  duration: 600,  // ms per element
  rise: 12,       // px
  blur: 12,       // px
  easing: 'cubic-bezier(0, -0.02, 0.49, 0.99)',
};
const enterFrames = () => [
  { opacity: 0, transform: `translateY(${ENTRANCE.rise}px)`, filter: `blur(${ENTRANCE.blur}px)` },
  { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
];
root.style.setProperty('--enter-dur', `${ENTRANCE.duration}ms`);
root.style.setProperty('--enter-rise', `${ENTRANCE.rise}px`);
root.style.setProperty('--enter-blur', `${ENTRANCE.blur}px`);
root.style.setProperty('--enter-ease', ENTRANCE.easing);

/* ---------- build deck + progress ---------- */
els.stage.style.setProperty('--story-ms', `${STORY_MS}ms`);
els.stage.style.setProperty('--media-size', String(MEDIA_SIZE));

const cards = LESSONS.map((lesson, i) => {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.index = String(i);
  card.setAttribute('aria-roledescription', 'slide');
  card.setAttribute('aria-label', `Lesson ${i + 1} of ${N}: ${lesson.title}`);
  const m = lesson.media;
  // A card with media is filled by its video (bigger than the card, so the card
  // crops it). It loads only when the cards view needs it; the poster (first
  // frame) shows until then.
  card.innerHTML = m
    ? `<span class="card__visual card__visual--media"><video class="card__video" muted loop playsinline preload="none"
         disablepictureinpicture disableremoteplayback poster="${m.poster}"><source src="${m.webm}" type="video/webm"><source src="${m.mp4}" type="video/mp4"></video></span>`
    : `<span class="card__visual">${lesson.card}</span>`;
  els.deck.append(card);
  return card;
});

// Each card runs its own spring (so they can set off one after another):
// o = offset in slots, v = velocity (slots/s), t = where its spring pulls to,
// pend = [time, shift] target changes still waiting for their turn.
// sp = the spring it's running on (SPRING, or the faster STEP_SPRING for stepped moves).
const CS = cards.map(() => ({ o: 0, v: 0, t: 0, pend: [], sp: null }));
const resetCards = (o = 0, v = 0) => CS.forEach((c) => { c.o = o; c.v = v; c.t = 0; c.pend.length = 0; c.sp = SPRING; });
// slot position on screen: 0 = centre, ±1 = either side, wrapping round in [-N/2, N/2)
const wrapU = (raw) => ((((raw + N / 2) % N) + N) % N) - N / 2;
const slotU = (i) => wrapU(i - S.index - CS[i].o);

const segs = LESSONS.map((_, i) => {
  const seg = document.createElement('span');
  seg.className = 'seg';
  const bar = document.createElement('i');
  bar.addEventListener('animationend', () => {
    if (i === S.index && S.mode === 'stories') go(S.index + 1);
  });
  seg.append(bar);
  els.progress.append(seg);
  return seg;
});

/* ---------- geometry ----------
   Stories layout from Figma 99:780: nav → 24px → progress bars → 26px →
   card (21px side margins, 48px corners) → 53px → caption (68px) → 52px. */
const STORY = {
  progressGap: 24,  // nav bottom → progress bars
  cardGap: 26,      // progress bars → card
  captionGap: 53,   // card → caption
  captionH: 68,
  bottom: 52,       // caption → bottom edge
  gutter: 21,       // card side margin (mobile)
  barInset: 7,      // progress bars are this much narrower than the card, each side
  ratio: 351 / 539, // card width / height (Figma)
};
// Swipe depth: cards turn slightly in 3D and shrink as they leave or enter.
const DEPTH = {
  turn: { mobile: 24, desktop: 14 }, // deg of rotateY one slot away
  shrink: { mobile: 0.06, desktop: 0.22 },
  fade: { mobile: 0, desktop: 0.6 },
};
// Swipe physics. A spring pulls the carousel to the current card; releasing a
// drag hands the finger's momentum to it, and you can grab a card mid-flight.
const SPRING = { k: 170, c: 17 }; // stiffness (1/s²), damping (1/s): ~7% overshoot
// Follow-through for arrows, keys, auto-advance and clicking a side card: the
// cards move together, but not in lockstep. The one furthest ahead in the
// direction of travel sets off first and the others follow within `spread` ms
// (clicking › : left card, centre ~75ms later, right card 150ms later), so the
// motion overlaps. A drag moves them exactly together, under the finger.
// These stepped moves also run 30% faster than a drag release: the same
// spring with its timeline squeezed to 0.7× (stiffness ÷ 0.7², damping ÷ 0.7,
// so it keeps the same bounce), and the spread shortened to match.
const STEP = { speed: 0.7 };
const STEP_SPRING = { k: SPRING.k / STEP.speed ** 2, c: SPRING.c / STEP.speed };
const STAGGER = { spread: 150 * STEP.speed }; // ms from the first card setting off to the last (105)
const BUBBLE = {
  deadZone: 0.35,    // slots/s of motion ignored (finger jitter never shows)
  speedMax: 5,       // slots/s at which the effect is at full strength
  held: 0.035,       // a held card settles 3.5% smaller: picked up, but steady
  smooth: 0.09,      // s: velocity smoothing while dragging (drawn once per frame)
  shrink: 0.07,      // cards shrink up to 7% while moving
  stretch: 0.05,     // …and stretch 5% along the direction of travel
  flare: 9,          // deg: the leading edge flares out (rotateY), max
  flarePerSpeed: 2.2,
};

function metrics() {
  const vw = root.clientWidth;
  const vh = window.innerHeight;
  const desktop = mqDesktop.matches;
  const navBottom = els.navInner.offsetTop + els.navInner.offsetHeight;
  const bottom = desktop ? 24 : clamp(24, (vh * STORY.bottom) / 852, STORY.bottom);
  // room the progress bars need above the card, and the caption below it
  const topNeed = navBottom + STORY.progressGap + STORY.cardGap;
  const bottomNeed = STORY.captionGap + STORY.captionH + bottom;
  let h;
  let w;
  if (desktop) {
    // sized so the card can sit exactly in the middle of the screen
    h = clamp(340, vh - 2 * Math.max(topNeed, bottomNeed), 640);
    w = Math.round(h * STORY.ratio);
  } else {
    w = Math.min(vw - STORY.gutter * 2, 480);
    h = clamp(240, vh - topNeed - bottomNeed, Math.round(w * 1.7));
  }
  // The card is vertically centred on the screen, as far as the progress bars
  // (above) and the caption (below) still fit. Phones fill the height as in
  // Figma, so they only centre when there's height to spare.
  const cardTop = clamp(topNeed, (vh - h) / 2, Math.max(topNeed, vh - bottomNeed - h));
  const progressTop = cardTop - STORY.cardGap;
  const left = (vw - w) / 2;
  // height of each card's content: the text block in the middle of its video
  // (media), or the card's own markup
  const contentH = cards.map((c, i) => {
    const media = LESSONS[i].media;
    return media ? media.text * h * MEDIA_SIZE : c.querySelector('.card__visual > *')?.offsetHeight || 0;
  });
  const spacing = desktop ? w / 2 + 56 + (w * (1 - DEPTH.shrink.desktop)) / 2 : vw;
  return { vw, vh, desktop, navBottom, progressTop, cardTop, w, h, left, spacing, contentH, captionTop: cardTop + h + STORY.captionGap };
}

function targets(m) {
  if (S.mode !== 'stories') {
    const pile = m.desktop ? PEEK.desktop : PEEK.mobile;
    return cards.map((_, i) => {
      const p = pile[i] || pile[pile.length - 1];
      // Content moves from the card's middle to just above the screen's
      // bottom edge, so only its top part (the `reveal` share) is on screen.
      const cH = m.contentH[i] || 0;
      const contentTop = p.show - (p.reveal ?? PEEK.reveal) * cH; // from the card's top edge
      return {
        x: m.vw / 2 + p.cx - m.w / 2,
        y: m.vh - p.show,
        w: m.w, h: m.h, rot: p.rot, ry: 0, s: 1, o: 1, z: p.z, d: null,
        lift: contentTop - (m.h / 2 - cH / 2),
      };
    });
  }

  const kind = m.desktop ? 'desktop' : 'mobile';
  const hold = 1 - BUBBLE.held * S.grab;
  return cards.map((_, i) => {
    let d = i - S.index;
    if (d > N / 2) d -= N;
    if (d < -N / 2) d += N;
    const u = slotU(i);                    // position in slots (drag / spring included)
    // Bubbly motion: the faster a card moves, the more it shrinks, stretches
    // along the direction of travel and flares its leading edge.
    const vel = CS[i].v;
    const speed = Math.max(0, Math.abs(vel) - BUBBLE.deadZone);
    const q = clamp(0, speed / BUBBLE.speedMax, 1);
    const flare = clamp(-BUBBLE.flare, Math.sign(vel) * speed * BUBBLE.flarePerSpeed, BUBBLE.flare);
    const a = Math.min(Math.abs(u), 1);    // 0 = centre, 1 = one slot away
    const s = (1 - a * DEPTH.shrink[kind]) * (1 - BUBBLE.shrink * q) * hold;
    const sx = s * (1 + BUBBLE.stretch * q);
    const sy = s * (1 - BUBBLE.stretch * 0.6 * q);
    const x = m.left + u * m.spacing;
    const edgeFade = clamp(0, (1.5 - Math.abs(u)) / 0.35, 1); // hides the card that loops round
    return {
      x,
      y: m.cardTop,
      w: m.w,
      h: m.h,
      rot: 0,
      ry: clamp(-1, u, 1) * DEPTH.turn[kind] + flare,
      s: sx,
      sy,
      o: (1 - a * DEPTH.fade[kind]) * edgeFade,
      z: 10 - Math.round(Math.abs(u) * 2),
      d,
      u,
      bx: x + (m.w * (1 - sx)) / 2, // visual box, for the edge blur
      bw: m.w * sx,
      lift: 0,
    };
  });
}

/* Cards are only blurred near the screen edge: 8px while 40px or less of a
   card is still on screen, sharpening as more of it comes in (sharp from
   180px visible). A card you start swiping stays sharp until it's well on
   its way out. During a drag the value comes from the card's exact position;
   while a spring transition runs, a short rAF loop reads the real position
   so the blur stays in step with it. */
const CARD_BLUR = { max: 8, edge: 40, ramp: 140 };
let blurLoop = 0;
let blurUntil = 0;
function cardBlurAt(left, width) {
  const visible = Math.max(0, Math.min(left + width, M.vw) - Math.max(left, 0));
  const t = clamp(0, (visible - CARD_BLUR.edge) / CARD_BLUR.ramp, 1); // 0 at the edge → 1 well inside
  const s = t * t * (3 - 2 * t); // smoothstep
  return CARD_BLUR.max * (1 - s);
}

function setCardBlur(card, px) {
  const b = Math.round(px * 4) / 4;
  if (card._blur === b) return;
  card._blur = b;
  card.style.filter = b ? `blur(${b}px)` : '';
}

function trackCardBlur(ms = 800) {
  blurUntil = performance.now() + ms;
  if (!blurLoop) blurLoop = requestAnimationFrame(blurFrame);
}

function blurFrame() {
  blurLoop = 0;
  if (S.mode !== 'stories' || !M) { cards.forEach((c) => setCardBlur(c, 0)); return; }
  cards.forEach((c) => {
    const r = c.getBoundingClientRect();
    setCardBlur(c, cardBlurAt(r.left, r.width));
  });
  if (performance.now() < blurUntil) blurLoop = requestAnimationFrame(blurFrame);
}

let stageFor = null; // M the stage CSS vars were last written for
function layout() {
  if (!M) M = metrics();
  const t = targets(M);
  const stories = S.mode === 'stories';
  const now = performance.now();

  cards.forEach((card, i) => {
    const k = t[i];
    // On desktop the card that loops from one side to the other fades back in.
    if (k.u !== undefined && card._u !== undefined && Math.abs(k.u - card._u) > 1.4) card._appearAt = now;
    card._u = k.u;
    const appear = card._appearAt ? clamp(0, (now - card._appearAt) / 260, 1) : 1;
    if (appear >= 1) card._appearAt = 0;

    card.style.width = `${k.w}px`;
    card.style.height = `${k.h}px`;
    card.style.transform = `translate3d(${k.x.toFixed(2)}px, ${k.y.toFixed(2)}px, 0) rotate(${k.rot}deg) rotateY(${k.ry.toFixed(2)}deg) scale(${k.s.toFixed(4)}, ${(k.sy ?? k.s).toFixed(4)})`;
    // never quite 1: Safari 26 on iPhone clips fully opaque layers in fixed
    // elements at the top of its floating toolbar (and paints a black strip
    // below); at 0.999 they're composited normally and run under the toolbar
    card.style.opacity = String(Math.min(0.999, +(k.o * appear).toFixed(3)));
    card.style.zIndex = String(k.z);
    card.style.setProperty('--lift', `${k.lift.toFixed(1)}px`);

    const active = !stories || k.d === 0;
    card.tabIndex = active ? 0 : -1;
    card.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  const morphing = els.deck.classList.contains('is-morphing');
  if (stories && !morphing) t.forEach((k, i) => setCardBlur(cards[i], cardBlurAt(k.bx, k.bw)));
  else if (stories) trackCardBlur(1300); // CSS is moving them: follow the real positions
  else cards.forEach((c) => setCardBlur(c, 0));

  if (stageFor === M) return;
  stageFor = M;
  const st = els.stage.style;
  st.setProperty('--p-left', `${M.left + STORY.barInset}px`);
  st.setProperty('--p-w', `${M.w - STORY.barInset * 2}px`);
  st.setProperty('--p-top', `${M.progressTop}px`);
  st.setProperty('--po-y', `${M.cardTop + M.h / 2}px`); // 3D vanishing point = card centre
  const cw = M.desktop ? Math.max(M.w, 420) : Math.min(M.w - 38, 313);
  st.setProperty('--c-left', `${(M.vw - cw) / 2}px`);
  st.setProperty('--c-w', `${cw}px`);
  st.setProperty('--c-top', `${M.captionTop}px`);
  st.setProperty('--a-top', `${M.cardTop + M.h / 2 - 20}px`);
  st.setProperty('--a-prev', `${M.left - 48}px`);
  st.setProperty('--a-next', `${M.left + M.w + 8}px`);
}

/* ---------- modes ---------- */
let morphTimer = 0;
function setMode(mode) {
  if (S.mode === mode) return;
  S.mode = mode;
  root.classList.toggle('is-stories', mode === 'stories');

  M = metrics();
  els.deck.classList.add('is-morphing');
  const delays = mode === 'stories' ? [0, 70, 140] : [90, 45, 0];
  cards.forEach((c, i) => { c.style.transitionDelay = `${delays[i] ?? 0}ms`; });
  clearTimeout(morphTimer);
  morphTimer = setTimeout(() => {
    els.deck.classList.remove('is-morphing');
    cards.forEach((c) => { c.style.transitionDelay = ''; });
  }, 1300);

  stopPhysics();
  S.offset = 0;
  S.vel = 0;
  S.grab = 0;
  S.staggerEnd = 0;
  resetCards();
  if (mode === 'stories') {
    renderProgress(true);
    renderCaption(true);
  }
  layout();
  updateRunning();
  updateNav();
  placeCta();
  updateHint();
  updateGlow();
  syncStoriesClose();
}

/* ---------- email rest position + pull to the cards ----------
   At rest the email field sits exactly in the middle of the gap between
   paragraph 2 and the top of the peeking cards (gap worked out per screen).
   The page ends there, so ordinary scrolling (and flings) stop at the email
   field. Opening the cards is a separate, deliberate pull that has to start
   from that resting position: drag up (touch) or scroll on (wheel/trackpad,
   as a new gesture). The header follows with an iOS-style rubber band, the
   cards rise with it and the "Swipe down for examples" label brightens.
   Pull 40% of the screen height (or flick) to open; otherwise it springs
   back. In the cards view, pull down / scroll up to go back.
   Desktop (≥900px) doesn't use the pull. The page itself keeps scrolling
   past the email field into a short zone (PULL.desktop.zone). The cards rise
   with the scroll and the label brightens, and the cards open the moment
   the scroll passes 18% of the screen height. So it follows the wheel or
   trackpad (and its momentum) like any other scroll. Stop short, and the
   page glides back to the email field. The label there reads "See examples
   below" and is a button that scrolls into the cards. Going back from the
   cards is still a scroll up (PULL.close). */
const SIGNUP = {
  paragraphAt: 0.2, // at rest, paragraph 2 ends 20% of the way from nav to cards
  hintAt: 0.8,      // label appears once the email field passes 80% of the viewport
  restBottom: 0,    // computed: viewport y of the form's bottom edge at rest
  restScroll: 0,    // computed: scroll position of the rest state (= end of page)
};
const PULL = {
  open: 0.4,        // finger/wheel travel needed to open the cards (× viewport height)
  close: 0.22,      // travel needed to go back from the cards view
  flick: 0.5,       // px/ms: a flick opens/closes after 40% of the distance
  rubber: 0.55,     // iOS rubber-band constant
  cardsFollow: 0.6, // share of the header's movement the cards follow
  wheelGap: 200,    // ms without wheel events that starts a new wheel gesture
  wheelHold: 200,   // ms a wheel pull holds between events before it's released
  // desktop (≥900px): the native scroll zone, plus a lighter pull back out of the cards
  desktop: {
    zone: 0.35,     // extra page past the email field (× viewport height)
    open: 0.18,     // scrolling this far past the email field opens the cards (× viewport height)
    settle: 380,    // ms without scrolling before a short scroll glides back to the email field (slow wheel notches still add up)
    rubber: 0.9,
    wheelHold: 450,
  },
};
const pullCfg = () => (mqDesktop.matches ? { ...PULL, ...PULL.desktop } : PULL);
const nativeZone = () => mqDesktop.matches; // desktop: the page scrolls on into the cards
const zoneH = () => (nativeZone() ? Math.round(window.innerHeight * PULL.desktop.zone) : 0);
const heroSections = [...document.querySelectorAll('.hero')];
const hint = $('pullHint');
const hintBtn = $('pullHintBtn');
let placedW = 0;
let placedH = 0;
let pullOffset = 0; // px the header is currently moved by the pull (negative = up)
const pull = { raw: 0 };
const exitPull = { raw: 0 };

const rubberBand = (d, dim) => (1 - 1 / ((d * pullCfg().rubber) / dim + 1)) * dim;
// at (or, on desktop, past) the email field's resting spot
const atRest = () => window.scrollY >= SIGNUP.restScroll - 2;

function checkScroll() {
  updateHint();
  updateNav();
  updateZone();
}

/* desktop: scrolling past the email field. The cards (and label) rise with
   the page, and the cards open as soon as the scroll passes PULL.desktop.open. */
let zoneOn = false;
let zoneTimer = 0;
function updateZone() {
  if (!nativeZone() || S.mode === 'stories') return;
  const vh = window.innerHeight;
  const past = Math.max(0, window.scrollY - SIGNUP.restScroll);
  const on = past > 0.5;
  if (on !== zoneOn) {
    zoneOn = on;
    root.classList.toggle('is-pulling', on); // the cards follow the scroll with no easing lag
  }
  const rise = past * PULL.cardsFollow;
  els.deck.style.transform = on ? `translateY(${(-rise).toFixed(1)}px)` : '';
  if (hint) {
    hint.style.setProperty('--hint-o', (0.5 + 0.5 * clamp(0, past / (vh * PULL.desktop.open), 1)).toFixed(3));
    hint.style.setProperty('--hint-rise', `${(-rise).toFixed(1)}px`);
  }
  clearTimeout(zoneTimer);
  if (past >= vh * PULL.desktop.open) { openFromZone(); return; }
  if (on) zoneTimer = setTimeout(zoneSettle, PULL.desktop.settle);
}

// stopped short of the cards: glide back to the email field
function zoneSettle() {
  if (S.mode === 'stories' || !nativeZone()) return;
  if (window.scrollY > SIGNUP.restScroll + 0.5) window.scrollTo({ top: SIGNUP.restScroll, behavior: smooth() });
}

function openFromZone() {
  clearTimeout(zoneTimer);
  zoneOn = false;
  root.classList.remove('is-pulling'); // CSS transitions carry the cards into the stories layout
  // swallow the rest of this scroll (e.g. trackpad momentum)
  wg.kind = 'spent';
  wg.last = performance.now();
  wg.dir = 1;
  openStories();
  els.deck.style.transform = '';
  if (hint) { hint.style.setProperty('--hint-o', '0.5'); hint.style.setProperty('--hint-rise', '0px'); }
}

function updateHint() {
  if (!hint) return;
  const fieldTop = els.form.querySelector('.signup__field').getBoundingClientRect().top;
  const visible = S.mode !== 'stories' && fieldTop <= window.innerHeight * SIGNUP.hintAt;
  hint.classList.toggle('is-visible', visible);
  // only a real button on desktop, and only while it's showing
  if (hintBtn) {
    const usable = visible && mqDesktop.matches && !S.dialog;
    if (!usable && document.activeElement === hintBtn) hintBtn.blur();
    hintBtn.inert = !usable;
  }
}

// "See examples below" (desktop): open the cards, scrolling down to the
// email field's resting spot first if the page isn't there yet.
function showExamples() {
  if (S.mode === 'stories' || S.dialog) return;
  const hadFocus = document.activeElement === hintBtn;
  const open = () => {
    openStories();
    if (hadFocus) cards[S.index]?.focus({ preventScroll: true }); // keyboard users land on the current card
  };
  const t0 = performance.now();
  if (nativeZone()) {
    // desktop: scroll the page on into the cards, the same way a scroll would
    // (updateZone opens them on the way)
    const past = Math.ceil(window.innerHeight * PULL.desktop.open) + 4;
    window.scrollTo({ top: SIGNUP.restScroll + past, behavior: smooth() });
    const wait = () => {
      if (S.mode === 'stories') { if (hadFocus) cards[S.index]?.focus({ preventScroll: true }); return; }
      if (performance.now() - t0 > 1600) { // arrived without opening (shouldn't happen): open; interrupted: leave it
        if (window.scrollY >= SIGNUP.restScroll + past - 6) open();
        return;
      }
      requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
    return;
  }
  if (atRest()) { open(); return; }
  window.scrollTo({ top: SIGNUP.restScroll, behavior: smooth() });
  const wait = () => (atRest() || performance.now() - t0 > 1200 ? open() : requestAnimationFrame(wait));
  requestAnimationFrame(wait);
}
hintBtn?.addEventListener('click', showExamples);
mqDesktop.addEventListener?.('change', () => updateHint());

function setPull(raw) {
  const vh = window.innerHeight;
  pull.raw = Math.max(0, raw);
  const v = rubberBand(pull.raw, vh);
  pullOffset = v < 0.5 ? 0 : -v;
  const hold = pullOffset ? `translateY(${pullOffset.toFixed(1)}px)` : '';
  heroSections.forEach((s) => { s.style.transform = hold; });
  const rise = v * PULL.cardsFollow;
  els.deck.style.transform = rise >= 0.5 ? `translateY(${(-rise).toFixed(1)}px)` : '';
  if (hint) {
    hint.style.setProperty('--hint-o', (0.5 + 0.5 * clamp(0, pull.raw / (vh * pullCfg().open), 1)).toFixed(3));
    hint.style.setProperty('--hint-rise', `${(-rise).toFixed(1)}px`);
  }
  updateBlur();
}

function releasePull(velocity) {
  const need = window.innerHeight * pullCfg().open;
  const open = pull.raw >= need || (velocity > PULL.flick && pull.raw >= need * 0.4);
  root.classList.remove('is-pulling'); // CSS transitions take over from here
  if (open) {
    const keep = heroSections.map((s) => s.style.transform);
    openStories();
    setPull(0);
    // the header fades out where it was, then resets out of sight
    heroSections.forEach((s, i) => { s.style.transform = keep[i]; });
    setTimeout(() => { if (S.mode === 'stories') heroSections.forEach((s) => { s.style.transform = ''; }); }, 650);
  } else {
    setPull(0); // springs back
  }
}

// Pull down in the cards view: the cards and caption follow the finger; the
// progress bars stay where they are (and fade out if the view closes).
function setExitPull(raw) {
  exitPull.raw = Math.max(0, raw);
  const v = rubberBand(exitPull.raw, window.innerHeight);
  const move = v >= 0.5 ? `translateY(${v.toFixed(1)}px)` : '';
  [els.deck, els.caption, els.prev, els.next].forEach((el) => { el.style.transform = move; });
}

function releaseExitPull(velocity) {
  const need = window.innerHeight * PULL.close;
  const close = exitPull.raw >= need || (velocity > PULL.flick && exitPull.raw >= need * 0.4);
  root.classList.remove('is-pulling');
  setExitPull(0);
  if (close) closeStories();
}

function openStories() {
  if (S.mode === 'stories') return;
  setMode('stories');
}

function closeStories() {
  if (S.mode !== 'stories') return;
  // desktop opens partway into the scroll zone: come back at the email field
  // (the header is still invisible here, so the jump can't be seen)
  if (window.scrollY > SIGNUP.restScroll + 1) window.scrollTo(0, SIGNUP.restScroll);
  setMode('peek');
  checkScroll();
}

/* touch: a gesture that starts at rest and first moves up is a pull */
let tp = null;
window.addEventListener('touchstart', (e) => {
  if (S.dialog || e.touches.length !== 1) { tp = null; return; }
  const t = e.touches[0];
  tp = { x0: t.clientX, y0: t.clientY, ly: t.clientY, lt: e.timeStamp, v: 0, kind: null, atRest: atRest() };
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (!tp) return;
  const t = e.touches[0];
  const dx = t.clientX - tp.x0;
  const dy = t.clientY - tp.y0;
  if (!tp.kind) {
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    const vertical = Math.abs(dy) > Math.abs(dx);
    if (S.mode === 'stories') tp.kind = vertical && dy > 0 && !S.dragging ? 'close' : 'none';
    else tp.kind = tp.atRest && vertical && dy < 0 && !nativeZone() ? 'open' : 'none'; // desktop: native scroll
    if (tp.kind !== 'none') root.classList.add('is-pulling');
  }
  if (tp.kind === 'none') return;
  if (e.cancelable) e.preventDefault(); // no native scroll/bounce: we drive it
  const dt = Math.max(1, e.timeStamp - tp.lt);
  tp.v = 0.8 * ((t.clientY - tp.ly) / dt) + 0.2 * tp.v;
  tp.ly = t.clientY;
  tp.lt = e.timeStamp;
  if (tp.kind === 'open') setPull(-dy);
  else setExitPull(dy);
}, { passive: false });

function endTouch() {
  if (!tp) return;
  const { kind, v } = tp;
  tp = null;
  if (kind === 'open') releasePull(-v);
  else if (kind === 'close') releaseExitPull(v);
}
window.addEventListener('touchend', endTouch, { passive: true });
window.addEventListener('touchcancel', endTouch, { passive: true });

/* wheel / trackpad: only a new gesture that starts at rest can pull.
   There's no "finger up" with a wheel, so the cards open (or close) the
   moment the pull passes its threshold, not when the scrolling stops. The
   rest of that gesture (e.g. trackpad momentum) is then swallowed ('spent'),
   so it can't scroll the page or pull straight back. Reversing direction
   always starts a new gesture, so you can scroll back up right away. */
const wg = { last: 0, dir: 0, kind: null, raw: 0, timer: 0 };
window.addEventListener('wheel', (e) => {
  if (S.dialog || e.ctrlKey) return;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // sideways: the deck handles it
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
  if (!dy) return;
  const now = performance.now();
  const cfg = pullCfg();
  const gap = now - wg.last;
  const dir = Math.sign(dy);
  const reversed = wg.dir !== 0 && dir !== wg.dir;
  // a pull in progress keeps adding up while events keep coming (desktop
  // waits longer between them, so slow mouse-wheel notches count too)
  const continuing = (wg.kind === 'open' || wg.kind === 'close') && gap <= cfg.wheelHold;
  const fresh = !continuing && (gap > PULL.wheelGap || reversed);
  wg.last = now;
  wg.dir = dir;
  if (fresh) {
    wg.raw = 0;
    if (S.mode === 'stories') wg.kind = dy < 0 ? 'close' : 'stay';
    else wg.kind = !nativeZone() && atRest() && dy > 0 ? 'open' : null; // desktop: native scroll (see updateZone)
    if (wg.kind === 'open' || wg.kind === 'close') root.classList.add('is-pulling');
  }
  if (!wg.kind) return; // ordinary scrolling (momentum stops at the email field)
  e.preventDefault();
  const vh = window.innerHeight;
  if (wg.kind === 'open') {
    wg.raw = Math.max(0, wg.raw + dy);
    setPull(wg.raw);
    if (wg.raw >= vh * cfg.open) { wg.kind = 'spent'; releasePull(0); } // opens now
  } else if (wg.kind === 'close') {
    wg.raw = Math.max(0, wg.raw - dy);
    setExitPull(wg.raw);
    if (wg.raw >= vh * cfg.close) { wg.kind = 'spent'; releaseExitPull(0); } // closes now
  }
  clearTimeout(wg.timer);
  wg.timer = setTimeout(() => {
    const kind = wg.kind;
    wg.kind = null;
    if (kind === 'open') releasePull(0);
    else if (kind === 'close') releaseExitPull(0);
  }, cfg.wheelHold - 20);
}, { passive: false });

function peekTop(m) {
  const pile = m.desktop ? PEEK.desktop : PEEK.mobile;
  return Math.min(...pile.map((p) => {
    const r = (Math.abs(p.rot) * Math.PI) / 180;
    const cy = m.vh - p.show + m.h / 2;
    return cy - (m.w * Math.sin(r) + m.h * Math.cos(r)) / 2; // rotated card's top edge
  }));
}

function placeSignup(force) {
  const w = root.clientWidth;
  const h = window.innerHeight;
  // Mobile toolbars change the height by <150px while scrolling; don't re-flow for those.
  if (force || w !== placedW || Math.abs(h - placedH) > 150) {
    placedW = w;
    placedH = h;
    const m = metrics();
    const cardsTop = peekTop(m);
    const formH = els.form.offsetHeight;
    const paragraphEnd = m.navBottom + (cardsTop - m.navBottom) * SIGNUP.paragraphAt;
    const gap = clamp(40, (cardsTop - paragraphEnd - formH) / 2, 420);
    els.form.style.setProperty('--signup-gap', `${gap.toFixed(1)}px`);
    SIGNUP.restBottom = cardsTop - gap;
    if (hint) hint.style.top = `${Math.round(cardsTop - 20 - hint.offsetHeight)}px`; // 20px above the pile
  }
  // The page ends exactly at the rest position (offsetTop ignores the pull transform).
  const body = els.form.offsetParent;
  const formBottomDoc = (body ? body.offsetTop : 0) + els.form.offsetTop + els.form.offsetHeight;
  SIGNUP.restScroll = Math.max(0, formBottomDoc - SIGNUP.restBottom);
  // (plus, on desktop, the zone that scrolls on into the cards)
  const spacerH = Math.max(0, SIGNUP.restScroll + h + zoneH() - els.spacer.offsetTop);
  els.spacer.style.height = `${Math.round(spacerH)}px`;
}

// The nav logo appears the moment the Sign up button docks into the bar
// (its sticky rail reaches its stuck position) and hides again when it
// undocks. CSS runs the entry-style transition both ways.
let railStuckAt = null; // the rail's CSS `top`, cached (reset on resize)
function updateNav() {
  if (railStuckAt === null) railStuckAt = parseFloat(getComputedStyle(els.rail).top) || 0;
  const docked = els.rail.getBoundingClientRect().top <= railStuckAt + 0.5;
  els.nav.classList.toggle('is-visible', S.mode === 'stories' || docked);
}

// The cards view always has the full nav bar: logo and Sign up. If the cards
// were opened from higher up the page (Sign up not docked yet), the button
// glides up into its spot in the bar while the logo fades in, as if you'd
// scrolled there, and glides back when the cards close.
function placeCta(animate = true) {
  const inner = els.rail.firstElementChild;
  if (!inner) return;
  if (railStuckAt === null) railStuckAt = parseFloat(getComputedStyle(els.rail).top) || 0;
  // the rail itself is never moved, so its box is where the button would be
  const shift = S.mode === 'stories' ? Math.min(0, railStuckAt - els.rail.getBoundingClientRect().top) : 0;
  inner.classList.toggle('is-instant', !animate);
  inner.style.transform = shift < -0.5 ? `translateY(${shift.toFixed(1)}px)` : '';
  if (!animate) {
    void inner.offsetWidth; // apply without a transition, then re-enable it
    inner.classList.remove('is-instant');
  }
}

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    checkScroll();
    updateBlur();
  });
}, { passive: true });

/* ---------- animated bottom glow ----------
   WebM with an alpha channel only renders correctly in Chromium and Firefox.
   Safari/iOS get an MP4 flattened onto black, screen-blended over the page.
   The video pauses whenever it can't be seen. */
const glowVideo = $('glowVideo');
const GLOW_SRC = {
  webm: '/assets/video/bottom-glow.webm',
  mp4: '/assets/video/bottom-glow.mp4',
};

// Can this browser show a WebM's transparency? Chromium and Firefox can;
// Safari (and every iOS browser) plays WebM but draws it on black.
function alphaWebmOK(video) {
  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari\//.test(ua) && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(ua);
  return !iOS && !safari && !!video && video.canPlayType('video/webm; codecs="vp9"') !== '';
}

function glowSource() {
  return alphaWebmOK(glowVideo) ? GLOW_SRC.webm : GLOW_SRC.mp4;
}

function updateGlow() {
  if (!glowVideo || !glowVideo.src) return;
  const visible = S.mode !== 'stories' && !document.hidden && !mqReduce.matches;
  if (visible) glowVideo.play().catch(() => {}); // autoplay refused → poster stays
  else glowVideo.pause();
}

// Loaded after the intro, so its 4MB doesn't compete with the intro video.
function loadGlow() {
  if (!glowVideo || glowVideo.src) return;
  const src = glowSource();
  glowVideo.parentElement.classList.toggle('is-flat', src === GLOW_SRC.mp4);
  glowVideo.src = src;
  document.addEventListener('visibilitychange', updateGlow);
  updateGlow();
}

/* ---------- header progressive blur ----------
   Each paragraph is split into its rendered lines; each line (and each
   [data-blur] block) gets one even blur based on where its centre sits on
   screen: 0px at 70% of the viewport height → 8px at the bottom edge. */
const BLUR = { from: 0.7, to: 1, max: 8 };
const ledes = [...document.querySelectorAll('.lede')];
let blurTargets = [];
let splitWidth = 0;

// Splits an element's text into its rendered lines (<span class="split-line">),
// keeping inline elements (like .inline-logo) and the original spacing.
// Words inside inline elements (a link, <em>) are split too, and each line
// gets its own copy of those elements, so a link that wraps onto the next
// line stays a link (and keeps its styling) on both lines. Empty elements
// (like .inline-logo) move as one piece.
function splitLines(el) {
  if (el.dataset.src === undefined) el.dataset.src = el.innerHTML;
  el.innerHTML = el.dataset.src;
  const units = []; // { node, path: inline elements it sits in, space: a space before it }
  let space = false;
  const walk = (parent, path) => {
    for (const child of [...parent.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        for (const part of child.data.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { space = true; continue; }
          const word = document.createElement('span');
          word.textContent = part;
          units.push({ node: word, path, space: space && units.length > 0 });
          space = false;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.childNodes.length && !child.classList.contains('inline-logo')) walk(child, [...path, child]);
        else { units.push({ node: child, path, space: space && units.length > 0 }); space = false; }
      }
    }
  };
  walk(el, []);

  // puts units into `target`, re-creating the inline elements they sit in
  // (one copy per run of consecutive words, spaces inside when both sides are)
  const build = (target, list) => {
    let chain = []; // open copies: [{ orig, copy }]
    list.forEach((u, k) => {
      let n = 0;
      while (n < chain.length && n < u.path.length && chain[n].orig === u.path[n]) n += 1;
      chain = chain.slice(0, n);
      const top = () => (chain.length ? chain[chain.length - 1].copy : target);
      if (u.space && k > 0) top().append(' ');
      for (let i = n; i < u.path.length; i++) {
        const copy = u.path[i].cloneNode(false);
        top().append(copy);
        chain.push({ orig: u.path[i], copy });
      }
      top().append(u.node);
    });
  };

  el.textContent = '';
  build(el, units);
  const lines = [];
  let lineMid = null;
  for (const u of units) {
    const r = u.node.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (lineMid === null || Math.abs(mid - lineMid) > 6) { lines.push([]); lineMid = mid; }
    lines[lines.length - 1].push(u);
  }
  el.textContent = '';
  lines.forEach((line, i) => {
    const span = document.createElement('span');
    span.className = 'split-line';
    build(span, line);
    el.append(span);
    if (i < lines.length - 1) el.append(' '); // keeps copy/paste + screen readers right
  });
}

function prepareBlur(force) {
  const width = root.clientWidth;
  if (force || width !== splitWidth) {
    splitWidth = width;
    ledes.forEach(splitLines);
  }
  const sy = window.scrollY;
  blurTargets = [...document.querySelectorAll('.lede .split-line, [data-blur]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, mid: r.top + sy - pullOffset + r.height / 2, field: Boolean(el.closest('.signup')), value: -1 };
  });
  updateBlur();
}

function updateBlur() {
  if (S.mode === 'stories') return; // header is hidden
  const vh = window.innerHeight;
  const sy = window.scrollY;
  const typing = root.classList.contains('is-typing');
  for (const t of blurTargets) {
    const p = (t.mid + pullOffset - sy) / vh;
    let b = clamp(0, (p - BLUR.from) / (BLUR.to - BLUR.from), 1) * BLUR.max;
    if (typing && t.field) b = 0;
    b = Math.round(b * 4) / 4; // quarter-pixel steps: fewer repaints
    if (b !== t.value) {
      t.value = b;
      t.el.style.filter = b ? `blur(${b}px)` : '';
    }
  }
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  railStuckAt = null;
  M = metrics();
  els.deck.classList.add('is-instant');
  layout();
  placeSignup(false);
  checkScroll();
  placeCta(false);
  prepareBlur(false);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => els.deck.classList.remove('is-instant'), 120);
});

/* ---------- stories ---------- */
function renderProgress(restart) {
  segs.forEach((seg, i) => {
    seg.classList.toggle('is-done', i < S.index);
    seg.classList.toggle('is-active', i === S.index);
  });
  if (restart) {
    const bar = segs[S.index].firstElementChild;
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
  }
}

// Captions come in with the entry animation (fade + rise + blur 12→0).
// On a card change the old caption fades/blurs out quickly first.
const CAPTION_IN_DELAY = 400; // when stories open: let the cards land first
const CAPTION_OUT_MS = 180;
let captionAnim = null;
let captionSeq = 0;

function captionIn(span, text, delay) {
  span.textContent = text;
  captionAnim?.cancel();
  if (mqReduce.matches) return;
  captionAnim = span.animate(enterFrames(), {
    duration: ENTRANCE.duration, delay, easing: ENTRANCE.easing, fill: 'backwards',
  });
}

function renderCaption(opening) {
  const span = els.caption.firstElementChild;
  const text = LESSONS[S.index].caption;
  const seq = ++captionSeq;
  if (opening || !span.textContent) {
    captionIn(span, text, opening ? CAPTION_IN_DELAY : 0);
    return;
  }
  if (span.textContent === text) return;
  captionAnim?.cancel();
  if (mqReduce.matches) { span.textContent = text; return; }
  captionAnim = span.animate(
    [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: `blur(${ENTRANCE.blur}px)` }],
    { duration: CAPTION_OUT_MS, easing: 'ease-in', fill: 'forwards' },
  );
  captionAnim.onfinish = () => { if (seq === captionSeq) captionIn(span, text, 0); };
}

// stagger: true for arrows / keys / auto-advance / clicking a side card
// (follow-through); false after a drag (the cards leave the finger together).
function go(i, stagger = true) {
  const prev = S.index;
  const before = cards.map((_, k) => slotU(k)); // where each card sits now
  S.index = ((i % N) + N) % N;
  let delta = S.index - prev; // shortest way round
  if (delta > N / 2) delta -= N;
  if (delta < -N / 2) delta += N;
  S.offset -= delta;
  // the card furthest ahead in the direction of travel sets off first
  const order = cards.map((_, k) => k).sort((a, b) => (delta > 0 ? before[a] - before[b] : before[b] - before[a]));
  const now = performance.now();
  const step = stagger && !mqReduce.matches ? STAGGER.spread / Math.max(1, N - 1) : 0;
  order.forEach((k, rank) => {
    const c = CS[k];
    c.o -= delta; // same picture this frame…
    c.t -= delta; // …and it keeps doing what it was doing until its turn
    c.pend.push([now + rank * step, delta]);
    c.sp = stagger ? STEP_SPRING : SPRING;
  });
  // a card that loops round waits off screen until the last card sets off,
  // then comes in alongside it
  S.staggerEnd = step ? now + (N - 1) * step : 0;
  renderProgress(S.index === prev);
  renderCaption(false);
  updateRunning();
  startPhysics();
}

/* spring simulation (one spring per card) */
let physicsRaf = 0;
let physicsLast = 0;
function startPhysics() {
  if (mqReduce.matches || S.mode !== 'stories') {
    S.offset = 0;
    S.vel = 0;
    S.grab = 0;
    resetCards();
    layout();
    return;
  }
  if (physicsRaf) return;
  physicsLast = performance.now();
  physicsRaf = requestAnimationFrame(physicsStep);
}
function stopPhysics() {
  cancelAnimationFrame(physicsRaf);
  physicsRaf = 0;
}
function physicsStep(now) {
  physicsRaf = 0;
  if (S.dragging || S.mode !== 'stories') return;
  const dt = Math.min(0.032, (now - physicsLast) / 1000);
  physicsLast = now;
  const t = performance.now();
  let busy = false;
  CS.forEach((c, i) => {
    // target shifts whose turn has come
    while (c.pend.length && c.pend[0][0] <= t) c.t += c.pend.shift()[1];
    const u0 = slotU(i);
    // two half-steps (semi-implicit Euler) keep it stable on slow frames
    for (let n = 0; n < 2; n++) {
      const h = dt / 2;
      const sp = c.sp || SPRING;
      c.v += (-sp.k * (c.o - c.t) - sp.c * c.v) * h;
      c.o += c.v * h;
    }
    const u1 = slotU(i);
    if (t < S.staggerEnd && Math.abs(u1 - u0) > 1.4) {
      // looped round mid-move: park it just inside the far edge (invisible)
      // and let it come in once the last card has set off, so it never
      // lands on a card that hasn't moved yet
      const pin = u1 > 0 ? N / 2 - 0.001 : -N / 2 + 0.001;
      c.o += u1 - pin;
      c.pend.push([S.staggerEnd, c.t - c.o]);
      c.pend.sort((a, b) => a[0] - b[0]);
      c.t = c.o;
      c.v = 0;
    }
    if (c.pend.length || Math.abs(c.o - c.t) > 0.0008 || Math.abs(c.v) > 0.01) busy = true;
    else { c.o = c.t; c.v = 0; }
  });
  S.grab *= Math.exp(-dt / 0.14); // the card eases back to full size
  if (S.grab < 0.002) S.grab = 0;
  const settled = !busy && !S.grab;
  if (settled) resetCards(); // everything home: all targets are 0
  S.offset = CS[S.index].o; // the centre card: where a grab picks up from
  S.vel = CS[S.index].v;
  layout();
  const fading = cards.some((c) => c._appearAt);
  if (!settled || fading) physicsRaf = requestAnimationFrame(physicsStep);
}

function updateRunning() {
  const running =
    S.mode === 'stories' && !S.hold && !S.dragging && !S.dialog && !document.hidden && !mqReduce.matches;
  els.stage.classList.toggle('is-paused', !running);
  syncCardVideos(running);
}

/* Card videos: in the cards view only the card in the middle plays, from the
   start each time it comes round, and it pauses with the story (press and
   hold, lesson open, hidden tab). The next card's video loads in the
   meantime. In the pile, and with reduced motion, they rest on their first
   frame. */
let activeVideo = null;
function syncCardVideos(running) {
  const videoOf = (i) => cards[((i % N) + N) % N]?.querySelector('video');
  const want = S.mode === 'stories' && !mqReduce.matches ? videoOf(S.index) : null;
  cards.forEach((c) => {
    const v = c.querySelector('video');
    if (!v || v === want) return;
    if (!v.paused) v.pause();
    if (S.mode !== 'stories' && v.currentTime) v.currentTime = 0; // back in the pile: first frame
  });
  if (!want) { activeVideo = null; return; }
  if (want !== activeVideo) {
    activeVideo = want;
    if (want.currentTime) want.currentTime = 0;
  }
  if (want.preload !== 'auto') want.preload = 'auto';
  const next = videoOf(S.index + 1);
  if (next && next.preload !== 'auto') next.preload = 'auto';
  if (running) want.play().catch(() => {}); // refused: its poster stays
  else if (!want.paused) want.pause();
}
document.addEventListener('visibilitychange', updateRunning);

function enterStories() {
  openStories();
}

/* swipe / hold / tap */
let P = null;
let suppressClick = false;

els.deck.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (!e.target.closest('.card')) return;
  suppressClick = false;
  const now = performance.now();
  P = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: now, cx: e.clientX, hist: [[now, e.clientX]], axis: null, holdTimer: 0, offset0: S.offset };
  if (S.mode === 'stories') {
    P.holdTimer = setTimeout(() => { S.hold = true; updateRunning(); }, 200);
  }
});

window.addEventListener('pointermove', (e) => {
  if (!P || e.pointerId !== P.id) return;
  const dx = e.clientX - P.x0;
  const dy = e.clientY - P.y0;
  if (!P.axis && Math.hypot(dx, dy) > 8) {
    P.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    clearTimeout(P.holdTimer);
    if (P.axis === 'x' && S.mode === 'stories') {
      S.dragging = true;
      stopPhysics();
      S.offset = CS[S.index].o; // catch the centre card wherever it is…
      resetCards(S.offset);     // …and the others join it (they move together under the finger)
      P.offset0 = S.offset;
      P.x0 = e.clientX;     // start from here: no jump by the 8px it took to decide
      P.cx = e.clientX;
      P.hist = [[performance.now(), e.clientX]];
      els.deck.classList.add('is-dragging');
      els.deck.classList.remove('is-morphing');
      updateRunning();
      startDragFrames();
    }
  }
  if (S.dragging) {
    // Only record here; the card is drawn once per frame (dragFrame), so uneven
    // touch-event timing can't make it jitter.
    const now = performance.now();
    P.cx = e.clientX;
    P.hist.push([now, e.clientX]);
    while (P.hist.length > 2 && now - P.hist[0][0] > 100) P.hist.shift();
  }
}, { passive: true });

let dragRaf = 0;
let dragLast = 0;
function startDragFrames() {
  cancelAnimationFrame(dragRaf);
  dragLast = performance.now();
  dragRaf = requestAnimationFrame(dragFrame);
}
function dragFrame(now) {
  dragRaf = 0;
  if (!S.dragging || !P) return;
  const dt = Math.max(0.001, Math.min(0.05, (now - dragLast) / 1000));
  dragLast = now;
  const prev = S.offset;
  S.offset = P.offset0 - (P.cx - P.x0) / M.spacing; // follows the finger 1:1
  const k = 1 - Math.exp(-dt / BUBBLE.smooth);      // smoothed velocity → steady squash
  S.vel += ((S.offset - prev) / dt - S.vel) * k;
  S.grab += (1 - S.grab) * (1 - Math.exp(-dt / 0.08)); // ease into the "held" size
  resetCards(S.offset, S.vel);
  layout();
  dragRaf = requestAnimationFrame(dragFrame);
}

// Finger speed over the last ~100ms (px/ms); 0 if it had stopped moving.
function releaseVelocity() {
  const h = P.hist;
  if (h.length < 2) return 0;
  const [t1, x1] = h[h.length - 1];
  if (performance.now() - t1 > 60) return 0;
  const [t0, x0] = h[0];
  return t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
}

function endPointer(e) {
  if (!P || e.pointerId !== P.id) return;
  clearTimeout(P.holdTimer);
  const held = S.hold;
  const long = performance.now() - P.t0 > 350;
  S.hold = false;

  if (S.dragging) {
    S.dragging = false;
    cancelAnimationFrame(dragRaf);
    dragRaf = 0;
    els.deck.classList.remove('is-dragging');
    // Where would the momentum carry it? Step one card that way, or spring back.
    const cancelled = e.type === 'pointercancel';
    S.offset = P.offset0 - (P.cx - P.x0) / M.spacing;
    S.vel = cancelled ? 0 : (-releaseVelocity() * 1000) / M.spacing;
    resetCards(S.offset, S.vel); // the finger's momentum goes to every card
    const projected = S.offset + S.vel * 0.2;
    if (!cancelled && projected > 0.3) go(S.index + 1, false);
    else if (!cancelled && projected < -0.3) go(S.index - 1, false);
    else startPhysics();
    suppressClick = true;
  } else if (P.axis || held || long) {
    suppressClick = true;
  }
  if (suppressClick) setTimeout(() => { suppressClick = false; }, 80);
  P = null;
  updateRunning();
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

els.deck.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  if (suppressClick) { suppressClick = false; return; }
  const i = Number(card.dataset.index);
  if (S.mode !== 'stories') {
    S.index = i;
    enterStories();
  } else if (i === S.index) {
    openLesson(i);
  } else {
    go(i);
  }
});

els.deck.addEventListener('contextmenu', (e) => { if (S.hold) e.preventDefault(); });

// trackpad horizontal swipe
let wheelLock = 0;
let wheelAcc = 0;
els.deck.addEventListener('wheel', (e) => {
  if (S.mode !== 'stories' || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  if (performance.now() < wheelLock) return;
  wheelAcc += e.deltaX;
  if (Math.abs(wheelAcc) > 60) {
    go(S.index + (wheelAcc > 0 ? 1 : -1));
    wheelAcc = 0;
    wheelLock = performance.now() + 600;
  }
}, { passive: false });

els.prev.addEventListener('click', () => go(S.index - 1));
els.next.addEventListener('click', () => go(S.index + 1));

// desktop × (top-right): back to the email field / card pile
const storiesClose = $('storiesClose');
function syncStoriesClose() {
  if (!storiesClose) return;
  const usable = S.mode === 'stories' && mqDesktop.matches;
  if (!usable && document.activeElement === storiesClose) storiesClose.blur();
  storiesClose.inert = !usable;
}
storiesClose?.addEventListener('click', () => {
  const hadFocus = document.activeElement === storiesClose;
  closeStories();
  if (hadFocus) cards[S.index]?.focus({ preventScroll: true }); // keyboard users land on the card pile
});
mqDesktop.addEventListener?.('change', syncStoriesClose);

document.addEventListener('keydown', (e) => {
  if (S.dialog) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  // at the email field, keyboard users open the cards with ↓ / Page Down / Space
  if (S.mode !== 'stories') {
    if (atRest() && ['ArrowDown', 'PageDown', ' ', 'End'].includes(e.key)) { e.preventDefault(); showExamples(); }
    return;
  }
  if (['ArrowUp', 'PageUp', 'Escape', 'Home'].includes(e.key)) { e.preventDefault(); closeStories(); return; }
  const inDeck = els.deck.contains(document.activeElement);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    go(S.index + (e.key === 'ArrowRight' ? 1 : -1));
    if (inDeck) cards[S.index].focus({ preventScroll: true });
  }
});

/* ---------- lesson modal ----------
   Mobile: bottom sheet. Drag the header (handle + preview) down to close,
   tap the handle to close, or tap above the sheet. Its bottom 15% fades the
   text out and blurs each line progressively (0 → 8px).
   Desktop: centred dialog with a close button. */
const SHEET_BLUR = { from: 0.85, to: 1, max: 8 };
const isSheet = () => !mqDesktop.matches;
let closing = false;
let sheetLines = [];
let sheetTicking = false;
let sheetDrag = null;
let suppressSheetClick = false;

function openLesson(i) {
  const lesson = LESSONS[i];
  els.title.textContent = lesson.title;
  stopPreviewRun();
  els.slide.innerHTML = lesson.demo;
  els.body.innerHTML = lesson.sections
    .map((s) => `<section class="lesson__section"><h3>${s.title}</h3>${s.body.map((p) => `<p>${p}</p>`).join('')}</section>`)
    .join('');
  lessonActive = -1;
  setLessonActive(0, true);

  S.dialog = true;
  updateRunning();
  root.classList.add('is-locked');
  els.dialog.showModal();
  sizeLessonTag();
  els.scroll.scrollTop = 0;
  (isSheet() ? els.grabber : els.close).focus({ preventScroll: true });
  prepareSheetBlur();
  updateLessonFocus();
  requestAnimationFrame(() => requestAnimationFrame(() => els.dialog.classList.add('is-open')));
}

/* ---------- lesson: scroll-driven preview ----------
   As you scroll through the lesson, the section crossing the focus line (a
   little below the pinned preview) lights up, and the preview transforms into
   that section's state: the demo has one state per section (.s1 … .s4 on the
   slide, cumulative, styled in styles.css). Scrolling back reverses it. The
   play button runs through all the states, then returns to the section in
   focus. */
const LESSON_FOCUS = {
  at: 0.3,        // focus line: this far down the text area below the preview
  demoSteps: 4,   // the demos' last state (s4); sections are spread over s0…s4
  runStep: 650,   // ms per state when the play button runs through them
};
let lessonActive = -1;
let previewRun = 0;

function showPreviewStep(step) {
  for (let i = 1; i <= LESSON_FOCUS.demoSteps; i++) els.slide.classList.toggle(`s${i}`, i <= step);
}
function stepForSection(k, n) {
  return n > 1 ? Math.round((k * LESSON_FOCUS.demoSteps) / (n - 1)) : LESSON_FOCUS.demoSteps;
}

function setLessonActive(k, force = false) {
  if (k === lessonActive && !force) return;
  lessonActive = k;
  const sections = els.body.querySelectorAll('.lesson__section');
  sections.forEach((sec, i) => sec.classList.toggle('is-active', i === k));
  if (!previewRun) showPreviewStep(stepForSection(k, sections.length));
}

function updateLessonFocus() {
  if (!S.dialog) return;
  const sections = els.body.querySelectorAll('.lesson__section');
  if (!sections.length) return;
  const sc = els.scroll;
  const bottom = sc.getBoundingClientRect().bottom;
  const headBottom = els.head.getBoundingClientRect().bottom;
  const line = headBottom + (bottom - headBottom) * LESSON_FOCUS.at;
  let k = 0;
  sections.forEach((sec, i) => { if (sec.getBoundingClientRect().top <= line) k = i; });
  // at the very end, the last section counts even if it can't reach the line
  if (sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) k = sections.length - 1;
  setLessonActive(k);
}

function stopPreviewRun() {
  clearTimeout(previewRun);
  previewRun = 0;
}
function runPreview() {
  stopPreviewRun();
  let step = 0;
  showPreviewStep(0);
  const next = () => {
    step += 1;
    if (step > LESSON_FOCUS.demoSteps) {
      previewRun = 0;
      showPreviewStep(stepForSection(lessonActive, els.body.querySelectorAll('.lesson__section').length));
      return;
    }
    showPreviewStep(step);
    previewRun = setTimeout(next, LESSON_FOCUS.runStep);
  };
  previewRun = setTimeout(next, LESSON_FOCUS.runStep);
}

function closeLesson() {
  if (!S.dialog || closing) return;
  closing = true;
  els.dialog.classList.remove('is-open', 'is-dragging');
  setTimeout(() => {
    closing = false;
    if (els.dialog.open) els.dialog.close();
  }, mqReduce.matches ? 0 : isSheet() ? 380 : 320);
}

/* bottom-of-sheet blur, line by line */
function prepareSheetBlur() {
  sheetLines.forEach((t) => { t.el.style.filter = ''; });
  sheetLines = [];
  if (!isSheet() || !S.dialog) return;
  els.body.querySelectorAll('h3, p').forEach(splitLines);
  const box = els.scroll.getBoundingClientRect();
  const st = els.scroll.scrollTop;
  sheetLines = [...els.body.querySelectorAll('.split-line')].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, mid: r.top - box.top + st + r.height / 2, value: -1 };
  });
  updateSheetBlur();
}

function updateSheetBlur() {
  if (!sheetLines.length) return;
  const h = els.scroll.clientHeight;
  const st = els.scroll.scrollTop;
  for (const t of sheetLines) {
    const p = (t.mid - st) / h;
    if (p < -0.1 || p > 1.2) { if (t.value !== -1 && p < 0) { t.value = -1; t.el.style.filter = ''; } continue; }
    let b = clamp(0, (p - SHEET_BLUR.from) / (SHEET_BLUR.to - SHEET_BLUR.from), 1) * SHEET_BLUR.max;
    b = Math.round(b * 4) / 4;
    if (b !== t.value) {
      t.value = b;
      t.el.style.filter = b ? `blur(${b}px)` : '';
    }
  }
}

els.scroll.addEventListener('scroll', () => {
  if (sheetTicking) return;
  sheetTicking = true;
  requestAnimationFrame(() => {
    sheetTicking = false;
    updateSheetBlur();
    if (previewRun) { stopPreviewRun(); lessonActive = -1; } // scrolling takes the preview back
    updateLessonFocus();
  });
}, { passive: true });

/* drag the sheet by its header */
els.head.addEventListener('pointerdown', (e) => {
  if (!isSheet() || !S.dialog || closing) return;
  if (e.pointerType === 'mouse') {
    if (e.button !== 0) return;
    if (!e.target.closest('button')) e.preventDefault(); // no text selection / native drag
  }
  const now = performance.now();
  sheetDrag = { id: e.pointerId, y0: e.clientY, ly: e.clientY, lt: now, v: 0, dy: 0, moved: false, h: els.panel.offsetHeight };
});

window.addEventListener('pointermove', (e) => {
  const d = sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  const raw = e.clientY - d.y0;
  if (!d.moved) {
    if (Math.abs(raw) < 6) return;
    d.moved = true;
    els.dialog.classList.add('is-dragging');
  }
  const now = performance.now();
  d.v = 0.8 * ((e.clientY - d.ly) / Math.max(1, now - d.lt)) + 0.2 * d.v;
  d.ly = e.clientY;
  d.lt = now;
  d.dy = raw > 0 ? raw : -Math.min(40, Math.sqrt(-raw) * 4); // rubber-band upwards
  els.dialog.style.setProperty('--sheet-drag', `${d.dy.toFixed(1)}px`);
  els.dialog.style.setProperty('--sheet-dim', (1 - clamp(0, d.dy / d.h, 1)).toFixed(3));
}, { passive: true });

function endSheetDrag(e) {
  const d = sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  sheetDrag = null;
  if (!d.moved) return; // a tap: the click handlers take it from here
  suppressSheetClick = true;
  setTimeout(() => { suppressSheetClick = false; }, 80);
  els.dialog.classList.remove('is-dragging');
  const flick = e.type !== 'pointercancel' && d.dy > 24 && d.v > 0.5;
  const dismiss = d.dy > d.h * 0.25 || flick;
  if (dismiss) {
    closeLesson();
  } else {
    els.dialog.style.removeProperty('--sheet-drag'); // springs back via the CSS transition
    els.dialog.style.removeProperty('--sheet-dim');
  }
}
window.addEventListener('pointerup', endSheetDrag);
window.addEventListener('pointercancel', endSheetDrag);

els.dialog.addEventListener('close', () => {
  S.dialog = false;
  stopPreviewRun();
  els.dialog.classList.remove('is-open', 'is-dragging');
  els.dialog.style.removeProperty('--sheet-drag');
  els.dialog.style.removeProperty('--sheet-dim');
  sheetLines = [];
  root.classList.remove('is-locked');
  updateRunning();
  cards[S.index]?.focus({ preventScroll: true });
});
els.dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeLesson(); });
els.dialog.addEventListener('click', (e) => {
  if (e.target !== els.dialog && e.target !== els.scrim) return;
  // The Sign up button stays visible above the sheet; the modal sits on top
  // of it, so route taps on its spot to it.
  const r = $('cta').getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) goToSignup();
  else closeLesson();
});
els.close.addEventListener('click', closeLesson);
els.grabber.addEventListener('click', () => { if (!suppressSheetClick) closeLesson(); });
els.play.addEventListener('click', () => {
  if (suppressSheetClick) return;
  runPreview();
});
// Phones: the sheet starts just below the Beta note (its height varies with the width).
const lessonTag = els.dialog.querySelector('.lesson__tag');
function sizeLessonTag() {
  if (lessonTag) els.dialog.style.setProperty('--tag-h', `${Math.ceil(lessonTag.offsetHeight)}px`);
}
window.addEventListener('resize', () => { if (S.dialog) { sizeLessonTag(); prepareSheetBlur(); updateLessonFocus(); } });

/* ---------- sign up ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const loadedAt = performance.now();

// The letterbox next to the label (Letterbox.webm) rests on its first frame
// (the poster: closed). When a signup goes through it plays once (hops, pops
// open with a letter, flag up) and holds the last frame. Another signup plays
// it again from the start. Browsers that can't show the WebM's transparency
// (Safari), or won't play it, get the same frames as a sprite.
const MAILBOX = { src: '/assets/video/letterbox.webm', playWithin: 900 };
const mailbox = $('mailbox');
const mailboxVideo = $('mailboxVideo');
const mailboxSprite = mailbox?.querySelector('.mailbox__sprite');
const useMailboxSprite = () => mailbox?.classList.add('is-sprite');

// called after the intro (it's only needed once someone signs up)
function loadMailbox() {
  if (!mailbox || mailbox.dataset.loaded) return;
  mailbox.dataset.loaded = '1';
  if (!alphaWebmOK(mailboxVideo) || mqReduce.matches) { useMailboxSprite(); return; }
  mailboxVideo.preload = 'auto';
  mailboxVideo.src = MAILBOX.src;
  mailboxVideo.addEventListener('error', useMailboxSprite, { once: true });
}

function playMailboxSprite() {
  mailboxSprite.classList.remove('is-playing', 'is-done');
  void mailboxSprite.offsetWidth; // restart
  mailboxSprite.classList.add(mqReduce.matches ? 'is-done' : 'is-playing'); // reduced motion: straight to the open mailbox
}

function playMailbox() {
  if (!mailbox) return;
  loadMailbox();
  if (mailbox.classList.contains('is-sprite')) { playMailboxSprite(); return; }
  const v = mailboxVideo;
  const fallback = () => { v.pause(); useMailboxSprite(); playMailboxSprite(); };
  // if it hasn't started soon after asking, the sprite plays instead
  const timer = setTimeout(() => { if (v.paused || v.currentTime === 0) fallback(); }, MAILBOX.playWithin);
  v.addEventListener('playing', () => clearTimeout(timer), { once: true });
  v.currentTime = 0;
  const p = v.play();
  if (p?.catch) p.catch(() => { clearTimeout(timer); fallback(); });
}

function setMsg(kind, text) {
  els.form.classList.toggle('is-error', kind === 'error');
  els.form.classList.toggle('is-success', kind === 'success');
  els.form.classList.toggle('has-msg', Boolean(text));
  els.msg.textContent = text || '';
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (els.form.classList.contains('is-busy')) return;
  const email = els.input.value.trim();
  if (!EMAIL_RE.test(email)) {
    setMsg('error', "That email doesn't look quite right");
    els.input.focus();
    return;
  }
  els.form.classList.add('is-busy');
  setMsg(null, '');
  try {
    const res = await fetch(els.form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email,
        company: els.form.elements.company.value,
        source: els.form.elements.source.value,
        t: Math.round(performance.now() - loadedAt),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      setMsg('success', data.duplicate ? "You're already on the list" : "You're on the list. Thanks!");
      els.input.value = '';
      els.input.blur();
      playMailbox();
    } else {
      setMsg('error', data.error || 'Something went wrong. Try again in a bit');
    }
  } catch {
    setMsg('error', "Couldn't reach the server. Try again in a bit");
  } finally {
    els.form.classList.remove('is-busy');
  }
});

els.input.addEventListener('input', () => {
  if (els.form.classList.contains('has-msg')) setMsg(null, '');
});
// Keep the field sharp while typing, even if it sits in the fade/blur zone.
els.input.addEventListener('focus', () => { root.classList.add('is-typing'); updateBlur(); });
els.input.addEventListener('blur', () => { root.classList.remove('is-typing'); updateBlur(); });

// Result of a no-JS form post (the API redirects back with ?subscribed=…)
const params = new URLSearchParams(location.search);
if (params.has('subscribed')) {
  setMsg(params.get('subscribed') === '1' ? 'success' : 'error',
    params.get('subscribed') === '1' ? "You're on the list. Thanks!" : 'Something went wrong. Try again in a bit');
  history.replaceState(null, '', location.pathname + location.hash);
}

document.querySelectorAll('[data-signup]').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    goToSignup();
  });
});

document.querySelector('.brand')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeStories();
  window.scrollTo({ top: 0, behavior: smooth() });
});

// Sign up (also works while the lesson sheet is open): back to the email field.
function goToSignup() {
  const focus = () => els.input.focus({ preventScroll: true });
  if (S.dialog) {
    els.dialog.addEventListener('close', focus, { once: true }); // focus can't leave an open modal
    closeLesson();
  } else {
    focus();
  }
  if (S.mode === 'stories' && Math.abs(window.scrollY - SIGNUP.restScroll) > 1) {
    // The header is hidden in the cards view, so land at the email field
    // directly. The button is already showing in the bar, so it stays put.
    window.scrollTo(0, SIGNUP.restScroll);
    placeCta(false);
  }
  closeStories();
  window.scrollTo({ top: SIGNUP.restScroll, behavior: smooth() });
}

/* ---------- entry animation ----------
   Modelled on gustavofior.com: every element rises in with a short stagger.
   Elements on the same line share a step; anything below the fold is left
   alone. The card pile comes in last, then the background glow.
   (ENTRANCE settings and enterFrames() live at the top of this file.) */
function playEntrance() {
  if (!root.classList.contains('is-entering')) return; // reduced motion / already revealed
  const e = ENTRANCE;
  const frames = enterFrames();
  const run = (el, delay, keyframes = frames, duration = e.duration) =>
    el.animate(keyframes, { duration, delay, easing: e.easing, fill: 'backwards' });

  const vh = window.innerHeight;
  const heroVisible = S.mode !== 'stories';
  const items = heroVisible
    ? [...document.querySelectorAll('[data-enter]')]
        .map((el) => ({ el, top: el.getBoundingClientRect().top }))
        .filter((it) => it.top < vh)
        .sort((a, b) => a.top - b.top)
    : [];

  let step = -1;
  let lastTop = -Infinity;
  for (const it of items) {
    if (it.top - lastTop > 8) { step += 1; lastTop = it.top; }
    run(it.el, e.start + step * e.stagger);
  }

  const deckDelay = e.start + (step + 1) * e.stagger;
  run(els.deck, deckDelay);
  if (heroVisible) run(document.querySelector('.fx-glow'), e.start, [{ opacity: 0 }, { opacity: 1 }], 1400);

  // The animations hold their first frame during their delay, so the
  // hiding class can go now.
  root.classList.remove('is-entering');
  return deckDelay + e.duration; // ms until the last element has landed
}

/* ---------- logo ----------
   The logo is a looping clip (logo.webm, or .mp4). Until it starts, its poster
   (logo-still.png, the clip's first frame) shows, so starting the loop is
   invisible. It starts once the intro's crossfade has finished, or right away
   when there's no intro. Where video won't play, the same loop as an animated
   WebP takes over. The nav logo is the animated WebP, started at the same
   moment. Reduced motion: both stay on the first frame. */
const LOGO = {
  image: '/assets/video/logo-anim.webp',
  playWithin: 800, // ms after play() (with the clip loaded) for 'playing' before switching to the image
};
const logo = {
  el: $('logoVideo'),
  brand: $('brandMark'),
  mode: 'video',  // 'video' | 'image'
  loading: false,
  started: false,
  get off() { return !this.el || mqReduce.matches; },

  // start downloading (during the intro, once its own clip is in)
  load(mode = this.mode) {
    if (this.off || this.loading) return;
    this.loading = true;
    this.mode = mode;
    if (mode === 'image') { this.preloadImage(); return; }
    this.el.preload = 'auto';
    this.el.load();
  },

  start() {
    if (this.off || this.started) return;
    this.started = true;
    this.load();
    ilog(`logo loop starts (${this.mode})`);
    if (this.brand) this.brand.src = LOGO.image;
    if (this.mode === 'image') { this.useImage('the intro used the image version'); return; }
    const v = this.el;
    let timer = 0;
    const arm = () => {
      clearTimeout(timer);
      // only judge once the clip has data and the page is on screen
      if (document.hidden || v.readyState < 3) return;
      timer = setTimeout(() => { if (v.paused || v.readyState < 3) this.useImage("the logo video didn't start"); }, LOGO.playWithin);
    };
    let playing = false;
    v.addEventListener('playing', () => { playing = true; clearTimeout(timer); ilog('logo playing'); }, { once: true });
    v.addEventListener('canplay', arm, { once: true });
    document.addEventListener('visibilitychange', () => { if (!playing && this.mode === 'video') arm(); });
    v.addEventListener('error', () => this.useImage('logo video error'));
    [...v.querySelectorAll('source')].pop()?.addEventListener('error', () => this.useImage('no playable logo source'));
    const p = v.play();
    if (p && p.catch) p.catch((err) => this.useImage(`logo play() refused (${err.name})`));
    arm();
    this.watch();
  },

  // pause the loop while it's off screen (scrolled away, stories view, hidden tab)
  watch() {
    if (!('IntersectionObserver' in window)) return;
    let onScreen = true;
    const sync = () => {
      if (this.mode !== 'video' || !this.el.isConnected) return;
      if (onScreen && !document.hidden) this.el.play().catch(() => {});
      else this.el.pause();
    };
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(this.el.parentElement);
    document.addEventListener('visibilitychange', sync);
  },

  preloadImage() {
    if (this.backup) return this.backup;
    const img = new Image();
    img.className = 'hero__mark';
    img.alt = '';
    img.width = 163;
    img.height = 91;
    img.src = LOGO.image;
    this.backup = { img, ready: img.decode ? img.decode() : Promise.resolve() };
    this.backup.ready.catch(() => {});
    return this.backup;
  },

  // swap the video for the animated WebP. The WebP starts from its first frame
  // when it's first painted, and that frame is the poster, so the swap is seamless.
  useImage(why) {
    if (this.mode === 'image' && !this.el.isConnected) return;
    this.mode = 'image';
    ilog(`logo → image version: ${why}`);
    const { img, ready } = this.preloadImage();
    ready.then(() => {
      if (!this.el.isConnected) return;
      this.el.pause();
      this.el.replaceWith(img);
    }, () => {}); // image failed too: the poster (first frame) stays
  },
};

/* ---------- intro ----------
   Before anything else appears:
   1. The hands clip loads (nothing shows meanwhile), then plays for 2.5s in
      exactly the logo's box (same size, position, object-fit), fading in
      over 0.5s.
   2. While it plays, "Collaboration / starts with / communication" comes in
      with the entry animation, one line after another, sized so its widest
      line spans the logo's width.
   3. When the clip ends it holds its last frame. Then, all at once: the
      tagline fades, blurs and lifts away, the rest of the page runs its
      entrance, and the last frame crossfades into the logo.
   The clip is the WebM (MP4 where WebM isn't supported). If a browser won't
   actually play it, the same clip as an animated WebP takes over, so the
   intro can't silently vanish. Every step is logged to window.__intro. */
const INTRO = {
  deadline: 6000,    // ms (page visible) to get the clip playing before giving up
  playWithin: 500,   // ms after play() for 'playing' before switching to the image version
  fadeIn: 500,       // ms: clip fade-in
  clip: 2500,        // ms: length of the clip (encoded 40% faster than the original 3.5s)
  exit: 300,         // ms: tagline fade / blur / lift away (quick)
  fontWait: 300,     // ms: longest wait for the tagline's font before starting
  lift: 10,          // px it moves up on the way out
  drift: 16,         // px the tagline slowly rises while the clip plays (it keeps that pace through the exit)
  crossfadeMin: 700, // ms: shortest last-frame → logo crossfade
  image: '/assets/video/intro-anim.webp',
};
const introVideo = $('introVideo');
const introText = $('introText');
const introBox = document.querySelector('.hero__markbox');
const introWanted = root.classList.contains('is-intro') && introVideo && introText && introBox;
const introLog = (window.__intro = []);
const ilog = (msg) => introLog.push(`${Math.round(performance.now())}ms ${msg}`);

function fitIntroText() {
  const lines = [...introText.children];
  introText.style.setProperty('--intro-size', '100px');
  const widest = Math.max(...lines.map((l) => l.getBoundingClientRect().width));
  const logoW = introBox.getBoundingClientRect().width;
  if (widest > 0) introText.style.setProperty('--intro-size', `${((100 * logoW) / widest).toFixed(2)}px`);
}

// Resolves { played: true, media } once the clip has finished (last frame
// showing), or { played: false } if the intro was skipped.
function runIntro() {
  return new Promise((resolve) => {
    let done = false;
    let shown = null;      // the element actually playing (video or image)
    let fallback = false;  // switched to the animated image
    let deadlineTimer = 0;
    let playTimer = 0;

    const giveUp = (reason) => {
      if (done) return;
      done = true;
      ilog(`skipped: ${reason}`);
      console.info(`[intro] skipped: ${reason}`, introLog);
      clearTimeout(deadlineTimer);
      clearTimeout(playTimer);
      root.classList.remove('is-intro');
      introText.remove();
      introVideo.remove();
      introBox.querySelector('.hero__intro-anim')?.remove();
      logo.load();
      resolve({ played: false });
    };
    const finished = () => {
      if (done) return;
      done = true;
      ilog('clip finished');
      clearTimeout(deadlineTimer);
      resolve({ played: true, media: shown });
    };

    if (!introWanted) {
      if (introVideo) introVideo.remove();
      if (introText) introText.remove();
      root.classList.remove('is-intro');
      logo.load();
      resolve({ played: false });
      return;
    }
    ilog('start');
    if (window.scrollY > 0) window.scrollTo(0, 0);
    // size the tagline in its real font (preloaded), without waiting on the others
    Promise.race([
      document.fonts ? document.fonts.load(`${introText.style.getPropertyValue('--intro-size') || '24px'} "Cooper Lt BT"`) : Promise.resolve(),
      new Promise((r) => setTimeout(r, INTRO.fontWait)),
    ]).then(() => { if (!done) fitIntroText(); });
    fitIntroText();

    // the clip is up: fade it in, bring in the tagline, wait for the end
    const begin = (el, ms) => {
      if (done || shown) return;
      shown = el;
      clearTimeout(playTimer);
      clearTimeout(deadlineTimer);
      ilog(`playing (${el.tagName.toLowerCase()})`);
      // the clip is fully in, so the logo loop can download now (the image
      // version if this browser needed the image for the intro too)
      logo.load(el === introVideo ? 'video' : 'image');
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: INTRO.fadeIn, easing: 'ease-out', fill: 'forwards' });
      introText.classList.add('is-on');
      [...introText.children].forEach((line, i) => line.animate(enterFrames(), {
        duration: ENTRANCE.duration, delay: ENTRANCE.start + i * ENTRANCE.stagger, easing: ENTRANCE.easing, fill: 'backwards',
      }));
      // a slow, steady rise for the whole clip (INTRO.drift px), carried on at
      // the same speed through the exit so the text never stops before it leaves.
      // `translate` stacks on the block's centring transform and the lines' own motion.
      const driftMs = ms + INTRO.exit;
      introText.animate(
        [{ translate: '0 0' }, { translate: `0 ${(-INTRO.drift * driftMs / ms).toFixed(2)}px` }],
        { duration: driftMs, easing: 'linear', fill: 'forwards' },
      );
      if (el === introVideo) {
        const safety = setTimeout(finished, ms + 400); // normally 'ended' fires first
        introVideo.addEventListener('ended', () => { clearTimeout(safety); finished(); }, { once: true });
      } else {
        setTimeout(finished, ms); // the image plays once and holds its last frame
      }
    };

    // fallback: the same clip as an animated WebP (plays once, holds the last frame)
    let backup = null;
    const preloadImage = () => {
      if (backup) return backup;
      const img = new Image();
      img.className = 'hero__intro-video hero__intro-anim';
      img.alt = '';
      img.src = INTRO.image;
      backup = { img, ready: img.decode ? img.decode() : Promise.resolve() };
      backup.ready.catch(() => {});
      return backup;
    };
    const useImage = (why) => {
      if (done || shown || fallback) return;
      fallback = true;
      ilog(`switching to the image version: ${why}`);
      clearTimeout(playTimer);
      introVideo.pause();
      introVideo.remove();
      const { img, ready } = preloadImage();
      ready.then(() => {
        if (done) return;
        introBox.append(img);
        requestAnimationFrame(() => begin(img, INTRO.clip)); // the animation starts when it's first painted
      }, () => giveUp('image version failed to load'));
    };

    // video: play only once it's fully loaded and the page is on screen
    const fullyLoaded = () => {
      const b = introVideo.buffered;
      return introVideo.readyState >= 4 || (b.length && introVideo.duration && b.end(b.length - 1) >= introVideo.duration - 0.05);
    };
    let asked = false;
    const tryPlay = () => {
      if (done || shown || fallback || document.hidden || !fullyLoaded()) return;
      if (asked) return;
      asked = true;
      ilog('fully loaded: play()');
      preloadImage(); // backup, so switching to it (if needed) is instant
      introVideo.currentTime = 0;
      playTimer = setTimeout(() => useImage("the video didn't start"), INTRO.playWithin);
      const p = introVideo.play();
      if (p && p.catch) p.catch((err) => { ilog(`play() refused: ${err.name}`); useImage(`play() refused (${err.name})`); });
    };
    introVideo.addEventListener('playing', () => begin(introVideo, (introVideo.duration || 3.5) * 1000), { once: true });
    ['loadeddata', 'canplay', 'canplaythrough', 'progress'].forEach((t) => introVideo.addEventListener(t, tryPlay));
    const sources = [...introVideo.querySelectorAll('source')];
    sources[sources.length - 1]?.addEventListener('error', () => useImage('no playable video source'));
    introVideo.addEventListener('error', () => useImage(`video error ${introVideo.error && introVideo.error.code}`));

    // give up only if nothing is playing after `deadline` ms of the page being visible
    const armDeadline = () => {
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => {
        if (done || shown) return;
        if (document.hidden) return; // re-armed when visible
        giveUp('nothing started playing in time');
      }, INTRO.deadline);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || done || shown) return;
      ilog('page visible');
      armDeadline();
      if (asked && !shown && !fallback) { asked = false; clearTimeout(playTimer); }
      tryPlay();
    });
    if (document.hidden) ilog('page hidden: waiting until it is visible');
    armDeadline();
    tryPlay();
  });
}

// At the end of the clip: tagline out + page entrance + last frame → logo,
// all starting together. The logo holds its first frame (lined up with the
// clip's last frame, see .hero__intro-video) for the crossfade, then loops.
const introHero = {
  get mark() { return document.querySelector('.hero__mark'); },
  outro(media, entranceMs) {
    const d = Math.max(INTRO.crossfadeMin, entranceMs || 0);
    const ease = 'cubic-bezier(0.45, 0, 0.55, 1)';
    const mark = this.mark;
    mark.style.opacity = '0';
    root.classList.remove('is-intro');
    // tagline out
    introText.classList.add('is-leaving');
    const out = [...introText.children].map((l) => l.animate(
      [{ opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
       { opacity: 0, transform: `translateY(${-INTRO.lift}px)`, filter: `blur(${ENTRANCE.blur}px)` }],
      { duration: INTRO.exit, easing: 'cubic-bezier(0.4, 0, 0.8, 0.4)', fill: 'forwards' },
    ));
    Promise.all(out.map((a) => a.finished)).then(() => introText.remove(), () => introText.remove());
    // last frame → logo (first frame), then the logo starts looping
    mark.style.opacity = '';
    mark.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d, easing: ease });
    media.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d, easing: ease, fill: 'forwards' })
      .finished.then(() => { media.remove(); logo.start(); }, () => logo.start());
  },
};

/* ---------- boot ---------- */
M = metrics();
placeSignup(true);
els.deck.classList.add('is-instant');
layout();
checkScroll();
updateGlow();
requestAnimationFrame(() => els.deck.classList.remove('is-instant'));

// The intro starts straight away (it only needs the logo box and its own
// font). Meanwhile, wait briefly for web fonts so the page's lines are
// measured in the final font. If a font lands later, re-split so line breaks
// stay right.
const introDone = runIntro();
const pageReady = Promise.race([
  document.fonts ? document.fonts.ready : Promise.resolve(),
  new Promise((resolve) => setTimeout(resolve, 450)),
]).then(() => {
  placeSignup(true);
  M = metrics();
  layout();
  prepareBlur(true);
  checkScroll();
});
// then, together: tagline out, page entrance, and the clip's last frame
// crossfading into the logo
Promise.all([introDone, pageReady]).then(([r]) => requestAnimationFrame(() => {
  loadGlow();
  loadMailbox();
  const ms = playEntrance();
  if (r.played) introHero.outro(r.media, ms);
  else logo.start(); // no intro: the logo loops straight away
  // scrolling unlocks once the last element has landed (boot.js locks it)
  const until = r.played ? Math.max(INTRO.crossfadeMin, ms || 0) : ms || 0;
  setTimeout(() => {
    root.classList.remove('is-loading');
    ilog('scrolling unlocked');
  }, until);
}));
document.fonts?.addEventListener('loadingdone', () => { placeSignup(true); M = metrics(); layout(); prepareBlur(true); });
