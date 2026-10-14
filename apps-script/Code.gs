// Paste into Apps Script (Code.gs), then Deploy → Manage deployments → Edit → New version.
// Set the secret once: Project Settings → Script Properties → add SHEET_SECRET (same value as the Worker secret).

const SHEET_NAME = 'Database'; // change to your tab name

// Column order. If the sheet's header row is different (e.g. an older layout),
// the script moves every column into this order automatically, matching by header name.
const HEADERS = [
  'S/N',                        // A
  'Name (Registered with bot)', // B
  'Team',                       // C
  'Ministry Group',             // D
  'Telegram Username',          // E
  'Telegram Display Name',      // F
  'Date Joined',                // G
  'User ID'                     // H
];
const COL = { sn: 1, name: 2, team: 3, group: 4, username: 5, telegram: 6, joined: 7, userId: 8 };
const COLS = HEADERS.length;

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse(e.postData.contents);

    const secret = PropertiesService.getScriptProperties().getProperty('SHEET_SECRET');
    if (!secret || data.secret !== secret) return json({ success: false, error: 'unauthorized' });

    lock.waitLock(10000);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return json({ success: false, error: 'sheet not found: ' + SHEET_NAME });

    ensureLayout(sheet);

    if (data.action === 'sync') return json(syncAll(sheet, data.members));

    const userId = String(data.userId);
    const allData = sheet.getDataRange().getValues();

    let existingRow = -1;
    let maxSn = 0;
    for (let i = 1; i < allData.length; i++) { // skip header
      if (String(allData[i][COL.userId - 1]) === userId) existingRow = i + 1;
      const sn = Number(allData[i][COL.sn - 1]);
      if (sn > maxSn) maxSn = sn;
    }

    if (data.action === 'delete') {
      if (existingRow !== -1) {
        sheet.deleteRow(existingRow);
        renumber(sheet);
      }
      return json({ success: true });
    }

    if (existingRow !== -1) {
      // UPDATE name, team, group, username, display name (B–F)
      sheet.getRange(existingRow, COL.name, 1, 5)
        .setValues([[data.name, data.team || '', data.group, data.username, data.telegram]]);
    } else {
      // INSERT new row
      sheet.appendRow([maxSn + 1, data.name, data.team || '', data.group, data.username, data.telegram, new Date(), userId]);
      const row = sheet.getLastRow();
      sheet.getRange(row, COL.userId).setNumberFormat('@'); // keep User ID as text
      sheet.getRange(row, COL.joined).setNumberFormat('d mmmm yyyy');
    }

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// Make sure row 1 is HEADERS. If not, move existing data into the new column order by header name.
function ensureLayout(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), COLS);
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  if (HEADERS.every((h, i) => header[i] === h)) return;

  const lastRow = sheet.getLastRow();
  const oldRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const from = HEADERS.map(h => header.indexOf(h)); // -1 = column didn't exist before
  const rows = oldRows.map(r => from.map(i => (i === -1 ? '' : r[i])));

  sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).clearContent();
  sheet.getRange(1, 1, 1, COLS).setValues([HEADERS]).setFontWeight('bold');
  if (rows.length) {
    sheet.getRange(2, COL.userId, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, rows.length, COLS).setValues(rows);
    sheet.getRange(2, COL.joined, rows.length, 1).setNumberFormat('d mmmm yyyy');
  }
}

// Keep S/N as 1, 2, 3...
function renumber(sheet) {
  const remaining = sheet.getLastRow() - 1;
  if (remaining > 0) {
    sheet.getRange(2, COL.sn, remaining, 1)
      .setValues(Array.from({ length: remaining }, (_, i) => [i + 1]));
  }
}

// Rewrite all rows to match the bot. Keeps Display Name, Username and Date Joined for existing members.
function syncAll(sheet, members) {
  const old = {};
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, COLS).getValues().forEach(r => { old[String(r[COL.userId - 1])] = r; });
  }

  const rows = members.map(m => {
    const prev = old[String(m.userId)];
    return [
      0, // S/N, filled below
      m.name,
      m.team || (prev ? prev[COL.team - 1] : ''),
      m.group,
      prev ? prev[COL.username - 1] : '-',
      prev ? prev[COL.telegram - 1] : '-',
      prev && prev[COL.joined - 1] ? prev[COL.joined - 1] : new Date(),
      String(m.userId)
    ];
  });
  // Oldest members first
  rows.sort((a, b) => new Date(a[COL.joined - 1]) - new Date(b[COL.joined - 1]));
  rows.forEach((r, i) => { r[0] = i + 1; });

  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, COLS).clearContent();
  if (rows.length) {
    sheet.getRange(2, COL.userId, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, rows.length, COLS).setValues(rows);
    sheet.getRange(2, COL.joined, rows.length, 1).setNumberFormat('d mmmm yyyy');
  }
  return { success: true, count: rows.length };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
