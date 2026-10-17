/**
 * =========================================================================
 * ASYNCHRONOUS WEBHOOK DISPATCHER & CALLBACK RECEIVER (CLEANING REPORT)
 * =========================================================================
 * Triggered on Google Form submission. Sets an execution lock ID, shares
 * uploaded photos publicly for processing, dispatches the payload to an
 * n8n webhook, and exposes a doPost Web App endpoint for n8n callback.
 */

const WEBHOOK_CONFIG = {
  N8N_WEBHOOK_URL: 'https://your-n8n-instance.com/webhook/cleaning-report-webhook',
  SHEET_NAME: 'Form Responses 1',
  STATUS_COL: 'Status Laporan',
  LOCK_COL: 'Execution Lock ID',
  PDF_COL: 'Link PDF',
  CALLBACK_SECRET: 'YOUR_SECURE_CALLBACK_SECRET'
};

function onFormSubmit(e) {
  try {
    if (!e || !e.range) {
      throw new Error('Event object is invalid or not available.');
    }

    const sheet = e.range.getSheet();
    if (sheet.getName() !== WEBHOOK_CONFIG.SHEET_NAME) return;

    const rowNumber = e.range.getRow();
    if (rowNumber < 2) return;

    const lastColumn = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];

    const data = {};
    headers.forEach((header, i) => {
      data[String(header)] = normalizeFieldValue(values[i]);
    });

    makeImagesPubliclyReadable(data);

    const statusColIndex = findColIndex(headers, WEBHOOK_CONFIG.STATUS_COL);
    const lockColIndex = findColIndex(headers, WEBHOOK_CONFIG.LOCK_COL);
    const pdfColIndex = findColIndex(headers, WEBHOOK_CONFIG.PDF_COL);

    if (!statusColIndex || !lockColIndex || !pdfColIndex) {
      throw new Error('Required status/lock/pdf headers are missing.');
    }

    const currentStatus = String(sheet.getRange(rowNumber, statusColIndex).getValue() || '').trim().toUpperCase();
    const currentLock = String(sheet.getRange(rowNumber, lockColIndex).getValue() || '').trim();
    const currentPdf = String(sheet.getRange(rowNumber, pdfColIndex).getValue() || '').trim();

    if (currentStatus === 'PROCESSING' || currentStatus === 'DONE' || currentLock || currentPdf) {
      Logger.log(`Row ${rowNumber} skipped. Status=${currentStatus}, Lock=${currentLock}`);
      return;
    }

    const lockId = `LOCK-${Date.now()}-${rowNumber}`;
    sheet.getRange(rowNumber, statusColIndex).setValue('PROCESSING');
    sheet.getRange(rowNumber, lockColIndex).setValue(lockId);
    SpreadsheetApp.flush();

    const payload = {
      rowNumber: rowNumber,
      sheetName: sheet.getName(),
      spreadsheetId: sheet.getParent().getId(),
      executionLockId: lockId,
      callbackSecret: WEBHOOK_CONFIG.CALLBACK_SECRET,
      data: data
    };

    const response = UrlFetchApp.fetch(WEBHOOK_CONFIG.N8N_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      sheet.getRange(rowNumber, statusColIndex).setValue('ERROR');
      sheet.getRange(rowNumber, lockColIndex).setValue('');
      throw new Error(`Webhook failed with HTTP ${code}: ${response.getContentText()}`);
    }

    Logger.log(`Webhook successfully triggered for row ${rowNumber}.`);
  } catch (error) {
    Logger.log('ERROR onFormSubmit: ' + error.message);
    throw error;
  }
}

/**
 * Web App Callback endpoint invoked by n8n upon report completion
 */
function doPost(e) {
  try {
    const bodyText = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const payload = JSON.parse(bodyText);

    if (String(payload.callbackSecret || '').trim() !== WEBHOOK_CONFIG.CALLBACK_SECRET) {
      throw new Error('Unauthorized: Callback secret mismatch.');
    }

    const ss = SpreadsheetApp.openById(payload.spreadsheetId);
    const sheet = ss.getSheetByName(payload.sheetName || WEBHOOK_CONFIG.SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const statusCol = findColIndex(headers, WEBHOOK_CONFIG.STATUS_COL);
    const lockCol = findColIndex(headers, WEBHOOK_CONFIG.LOCK_COL);
    const pdfCol = findColIndex(headers, WEBHOOK_CONFIG.PDF_COL);

    const row = Number(payload.rowNumber);
    const sheetLock = String(sheet.getRange(row, lockCol).getValue() || '').trim();

    if (sheetLock !== String(payload.executionLockId).trim()) {
      throw new Error('Lock ID mismatch.');
    }

    if (payload.status === 'DONE') {
      if (payload.pdfUrl) sheet.getRange(row, pdfCol).setValue(payload.pdfUrl);
      sheet.getRange(row, statusCol).setValue('DONE');
      sheet.getRange(row, lockCol).setValue('');
    } else {
      sheet.getRange(row, statusCol).setValue('ERROR');
      sheet.getRange(row, lockCol).setValue('');
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function normalizeFieldValue(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return val;
}

function findColIndex(headers, colName) {
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === String(colName).trim()) return i + 1;
  }
  return 0;
}

function makeImagesPubliclyReadable(data) {
  const fields = ['BFlink1', 'BFlink2', 'Slink1', 'Slink2', 'Alink1', 'Alink2'];
  for (let f of fields) {
    const val = data[f];
    if (!val) continue;
    const match = String(val).match(/[-\w]{25,}/);
    if (!match) continue;
    try {
      const file = DriveApp.getFileById(match[0]);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (_) {}
  }
}
