/**
 * GrowWWW — add-on for your EXISTING website lead Apps Script.
 * Writes form leads into their own tabs in the same Google Sheet:
 *   Algo / Development / Automation / Marketing / General Leads, plus "Callback Requests"
 *   (people who left the form but asked for a call back).
 * When a visitor adds optional details later, their existing row is updated (matched by Lead ID).
 * Your website enquiry tab is not touched.
 *
 * HOW TO INSTALL (2 minutes) — or to UPDATE, replace the whole GrowthLeads file with this one:
 *  1. Open your existing Apps Script (the one whose /exec URL is in Supabase as GOOGLE_SHEET_WEBHOOK_URL).
 *  2. Click  +  → Script → name it  GrowthLeads  → paste this whole file.
 *  3. Set GROWTH_SECRET below to the SAME secret your website script already uses
 *     (the value of GOOGLE_SHEET_SECRET in Supabase).
 *  4. In your existing doPost(e) function, add this as the VERY FIRST line inside it:
 *
 *        var growth = handleGrowthLead_(e); if (growth) return growth;
 *
 *  5. Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy.
 *     (Keep the same deployment so the /exec URL does not change.)
 */

var GROWTH_SECRET = 'PASTE-THE-SAME-SECRET-HERE';
var GROWTH_STATUSES = ['New', 'Contacted', 'Call scheduled', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];
var GROWTH_TABS = {
  'Algo Leads': '#d9b45a', 'Development Leads': '#4f7cff', 'Automation Leads': '#3ecf8e',
  'Marketing Leads': '#ff7a59', 'General Leads': '#a7a299', 'Callback Requests': '#e94b7a',
  'Corporate Leads': '#1f1f22'
};

/** Returns a response for form leads, or null so your website handler runs as before. */
function handleGrowthLead_(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return null; }
  if (!d || !d.sheet_tab) return null;                       // not a form lead → website handler
  if (!GROWTH_TABS[d.sheet_tab]) return growthOut_({ ok: false, error: 'unknown tab' });
  if (!d.secret || d.secret !== GROWTH_SECRET) return growthOut_({ ok: false, error: 'unauthorised' });

  var row = d.row || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = growthTab_(d.sheet_tab, Object.keys(row));
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    // add any new columns at the end (keeps old rows aligned)
    Object.keys(row).forEach(function (k) {
      if (headers.indexOf(k) === -1) { headers.push(k); sh.getRange(1, headers.length).setValue(k); }
    });
    var first = String(row['Name'] || '').split(/\s+/)[0].replace(/"/g, '') || 'lead';

    var targetRow = 0;
    if (d.update_lead_id) {
      var idCol = headers.indexOf('Lead ID') + 1;
      if (idCol && sh.getLastRow() > 1) {
        var found = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).createTextFinder(String(d.update_lead_id)).matchEntireCell(true).findNext();
        if (found) targetRow = found.getRow();
      }
    }

    if (targetRow) {
      // update only the cells we were given
      Object.keys(row).forEach(function (k) {
        sh.getRange(targetRow, headers.indexOf(k) + 1).setValue(growthCell_(k, row[k], first));
      });
    } else {
      sh.appendRow(headers.map(function (h) { return growthCell_(h, row[h], first); }));
      targetRow = sh.getLastRow();
    }
    var score = Number(row['Score']);
    var pCol = headers.indexOf('Priority') + 1;
    if (pCol && !isNaN(score)) sh.getRange(targetRow, pCol)
      .setBackground(score >= 60 ? '#fde2e1' : score >= 35 ? '#fff4d6' : '#eef2f7').setFontWeight('bold');
  } finally {
    lock.releaseLock();
  }
  return growthOut_({ ok: true, tab: d.sheet_tab });
}

function growthCell_(header, v, first) {
  if (v === undefined || v === null) return '';
  if (header === 'WhatsApp Follow-up') {
    return /^https:\/\/wa\.me\//.test(v) ? '=HYPERLINK("' + String(v).replace(/"/g, '""') + '","💬 WhatsApp ' + first + '")' : '';
  }
  if (typeof v === 'number') return v;
  var s = String(v).slice(0, 2000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;                  // stops formula injection
}

function growthTab_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#0a0a0b').setFontColor('#d9b45a').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(3);
    sh.setRowHeight(1, 34);
    sh.setTabColor(GROWTH_TABS[name]);
    sh.setColumnWidths(1, headers.length, 150);
    var pain = headers.indexOf('Problem (in their words)') + 1;
    if (pain) sh.setColumnWidth(pain, 320).getRange(2, pain, 2000, 1).setWrap(true);
    var st = headers.indexOf('Status') + 1;
    if (st) sh.getRange(2, st, 2000, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(GROWTH_STATUSES, true).build());
  }
  return sh;
}

function growthOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
