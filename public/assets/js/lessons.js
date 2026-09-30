// Lesson content. Edit this file to change cards, captions and the detail modal.
//
// media   – video filling the card (peek pile + stories viewer). It's square and
//           deliberately bigger than the card: shown at MEDIA_SIZE × the card's
//           height, centred, so the card crops most of it. text = height of the
//           text block in the middle of the video, as a share of the video's
//           height (used to cut it off at the screen edge while the card peeks).
//           Without media, `card` is shown instead.
// card    – markup shown on the card when there's no video
// demo    – markup shown in the modal's white preview. It has one state per
//           section (styles.css, .slide.s1 … .s4): as you scroll, the section in
//           focus lights up and the preview transforms into its state. The play
//           button runs through all the states.
// sections – modal body. `body` items are HTML strings (you write them, so
//           they're trusted). Use <span class="inline-logo"></span> where a
//           small inline logo should sit; swap it for an <img> when ready.

export const STORY_MS = 5000; // time each card is shown in the stories viewer
export const MEDIA_SIZE = 1.15; // card videos: size relative to the card's height (so they overhang and get cropped)

const media = (name, text) => ({
  webm: `/assets/video/card-${name}.webm`,
  mp4: `/assets/video/card-${name}.mp4`,
  poster: `/assets/img/card-${name}-poster.webp`,
  text,
});

// Section titles from the Figma modal (frame 14:261), with Lorem Ipsum as
// placeholder text until the real lessons are written.
const SECTION_TITLES = [
  "What's your key idea?",
  'Finding the connective tissue',
  'Putting the focus',
  'Shifting the focus',
  'Visual experimentation',
];

const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet.',
  'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur. Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.',
  'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus.',
];

// two Lorem Ipsum paragraphs per section, varied so the sections don't all look the same
const placeholderSections = () =>
  SECTION_TITLES.map((title, i) => ({ title, body: [LOREM[i % LOREM.length], LOREM[(i + 3) % LOREM.length]] }));

const bullets = (n = 4) =>
  `<ul class="v-bullets">${'<li>Bullet point</li>'.repeat(n)}</ul>`;

export const LESSONS = [
  // Stories order. "Say one thing" (Focus) comes first and is the front card
  // in the pile; Rules is last.
  {
    id: 'focus',
    title: 'Focus',
    caption: 'Putting the focus on one thing',
    media: media('focus', 0.064),   // Frame 45: "Say one thing"
    card: `<span class="v-focus"><span>Say</span> <em>one</em> <span>thing</span></span>`,
    demo: `<div class="demo demo--focus"><span class="v-focus"><span>Say</span> <em>one</em> <span>thing</span></span></div>`,
    sections: placeholderSections(),
  },
  {
    id: 'bullets',
    title: 'Bullet points',
    caption: 'Finding the connective tissue',
    media: media('bullets', 0.233), // Frame 42: first / second / third point
    card: bullets(4),
    demo: `<div class="demo demo--bullets">${bullets(4)}</div>`,
    sections: placeholderSections(),
  },
  {
    id: 'rules',
    title: 'Rules',
    caption: 'Introducing a key idea and following it up',
    media: media('rules', 0.064),   // Frame 43: "Key idea… and follow-up!"
    card: `<span class="v-rules">Rules</span>`,
    demo: `
      <div class="demo demo--rules">
        <span class="v-rules">Rules</span>
        <ul class="demo__follow"><li>Bullet point</li><li>Bullet point</li><li>Bullet point</li></ul>
      </div>`,
    sections: placeholderSections(),
  },
];

// Where each card rests in the peeking pile at the bottom of the viewport.
// Cards already have their final (stories) size here, so going from the pile
// to the stories view only moves them. While a card peeks, its content sits
// just above the bottom edge of the screen, which cuts it off: only its top
// part shows, a teaser rather than something to read. When the cards open,
// the content glides into the middle of the card.
// cx: centre offset from the middle of the screen; show: how much of the card
// sticks up above the bottom edge (px); rot: tilt in degrees;
// reveal (optional): share of the content's height that shows above the
// bottom edge (default PEEK.reveal).
// Order = LESSONS order (Focus, Bullets, Rules). "Say one thing" (Focus) is
// the front card; Rules sits behind it.
export const PEEK = {
  mobile: [
    { cx: 36, show: 104, rot: 2, z: 3 },                  // Focus (front)
    { cx: -110, show: 150, rot: -4, z: 2, reveal: 0.4 },  // Bullets (left): first line and a bit of the second
    { cx: 120, show: 80, rot: 3, z: 1 },                  // Rules (tucked behind)
  ],
  desktop: [
    { cx: 0, show: 110, rot: 2, z: 3 },                    // Focus (centre, front)
    { cx: -330, show: 118, rot: -3, z: 2, reveal: 0.4 },   // Bullets (left)
    { cx: 330, show: 104, rot: -1.5, z: 1 },               // Rules (right)
  ],
  reveal: 0.6, // a one-line title shows its top ~60%, cut off by the screen edge
};
