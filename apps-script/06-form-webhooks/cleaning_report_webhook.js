/**
 * ==============================================================================
 * CLEANING MAINTENANCE REPORT DISPATCHER & ASYNCHRONOUS CALLBACK RECEIVER
 * ==============================================================================
 * 1. onFormSubmit(e): Triggered upon Google Form submission. Captures Before/During/After
 *    station photos, sets execution lock ID, makes photos publicly readable, and
 *    dispatches payload to n8n webhook.
 * 2. doPost(e): Web App callback endpoint invoked by n8n upon PDF generation.
 *    Validates callback secret, writes back PDF URL, ensures idempotency, and
 *    trashes temporary Google Docs files.
 * ==============================================================================
 */

const WEBHOOK_CONFIG = {
  N8N_WEBHOOK_URL: 'https://your-n8n-instance.example.com/webhook/cleaning-report-webhook',
  SHEET_NAME: 'Form Responses 1',
  STATUS_COL: 'Status Laporan',
  LOCK_COL: 'Execution Lock ID',
  PDF_COL: 'Link PDF',
  CALLBACK_SECRET: 'YOUR_SECURE_CALLBACK_SECRET',
};

function onFormSubmit(e) {
  try {
    if (!e || !e.range) {
      throw new Error('Event onFormSubmit tidak tersedia atau dijalankan tanpa parameter range.');
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
      data[String(header)] = normalizeValue_(values[i]);
    });

    // Buka akses foto agar dapat diunduh oleh pipeline n8n
    makeUploadedImagesPublic_(data);

    const statusColIndex = findColumnIndex_(headers, WEBHOOK_CONFIG.STATUS_COL);
    const lockColIndex = findColumnIndex_(headers, WEBHOOK_CONFIG.LOCK_COL);
    const pdfColIndex = findColumnIndex_(headers, WEBHOOK_CONFIG.PDF_COL);

    if (!statusColIndex) throw new Error(`Kolom "${WEBHOOK_CONFIG.STATUS_COL}" tidak ditemukan.`);
    if (!lockColIndex) throw new Error(`Kolom "${WEBHOOK_CONFIG.LOCK_COL}" tidak ditemukan.`);
    if (!pdfColIndex) throw new Error(`Kolom "${WEBHOOK_CONFIG.PDF_COL}" tidak ditemukan.`);

    // In-memory read dari array values untuk performa tinggi
    const currentStatus = String(values[statusColIndex - 1] || '').trim().toUpperCase();
    const currentLock = String(values[lockColIndex - 1] || '').trim();
    const currentPdf = String(values[pdfColIndex - 1] || '').trim();

    if (currentStatus === 'PROCESSING' || currentStatus === 'DONE' || currentLock || currentPdf) {
      Logger.log(`Row ${rowNumber} dilewati. Status=${currentStatus}, Lock=${currentLock}, PDF=${currentPdf}`);
      return;
    }

    const lockId = 'LOCK-' + new Date().getTime() + '-' + rowNumber;

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

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode < 200 || responseCode >= 300) {
      sheet.getRange(rowNumber, statusColIndex).setValue(`FAILED (HTTP ${responseCode})`);
      sheet.getRange(rowNumber, lockColIndex).setValue('');
      SpreadsheetApp.flush();
      throw new Error(`Webhook n8n gagal. HTTP ${responseCode}. Body: ${responseBody}`);
    }

    Logger.log(`Webhook sukses untuk row ${rowNumber}. Response: ${responseBody}`);
  } catch (error) {
    Logger.log('ERROR onFormSubmit: ' + error.message);
    throw error;
  }
}

/**
 * Endpoint Web App callback dari n8n setelah PDF selesai dibuat
 */
function doPost(e) {
  try {
    const bodyText = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const payload = JSON.parse(bodyText);

    const result = processN8nCallback_(payload);

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('ERROR doPost: ' + error.message);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function processN8nCallback_(payload) {
  const secret = String(payload.callbackSecret || '').trim();
  if (secret !== WEBHOOK_CONFIG.CALLBACK_SECRET) {
    throw new Error('Callback secret tidak valid.');
  }

  const spreadsheetId = String(payload.spreadsheetId || '').trim();
  const sheetName = String(payload.sheetName || WEBHOOK_CONFIG.SHEET_NAME).trim();
  const rowNumber = Number(payload.rowNumber || 0);
  const executionLockId = String(payload.executionLockId || '').trim();
  const pdfUrl = String(payload.pdfUrl || payload.pdfLink || '').trim();
  const generatedDocId = String(payload.generatedDocId || '').trim();
  const statusFromN8n = String(payload.status || '').trim().toUpperCase();
  const message = String(payload.message || '').trim();

  if (!spreadsheetId) throw new Error('spreadsheetId wajib diisi.');
  if (!sheetName) throw new Error('sheetName wajib diisi.');
  if (!rowNumber || rowNumber < 2) throw new Error('rowNumber tidak valid.');
  if (!executionLockId) throw new Error('executionLockId wajib diisi.');

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  const statusColIndex = findColumnIndex_(headers, WEBHOOK_CONFIG.STATUS_COL);
  const lockColIndex = findColumnIndex_(headers, WEBHOOK_CONFIG.LOCK_COL);
  const pdfColIndex = findColumnIndex_(headers, WEBHOOK_CONFIG.PDF_COL);

  if (!statusColIndex) throw new Error(`Kolom "${WEBHOOK_CONFIG.STATUS_COL}" tidak ditemukan.`);
  if (!lockColIndex) throw new Error(`Kolom "${WEBHOOK_CONFIG.LOCK_COL}" tidak ditemukan.`);
  if (!pdfColIndex) throw new Error(`Kolom "${WEBHOOK_CONFIG.PDF_COL}" tidak ditemukan.`);

  const currentStatusInSheet = String(sheet.getRange(rowNumber, statusColIndex).getValue() || '').trim().toUpperCase();
  const sheetLockId = String(sheet.getRange(rowNumber, lockColIndex).getValue() || '').trim();

  // IDEMPOTENSI: Jika n8n mengirim ulang callback padahal sudah berstatus DONE
  if (currentStatusInSheet === 'DONE') {
    return {
      success: true,
      status: 'DONE',
      message: `Row ${rowNumber} sudah berstatus DONE sebelumnya (idempotent).`
    };
  }

  if (sheetLockId !== executionLockId) {
    throw new Error(`Lock ID tidak cocok. Sheet="${sheetLockId}", Callback="${executionLockId}"`);
  }

  if (statusFromN8n === 'DONE') {
    if (pdfUrl) {
      sheet.getRange(rowNumber, pdfColIndex).setValue(pdfUrl);
    }
    sheet.getRange(rowNumber, statusColIndex).setValue('DONE');
    sheet.getRange(rowNumber, lockColIndex).setValue('');
    SpreadsheetApp.flush();

    let deleteInfo = {
      attempted: false,
      deleted: false,
      generatedDocId: generatedDocId || ''
    };

    if (generatedDocId) {
      deleteInfo = safeTrashFile_(generatedDocId);
    }

    Logger.log(`Callback DONE row ${rowNumber}. PDF=${pdfUrl}. DeleteInfo=${JSON.stringify(deleteInfo)}`);

    return {
      success: true,
      status: 'DONE',
      rowNumber: rowNumber,
      pdfUrl: pdfUrl,
      deleteInfo: deleteInfo
    };
  }

  // Jika n8n melaporkan error
  sheet.getRange(rowNumber, statusColIndex).setValue(message ? ('ERROR - ' + message) : 'ERROR');
  sheet.getRange(rowNumber, lockColIndex).setValue('');
  SpreadsheetApp.flush();

  Logger.log(`Callback ERROR row ${rowNumber}. Message=${message}`);

  return {
    success: true,
    status: 'ERROR',
    rowNumber: rowNumber,
    message: message
  };
}

function safeTrashFile_(fileId) {
  try {
    if (!fileId) {
      return { attempted: false, deleted: false, reason: 'fileId kosong' };
    }

    const file = DriveApp.getFileById(fileId);
    const fileName = file.getName();
    file.setTrashed(true);

    return { attempted: true, deleted: true, fileId: fileId, fileName: fileName };
  } catch (err) {
    Logger.log(`Gagal hapus file ${fileId}: ${err.message}`);
    return { attempted: true, deleted: false, fileId: fileId, error: err.message };
  }
}

function normalizeValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'M/d/yyyy H:mm:ss');
  }
  return value;
}

function findColumnIndex_(headers, columnName) {
  const target = String(columnName || '').trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim().toLowerCase() === target) {
      return i + 1;
    }
  }
  return 0;
}

function extractFileIds_(urlText) {
  if (!urlText) return [];
  const matches = String(urlText).match(/[-\w]{25,}/g);
  return matches || [];
}

function makeUploadedImagesPublic_(data) {
  const imageFields = [
    'BFlink1', 'BFlink2', 'BFlink3', 'BFlink4', 'BFlink5',
    'Slink1', 'Slink2', 'Slink3', 'Slink4', 'Slink5',
    'Alink1', 'Alink2', 'Alink3', 'Alink4', 'Alink5'
  ];

  imageFields.forEach(field => {
    const fileIds = extractFileIds_(data[field]);
    if (!fileIds.length) return;

    fileIds.forEach(fileId => {
      try {
        const file = DriveApp.getFileById(fileId);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (err) {
        Logger.log(`Gagal ubah permission file ${field} (${fileId}): ${err.message}`);
      }
    });
  });
}

function createFormSubmitTrigger() {
  const ss = SpreadsheetApp.getActive();
  const triggers = ScriptApp.getProjectTriggers();

  const exists = triggers.some(trigger =>
    trigger.getHandlerFunction() === 'onFormSubmit' &&
    trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT
  );

  if (exists) {
    Logger.log('Trigger onFormSubmit sudah ada.');
    return;
  }

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  Logger.log('Trigger onFormSubmit berhasil dibuat.');
}

function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  Logger.log('Semua trigger berhasil dihapus.');
}

function test_onFormSubmit() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WEBHOOK_CONFIG.SHEET_NAME);
  const rowNumber = sheet.getLastRow();
  if (rowNumber < 2) {
    Logger.log('Belum ada baris data respon.');
    return;
  }
  const range = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn());
  onFormSubmit({ range: range });
}
