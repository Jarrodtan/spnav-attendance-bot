// Paste into Apps Script (Code.gs), then Deploy → Manage deployments → Edit → New version.
// Set the secret once: Project Settings → Script Properties → add SHEET_SECRET (same value as the Worker secret).

const SHEET_NAME = 'Sheet1'; // change to your tab name

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse(e.postData.contents);

    const secret = PropertiesService.getScriptProperties().getProperty('SHEET_SECRET');
    if (!secret || data.secret !== secret) return json({ success: false, error: 'unauthorized' });

    lock.waitLock(10000);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return json({ success: false, error: 'sheet not found: ' + SHEET_NAME });

    if (data.action === 'sync') return json(syncAll(sheet, data.members));

    const userId = String(data.userId);
    const allData = sheet.getDataRange().getValues();

    let existingRow = -1;
    let maxSn = 0;
    for (let i = 1; i < allData.length; i++) { // skip header
      if (String(allData[i][5]) === userId) existingRow = i + 1; // Column F
      const sn = Number(allData[i][0]);
      if (sn > maxSn) maxSn = sn;
    }

    if (data.action === 'delete') {
      if (existingRow !== -1) {
        sheet.deleteRow(existingRow);
        // Renumber S/N so it stays 1, 2, 3...
        const remaining = sheet.getLastRow() - 1;
        if (remaining > 0) {
          sheet.getRange(2, 1, remaining, 1)
            .setValues(Array.from({ length: remaining }, (_, i) => [i + 1]));
        }
      }
      return json({ success: true });
    }

    if (existingRow !== -1) {
      // UPDATE columns B–E
      sheet.getRange(existingRow, 2, 1, 4)
        .setValues([[data.name, data.telegram, data.username, data.group]]);
    } else {
      // INSERT new row
      sheet.appendRow([maxSn + 1, data.name, data.telegram, data.username, data.group, userId, new Date()]);
      sheet.getRange(sheet.getLastRow(), 7).setNumberFormat('d mmmm yyyy');
      sheet.getRange(sheet.getLastRow(), 6).setNumberFormat('@'); // keep User ID as text
    }

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// Rewrite all rows to match the bot. Keeps Display Name, Username and Date Joined for existing members.
function syncAll(sheet, members) {
  const old = {};
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 7).getValues().forEach(r => { old[String(r[5])] = r; });
  }

  const rows = members.map((m, i) => {
    const prev = old[String(m.userId)];
    return [
      i + 1,
      m.name,
      prev ? prev[2] : '-',
      prev ? prev[3] : '-',
      m.group,
      String(m.userId),
      prev && prev[6] ? prev[6] : new Date()
    ];
  });
  // Oldest members first
  rows.sort((a, b) => new Date(a[6]) - new Date(b[6]));
  rows.forEach((r, i) => { r[0] = i + 1; });

  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  if (rows.length) {
    sheet.getRange(2, 6, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
    sheet.getRange(2, 7, rows.length, 1).setNumberFormat('d mmmm yyyy');
  }
  return { success: true, count: rows.length };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
