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
 */

const SHEET_NAME = 'Subscribers';
const HEADERS = ['Timestamp', 'Email', 'Source', 'Country', 'Referrer', 'User agent'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || data.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    const email = String(data.email || '').trim().toLowerCase();
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
    return json_({ ok: true, duplicate: false });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Visiting the /exec URL in a browser just confirms it's alive.
function doGet() {
  return json_({ ok: true, service: 'presentation-craft-signups' });
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
