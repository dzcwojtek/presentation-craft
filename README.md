# Presentation Craft

The landing page for Presentation Craft, built from the Figma file *Presentation Lessons*: the mobile frames plus a first desktop layout. It's plain HTML, CSS and JS with no build step and no dependencies. A small serverless function collects email signups.

```
public/                   ← the website (this is what gets served)
  index.html
  404.html
  assets/css/styles.css
  assets/js/main.js       ← interactions
  assets/js/lessons.js    ← card + modal content (edit this)
  assets/img/…            ← assets exported from Figma
api/                      ← Vercel functions  (POST /api/subscribe, GET /api/export)
netlify/functions/        ← same endpoints for Netlify
lib/subscribe-core.js     ← shared signup logic (validation, spam checks, destinations)
integrations/google-sheets/Code.gs ← Apps Script that writes signups to a Google Sheet
scripts/dev.mjs           ← local preview server
tests/                    ← `npm test`
```

## What's on the page

0. **Intro.** Before anything else appears:
   1. The hands clip (`assets/video/intro.webm`, or the `.mp4` where WebM isn't supported) loads with nothing on screen. It then plays for 2.5s (40% faster than the original 3.5s) in exactly the logo's box (same size, position and `object-fit: cover`), fading in over 0.5s.
   2. While it plays, "Collaboration / starts with / communication" comes in with the entry animation, one line after another. It's sized so its widest line spans the logo's width (about 23.5px on phones, 28px on desktop). While the clip plays, the whole tagline rises slowly and steadily by 16px (`INTRO.drift`). It keeps that pace through its exit, so it never stops before it leaves.
   3. When the clip ends it holds its last frame. Then, all at once, the tagline quickly fades, blurs and lifts away (300ms), the rest of the page runs its entrance, and the last frame crossfades into the logo's first frame. The logo holds that frame for the crossfade, then starts looping. The logo has no entry animation of its own.
   - **Lining up the switch:** the hands in the logo loop are 3% smaller than in the clip's last frame, and sit slightly left and lower. So the clip is scaled and nudged (`transform` on `.hero__intro-video` in `styles.css`) to land exactly on the logo. The offset was measured by matching the edges of the two frames, then checked in the rendered page. The logo box clips the clip's extra 1.5% so both end at the same edges.
   - **Fallback:** if a browser won't actually play the video (autoplay blocked, a power-saving pause, a codec problem), the same clip as an animated WebP (`intro-anim.webp`, plays once) takes over within 0.5s. It starts downloading alongside the video, so the switch is instant and the intro doesn't silently disappear.
   - **Start-up:** the intro starts straight away. It waits only for its own font (up to 0.3s), not for every web font, so the black wait before the clip is about 0.2–0.8s.
   - **Hidden pages:** if the page loads in a hidden tab or pane, the intro waits until it's visible.
   - **Skipped** only with reduced motion, for `#hash` deep links, or if nothing has started playing 6s after the page is visible.
   - **Debugging:** `window.__intro` logs every step, and the console explains any skip. Tune it with `INTRO` in `main.js`.
   - **Files:** the clip files are a 640×360 re-encode of your 1280×720 original (0.25MB WebM, 0.27MB MP4, 0.37MB animated WebP fallback), all re-timed to 2.5s. The 4MB bottom-glow video only starts loading after the intro.
   - **Every load starts at the top**, so the intro is always seen.
   - **No scrolling until everything's in:** wheel, touch and keyboard scrolling are blocked from the first paint (`boot.js`) until the intro and the entry animation have finished, about 4s. It blocks input rather than hiding the scrollbar, so nothing shifts when it unlocks. Deep links (`#…`) and reduced motion skip the intro, so they're never locked.
0. **Logo.** The logo is your duotone loop (`assets/video/logo.webm`, unchanged, or `logo.mp4` where WebM isn't supported). Its poster, `assets/img/logo-still.png`, is the loop's first frame, so nothing changes visibly when the loop starts.
   - **When it plays:** the loop only downloads once the intro clip is in, so it doesn't slow the intro down. It starts after the intro's crossfade, or straight away when there's no intro. It pauses while it's off screen.
   - **Fallback:** if the browser won't play it, the same loop as an animated WebP (`logo-anim.webp`, loops forever) takes over from the same first frame.
   - **Nav:** the nav logo uses that animated WebP too, and starts at the same moment.
   - **Reduced motion:** both logos stay on the first frame, and the loop isn't downloaded.
   - **Files:** 0.31MB WebM, 0.10MB MP4, 0.15MB animated WebP, 8KB still. The old `logo-hands.png` isn't used anymore.
   - **After updating files, restart `npm run dev`.** The dev server reads its own settings (file types, security headers) only when it starts.
0. **Entry animation.** On load, everything above the fold fades in, rises 12px and un-blurs from 12px to 0, one element after another from top to bottom, with the card pile last. It's modelled on gustavofior.com. Elements on the same line (like "Hello!" and Sign up) animate together. Tune the timing in `ENTRANCE` in `main.js`. `boot.js` hides those elements before the first paint so nothing flashes; if the main script fails, it reveals them after 7s.
1. **Header**: two paragraphs (32px with a 56px line height on desktop). On desktop the header text, the nav bar (logo to Sign up) and the email field share one 660px column (`--col` in `styles.css`). The bottom 30% of the viewport fades the content out and blurs it progressively, from 0px at 70% of the viewport height to 8px at the bottom edge. The paragraphs are split into their rendered lines, and each line (plus the logo, the "Hello!" row and the email field) gets one even blur based on its position on screen. That means no half-sharp words. The effect is tied to the viewport, so text sharpens as it scrolls up. Tune it with `BLUR` in `main.js`.
2. **Email field** under the text. At the last scroll position before the cards switch to the stories view, it sits exactly in the middle of the gap between paragraph 2 and the cards. The gap is worked out per screen height (`SIGNUP` in `main.js`), and Sign up scrolls straight to that position. On desktop the field is 30% larger than on phones (field, text, label and button) and as wide as the text column.
   - **Animated background**: `assets/video/bottom-glow.webm` (your BottomAnimationV4, unchanged) plays in Chrome, Firefox and Edge. Safari and iOS can't show a WebM's transparency, so they get `bottom-glow.mp4`, the same animation flattened onto black and blended with `screen` (it looks the same on the black page, and it's 0.4MB instead of 4MB). `bottom-glow-poster.webp` shows until the video starts. The video pauses whenever it's hidden (in the stories view, in a background tab, or with reduced motion turned on).
   - The email field posts to `/api/subscribe`, and still works with JavaScript off (the server redirects back with `?subscribed=1`).
   - **Sending:** while a signup is on its way, the arrow button gives way to a white pixel spinner: two arrows chasing each other round a stepped ring (an inline 16×16 SVG in `index.html`, `.signup__spinner`). It turns 90° every 0.3s in sudden jumps, with no easing. It's drawn 1px per pixel on phones and 1.5px on desktop, so it stays crisp.
   - **Letterbox:** your `Letterbox.webm` (168×174, 12fps, transparent) sits to the right of the field's label.
     - **At rest:** it shows its first frame (the poster `letterbox-first.webp`), a closed mailbox with the flag down, standing on the field.
     - **On signup:** when a signup goes through (including "already on the list"), it plays once. It hops, pops open with a letter and the flag up, then holds that last frame. Another signup plays it again.
     - **Safari:** Safari can't show a WebM's transparency, so Safari (and any browser that won't play the video) gets the same 7 frames from `letterbox-sprite.webp`, stepped at 12fps. It looks identical.
     - **On errors:** while an error message shows, it fades out so the message has the full width.
     - **Reduced motion:** it goes straight to the open mailbox.
     - **Loading:** the video only loads after the intro. On desktop it's 30% larger, like the rest of the field.
3. **Nav bar**: 64px tall (`--nav-h` in `styles.css`) and pinned to the top of the page. There's only one Sign up button: it sits beside "Hello!", scrolls with the page, then sticks in the bar (a zero-height `position: sticky` rail, `.cta-rail`). The moment it docks, the nav logo fades in and un-blurs (blur 12→0, with no movement), and it plays in reverse when you scroll back up. It uses the same `ENTRANCE` timing as the entry animation.
4. **Cards** stay fixed at the bottom in a pile. They're already their final (stories) size, so opening the stories view only moves them and never reshapes them. While they peek, each card's content sits just above the bottom edge of the screen, so it's cut off: a teaser, not something to read. A title shows its top ~60%, and the bullets their first line and a bit of the second. Tune it with `reveal` in `PEEK`. When the cards open, the content glides into the middle of the card. Pile positions are in `PEEK` in `lessons.js`; "Say one thing" is the front card and the first story; Rules is last.
   - **Pull to open**: once the email field passes 80% of the screen height, a "Swipe down for examples" label fades in (entry animation, Inter 14px, 50% opacity). The page ends at the email field's resting spot, so ordinary scrolling and flings stop there. Opening the cards is a separate pull that has to start from that spot: drag up on touch, or start a new wheel/trackpad gesture. The header follows with an iOS-style rubber band, the cards rise with it and the label brightens to 100%. Pull 40% of the screen height (or flick) to open; otherwise it springs back. In the cards view, pull down, scroll up or press ↑/Esc to go back. The cards and caption follow the pull; the progress bars stay put. Keyboard users can press ↓ at the email field to open. Tune it with `PULL` in `main.js`. The page's scroll is locked while the cards are open.
   - **Desktop** (900px and wider) has no separate pull; it's ordinary scrolling (`PULL.desktop`).
     - **Scrolling in:** the page keeps scrolling past the email field into a short extra zone, 35% of the screen height. The cards rise with the scroll and the label brightens.
     - **Opening:** the cards open the moment you've scrolled 18% of the screen height past the email field. It follows your wheel or trackpad, momentum included, and a gentle continuous scroll from the top of the page carries straight into the cards.
     - **Stopping short:** if you stop before that point for about 0.4s, the page glides back to the email field. Slow mouse-wheel notches still add up.
     - **Going back:** scroll up in the cards to return. You land back at the email field, and the rest of that scroll is absorbed. Scrolling the other way counts as a new gesture straight away.
     - **The label:** it reads **"See examples below"** and is a button. Clicking it (or Tab + Enter, or ↓ at the email field) scrolls the page on into the cards the same way, and keyboard focus moves to the current card.
     - On phones it stays a plain "Swipe down for examples" label with the deliberate pull.
   - **Card videos:** each card is filled by its video: Frame 45 for "Say one thing", Frame 42 for the bullet points and Frame 43 for "Key idea… and follow-up!" (the Rules card). They're square and deliberately bigger than the card. Each is shown at 1.15× the card's height, centred, and the card's rounded corners crop the rest (`MEDIA_SIZE` in `lessons.js`).
     - **Playback:** in the cards view only the middle card plays, from the start each time it comes round, looping. It pauses when you press and hold, open the lesson, or switch tabs.
     - **Grey in the pile:** the videos are greyed out while the cards sit at the bottom. Their colour fades in as the cards open into the sliding section, over the same 0.9s as the cards' move, and drains out again when they go back.
     - **Loading:** in the pile, and with reduced motion, the cards show a first-frame poster (`card-*-poster.webp`). The videos only download when the cards view opens: the current card plus the next one.
     - **Formats:** your HQ WebMs (1126×1126, 60fps) play where supported, with an H.264 MP4 fallback made from them for browsers without WebM (older iPhones).
     - **Pile teaser:** while a card peeks, its video is lifted so the text in the middle is cut off by the screen edge. `media.text` in `lessons.js` is that text block's share of the video's height.
   - The stories layout follows Figma 99:780: 21px side margins, 48px corners, progress bars 7px narrower than the card on each side, and 53px from the card to the caption. Tune it with `STORY`.
   - **Centring:** on desktop the card sits exactly in the middle of the screen, sized so the progress bars and caption still fit (up to 640px tall). On phones it fills the height as in Figma, and centres only when there's height to spare.
   - **Follow-through:** on the arrows, the arrow keys, auto-advance and clicking a side card, the cards move together but not quite in lockstep. The one furthest ahead in the direction of travel sets off first, and the others follow within about 105ms (`STAGGER.spread`). Clicking › starts the left card, the centre about 50ms later and the right card at about 105ms, so their motion overlaps. These stepped moves run 30% faster than a drag release (`STEP.speed`: the same spring and bounce on a 0.7× timeline), so the last card settles about 0.55s after a click. The card that loops round to the other side waits off screen and comes in alongside the last card, so it never lands on a card that hasn't moved yet. Each card has its own spring for this. Dragging moves all the cards exactly together under your finger.
   - **Nav bar in the cards view:** the cards view always shows the full nav bar. If you open it from higher up the page (e.g. by clicking a card in the pile), the Sign up button glides up into the bar while the logo fades in, as if you'd scrolled there. It glides back when the cards close. Sign up from inside the cards closes them and lands you on the email field.
   - **Closing on desktop:** a **×** in the top-right corner, level with the nav bar, closes the cards. It fades in like the nav logo. Scrolling up, ↑ and Esc still work too.
   - 5s per card with progress bars; it loops
   - swipe or drag sideways, use the arrow keys or a trackpad, or on desktop the ‹ › buttons. Swiping runs on a spring simulation (`SPRING` in `main.js`): the card follows your finger 1:1, keeps its momentum when you let go, can be caught mid-flight, and lands with a soft overshoot. A held card eases to a steady 96% ("picked up"). While it moves fast, cards shrink a little more, stretch along the direction of travel and flare their leading edge (`BUBBLE`), then settle back to full size with a slight wobble. Cards are drawn once per frame from a smoothed velocity with a small dead zone, so uneven touch events and finger jitter don't make them flicker. Cards also turn slightly in 3D as they leave and enter (`DEPTH`), and they're only blurred near the screen edge: 8px while 40px or less of a card is on screen, sharpening as more of it comes in, and sharp from 180px visible (`CARD_BLUR`)
   - press and hold to pause
   - tap or click the card to open the lesson. On phones it's a **bottom sheet** (Figma 99:808): drag the handle or preview down to close it (past 25% of its height, or with a flick), tap the handle, or tap above the sheet. Its bottom 15% fades the text out and blurs each line progressively (`SHEET_BLUR`). On desktop it's the centred dialog with a ✕ button. Esc closes either one. The sheet is `#1e1e1e` with a 0.5px border, and the Sign up button stays visible and tappable above it.
   - **Inside a lesson** (the sheet on phones, the dialog on desktop), the preview stays pinned at the top while the sections scroll underneath.
     - **Focus:** the section crossing a line just below the preview lights up, and the others are dimmed.
     - **Preview:** it transforms into that section's state, and scrolling back up reverses it. For example, the bullet points light up one by one while a line is drawn through them, "one" wins over "Say … thing", and the follow-ups appear under the key idea.
     - **Play button:** it runs through all the states, then returns to the section in focus.
     - **Proof-of-concept tag:** while a lesson is open, a yellow tag in the top-left corner of the page reads "This part is still just a proof-of-concept… stay tuned for the actual content!" (`.lesson__tag` in `index.html`). On phones it takes the nav logo's spot, clear of Sign up. On desktop the dialog starts below a nav-height band, so the tag never overlaps it.
     - **Settings and text:** tune the focus line and play speed with `LESSON_FOCUS` in `main.js`, and the states in `styles.css` (`.slide.s1` … `.s4`). The section text is Lorem Ipsum placeholder copy (`LOREM` in `lessons.js`).
   - scroll back up to return to the pile
   - the caption under each card uses the entry animation (fade, 12px rise, blur 12→0) when the viewer opens and on every card change; the outgoing caption fades and blurs out first

Reduced-motion users get instant transitions and no autoplay.

## Run it locally

Needs Node 18 or newer.

```bash
npm run dev          # http://localhost:3000
npm test             # tests for the signup logic
```

If you haven't set any destinations in `.env`, local signups are saved to `.data/subscribers.csv`, and you can view them at <http://localhost:3000/api/export?token=dev>.

## Deploy on Vercel (recommended)

1. Push this folder to a GitHub repo, then open **vercel.com → Add New → Project** and import the repo. The defaults are fine: `vercel.json` already sets the output folder to `public` and there's no build command.
   *No Git?* Run `npx vercel` in this folder, then `npx vercel --prod`.
2. Pick where emails go (see below) and add the environment variables under **Project → Settings → Environment Variables**. Then **redeploy**, because environment variables only apply to new deployments.
3. Add your domain under **Project → Settings → Domains** and follow the DNS instructions (an A record or a CNAME at your registrar).
4. Replace `https://example.com` in the `og:image` tag in `public/index.html` with your domain.

## Deploy on Netlify

Connect the repo on Netlify, or run `npx netlify deploy --prod`. `netlify.toml` sets `publish = "public"`, and the functions answer at the same `/api/*` paths. Netlify's drag-and-drop deploy **skips functions**, so use Git or the CLI.

## Where the emails go

Set **one or both** of these. If both are set, every signup goes to both.

### Option A: Google Sheet (easiest to read and share)

1. Create a Google Sheet, then open **Extensions → Apps Script** and paste in `integrations/google-sheets/Code.gs`.
2. Go to **Project Settings → Script properties** and add `SECRET` with a long random value.
3. Go to **Deploy → New deployment → Web app**. Set *Execute as: Me* and *Who has access: Anyone*, then copy the `/exec` URL.
4. Add these environment variables:
   - `SHEETS_WEBHOOK_URL` = the `/exec` URL
   - `SHEETS_WEBHOOK_SECRET` = the same secret

Signups show up in a **Subscribers** tab with the timestamp, email, source, country, referrer and user agent. Duplicates are skipped.

### Option B: Vercel storage (Upstash Redis)

1. In Vercel, open **Storage → Create → Upstash for Redis** (free tier) and connect it to the project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
2. Add `EXPORT_TOKEN` (any long random string).
3. Download the list whenever you like:
   ```bash
   curl -H "Authorization: Bearer $EXPORT_TOKEN" https://your-domain/api/export -o subscribers.csv
   ```

With Redis set up, you also get a per-IP rate limit of 8 attempts an hour.

### Optional: forward to a newsletter tool

Set `WEBHOOK_URL` to a Zapier, Make or n8n webhook, and every signup is POSTed there as JSON. You can use that to add people to Mailchimp, Buttondown, Brevo and so on.

## Spam protection

- A hidden honeypot field
- A minimum time between page load and submit
- A same-origin check (add extra allowed origins with `ALLOWED_ORIGINS`)
- Rate limiting, if Redis is configured

Bots get a fake "ok" and nothing is stored.

## Editing content

- **Header text**: `public/index.html`. The second paragraph is still the Figma placeholder ("(2nd text)").
- **Cards, captions and modal text**: `public/assets/js/lessons.js`. All three lessons use the Figma section titles with Lorem Ipsum placeholder text. For inline logos in the text, use `<span class="inline-logo">` (a grey square) and swap it for an `<img>` tag.
- **Card positions in the pile**: the `PEEK` values in `lessons.js`. The mobile numbers come straight from Figma.
- **Time per story**: `STORY_MS` in `lessons.js`.

## Fonts

- **Inter** and **Geist Mono** load from Google Fonts.
- **Cooper Lt BT Light** (the serif) is self-hosted from `public/assets/fonts/CooperLtBT-Light.woff2`, converted from the TTF you supplied. It's a commercial Bitstream font, so make sure your licence covers web use before the site goes public.

Under GDPR, you may prefer to self-host the Google fonts: download them from [google-webfonts-helper](https://gwfh.mranftl.com/fonts) into `public/assets/fonts/` and swap out the `<link>` tag.

## Security headers

`vercel.json`, `netlify.toml` and the dev server all send the same CSP (`script-src 'self'`, with Google Fonts allowed). `style-src` also allows `'unsafe-inline'`, because the animated wave (`assets/img/wave.svg`) keeps its animation in an inline `<style>` and Firefox may block that otherwise. Users with reduced motion turned on get `wave-static.svg`. Scripts must stay in external files, and any new third-party script or stylesheet needs its host added to the CSP.
