/**
 * Presentation Craft → Google Sheet
 *
 * Receives signups from /api/subscribe and appends them to a "Subscribers" tab.
 *
 * Setup (5 minutes):
 *  1. Create a Google Sheet. Extensions → Apps Script. Replace Code.gs with this file.
 *  2. Project Settings (gear) → Script properties → Add property:
 *       SECRET = <a long random string>   (same value as SHEETS_WEBHOOK_SECRET)
 *  3. Deploy → New deployment → type "Web app"
 *       Execute as: Me   ·   Who has access: Anyone
 *     Authorise, then copy the Web app URL (ends in /exec).
 *  4. In Vercel/Netlify, set env vars:
 *       SHEETS_WEBHOOK_URL    = that /exec URL
 *       SHEETS_WEBHOOK_SECRET = the SECRET from step 2
 *  5. Redeploy the site. Changing this script later? Deploy → Manage deployments →
 *     edit → Version: New version (the URL stays the same).
 *
 * Welcome email: every new signup (not repeats) gets a thank-you email, sent
 * from your Gmail as "Presentation Craft" (see WELCOME below). To switch it on:
 *  a. Run testWelcomeEmail once from the editor (pick it in the function menu
 *     above the code, click Run). Google asks for permission to send email as
 *     you; allow it. You'll get a test copy.
 *     Optional: Script properties → SITE_URL = https://your-domain, so the test
 *     copy shows the site's images (real signups use the site's address anyway).
 *  b. Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy.
 *  Free Gmail accounts can send about 100 of these a day.
 */

const SHEET_NAME = 'Subscribers';

// Welcome email sent to each new signup
const WELCOME = {
  send: true, // false = no emails
  fromName: 'Presentation Craft',
  subject: "You're on the list – Presentation Craft",
  talkUrl: 'https://www.youtube.com/watch?v=8B5JbsnauLg',
};
const HEADERS = ['Timestamp', 'Email', 'Source', 'Country', 'Referrer', 'User agent'];

function doPost(e) {
  let data;
  let email;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || data.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    email = String(data.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) return json_({ ok: false, error: 'invalid email' });

    const sheet = sheet_();
    const last = sheet.getLastRow();
    if (last > 1) {
      const hit = sheet.getRange(2, 2, last - 1, 1).createTextFinder(email).matchEntireCell(true).findNext();
      if (hit) return json_({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      data.createdAt ? new Date(data.createdAt) : new Date(),
      safe_(email),
      safe_(data.source),
      safe_(data.country),
      safe_(data.referer),
      safe_(data.userAgent),
    ]);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }

  // Saved. Now the welcome email; if it fails, the signup still counts.
  let emailed = false;
  try {
    emailed = sendWelcome_(email, siteUrl_(data.site));
  } catch (err) {
    console.error('Welcome email to ' + email + ' failed: ' + (err && err.message || err));
  }
  return json_({ ok: true, duplicate: false, emailed: emailed });
}

// Visiting the /exec URL in a browser just confirms it's alive.
function doGet() {
  return json_({ ok: true, service: 'presentation-craft-signups' });
}

// Run this once from the editor: it asks for permission to send email and
// sends a test copy to you.
function testWelcomeEmail() {
  const me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  sendWelcome_(me, siteUrl_(''), true);
  console.log('Test welcome email sent to ' + me);
}

function sendWelcome_(email, site, force) {
  if (!WELCOME.send && !force) return false;
  const mail = welcomeEmail_(site);
  MailApp.sendEmail({
    to: email,
    subject: WELCOME.subject,
    htmlBody: mail.html,
    body: mail.text,
    name: WELCOME.fromName,
  });
  return true;
}

// The site's address: the SITE_URL script property if set, otherwise the one
// the site sends along with each signup.
function siteUrl_(fromSite) {
  const v = PropertiesService.getScriptProperties().getProperty('SITE_URL') || fromSite || '';
  const clean = String(v).trim().replace(/\/+$/, '');
  return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(clean) ? clean : '';
}

// Styled like the site: black, the logo + wordmark, a serif headline (Cooper
// where available, Georgia otherwise), grey body text and a pill button.
// Images load from the live site, so they need its address.
function welcomeEmail_(site) {
  const sans = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const serif = "'Cooper Lt BT', Georgia, 'Times New Roman', serif";
  const host = site ? site.replace(/^https?:\/\//, '') : '';
  const talk = WELCOME.talkUrl;
  const p = 'margin:0 0 16px;font-family:' + sans + ';font-size:17px;line-height:1.5;color:#cccccc;';

  const brand = site
    ? '<img src="' + site + '/assets/img/logo-still.png" width="120" height="68" alt="" style="display:block;margin:0 auto 14px;border:0;">' +
      '<img src="' + site + '/assets/img/wordmark.png" width="164" height="16" alt="Presentation Craft" style="display:block;margin:0 auto;border:0;">'
    : '<div style="font-family:' + serif + ';font-size:24px;color:#ffffff;">Presentation Craft</div>';
  const mailbox = site
    ? '<img src="' + site + '/assets/img/letterbox-open.png" width="72" height="75" alt="" style="display:block;margin:0 0 28px;border:0;">'
    : '';
  const footerSite = site ? ' at <a href="' + site + '" style="color:#9a9a9a;">' + host + '</a>' : '';

  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">' +
    '<title>You\'re on the list</title></head>' +
    '<body style="margin:0;padding:0;background:#000000;">' +
    // preview line shown next to the subject in the inbox
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Thanks for signing up – updates are on their way.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000;">' +
    '<tr><td align="center" style="padding:48px 16px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">' +
    '<tr><td align="center" style="padding:0 0 36px;">' + brand + '</td></tr>' +
    '<tr><td bgcolor="#161616" style="background:#161616;border:1px solid #262626;border-radius:32px;padding:40px 32px;">' +
    mailbox +
    '<h1 style="margin:0 0 20px;font-family:' + serif + ';font-weight:400;font-size:28px;line-height:1.2;color:#ffffff;">Thanks for signing up!</h1>' +
    '<p style="' + p + '">You\'re on the list for Presentation Craft – a working library of small interactive lessons on how to build decks people actually want to watch, and not just put on the side while doom-scrolling.</p>' +
    '<p style="' + p + 'margin-bottom:24px;">It\'s still in the works, so sit tight: I\'ll send you an update as soon as there\'s something new to see. Meanwhile, here\'s a taste:</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td bgcolor="#262626" style="background:#262626;border-radius:12px;">' +
    '<a href="' + talk + '" style="display:inline-block;padding:12px 18px;font-family:' + sans + ';font-size:16px;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:12px;">See my talk on making talks&nbsp;&rarr;</a>' +
    '</td></tr></table>' +
    '<p style="' + p + 'margin:32px 0 0;">– Wojtek</p>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:28px 12px 0;font-family:' + sans + ';font-size:13px;line-height:1.5;color:#7a7a7a;">' +
    'You\'re getting this because you signed up' + footerSite + '. Not you? Just reply and I\'ll take you off the list.' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  const text = [
    'Thanks for signing up!',
    '',
    "You're on the list for Presentation Craft – a working library of small interactive lessons on how to build decks people actually want to watch, and not just put on the side while doom-scrolling.",
    '',
    "It's still in the works, so sit tight: I'll send you an update as soon as there's something new to see. Meanwhile, here's a taste:",
    '',
    'See my talk on making talks: ' + talk,
    '',
    '– Wojtek',
    '',
    "You're getting this because you signed up" + (host ? ' at ' + host : '') + ". Not you? Just reply and I'll take you off the list.",
  ].join('\n');

  return { html: html, text: text };
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

// Stops values like "=IMPORTXML(...)" from being treated as formulas.
function safe_(value) {
  const s = value == null ? '' : String(value).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
