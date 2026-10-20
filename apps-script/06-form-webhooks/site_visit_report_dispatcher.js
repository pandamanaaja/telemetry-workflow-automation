/**
 * ==============================================================================
 * SITE VISIT INSPECTION REPORT DISPATCHER (AUTOCRAT ENGINE REPLACEMENT)
 * ==============================================================================
 * Dispatches Google Form/Sheet responses to an n8n webhook workflow.
 * Gathers tabular metrics and 5-photo arrays per category, invokes the
 * Google Docs batchUpdate builder, converts the output to a PDF blob,
 * archives it to Google Drive, and logs processing status back to the sheet.
 * ==============================================================================
 */

const CONFIG = {
  N8N_WEBHOOK_URL: 'https://your-n8n-instance.example.com/webhook/autocrat-site-report',
  TEMPLATE_DOC_ID: 'YOUR_TEMPLATE_DOC_ID',
  OUTPUT_DOC_FOLDER_ID: 'YOUR_OUTPUT_DOC_FOLDER_ID',
  OUTPUT_PDF_FOLDER_ID: 'YOUR_OUTPUT_PDF_FOLDER_ID',

  DEFAULT_REPORT_PREFIX: 'Laporan Visit',
  DELETE_DOC_AFTER_PDF_CREATED: true,
  DELETE_UPLOADED_IMAGES_AFTER_SUCCESS: true,

  // Fallback candidate lebar gambar untuk rendering Docs
  THUMBNAIL_WIDTH_CANDIDATES: [900, 800, 700, 600, 500],
};

const TEXT_PLACEHOLDER_MAP = {
  'Lokasi Site': '<<Lokasi Site>>',
  'Tanggal Kunjungan': '<<Tanggal Kunjungan>>',
  'Nama Teknisi': '<<Nama Teknisi>>',
  'Keterangan Kunjungan': '<<Keterangan Kunjungan>>',
  'Deskripsi Pekerjaan': '<<Deskripsi Pekerjaan>>',

  'Kondisi Bangunan Shelter': '<<Kondisi Bangunan Shelter>>',
  'Kondisi Pagar': '<<Kondisi Pagar>>',
  'Kondisi Pondasi Shelter': '<<Kondisi Pondasi Shelter>>',
  'Kondisi Pos Security': '<<Kondisi Pos Security>>',

  'Forward': '<<Forward>>',
  'Reflected': '<<Reflected>>',
  'Kondisi Headend & NMS': '<<Kondisi Head>>',
  'Kondisi TV Monitoring': '<<Kondisi TV>>',
  'Kondisi Switch Frame Antena & Dehidrator': '<<Switchframe>>',
  'Kondisi Feeder,Tray Feeder & Claim Feeder': '<<Feeder>>',
  'Kondisi Tower,Lampu Tower Dan Panel Antena': '<<Kondisi Lampu Tower>>',

  'Kondisi MCB Incoming PLN & ATS': '<<MCB>>',
  'Voltage R-S': '<<VR-S>>',
  'Voltage S-T': '<<VS-T>>',
  'Voltage T-R': '<<VT-R>>',
  'Ampere R-S': '<<AR-S>>',
  'Ampere S-T': '<<AS-T>>',
  'Ampere T-R': '<<AT-R>>',

  'Input Voltage R-S': '<<UPSR-S>>',
  'Input Voltage S-T': '<<UPSS-T>>',
  'Input Voltage T-R': '<<UPST-R>>',

  'Output Voltage R-S': '<<OutUPSR-S>>',
  'Output Voltage S-T': '<<OutUPSS-T>>',
  'Output Voltage T-R': '<<OutUPST-R>>',

  'Output Current R-S': '<<OutAUPSR-S>>',
  'Output Current S-T': '<<OutAUPSS-T>>',
  'Output Current T-R': '<<OutAUPST-R>>',

  'Battery Voltage': '<<BatV>>',
  'Frekuensi': '<<Frek>>',
  'Stock Solar': '<<Solar>>',
  'Tegangan Accu': '<<Accu>>',

  'Kondisi Panel Lampu & Panel AC': '<<Kondisi Panel Lampu>>',
  'Kondisi AC Ruang TX & AC Ruang Panel': '<<AC TX>>',
  'Kondisi Lampu Ruangan': '<<Kondisi Lampu Ruang>>',
  'Kondisi Lampu Taman': '<<Lampu Taman>>',
  'Kondisi Grounding': '<<Grounding>>',
};

const IMAGE_PLACEHOLDER_MAP = {
  'Dokumentasi Bangunan Shelter': ['<<Bangunlink1>>', '<<Bangunlink2>>', '<<Bangunlink3>>', '<<Bangunlink4>>', '<<Bangunlink5>>'],
  'Dokumentasi Pagar': ['<<Bangunpagar1>>', '<<Bangunpagar2>>', '<<Bangunpagar3>>', '<<Bangunpagar4>>', '<<Bangunpagar5>>'],
  'Dokumentasi Pondasi Shelter': ['<<Pondasi1>>', '<<Pondasi2>>', '<<Pondasi3>>', '<<Pondasi4>>', '<<Pondasi5>>'],
  'Dokumentasi Pos security': ['<<Pos1>>', '<<Pos2>>', '<<Pos3>>', '<<Pos4>>', '<<Pos5>>'],

  'Dokumentasi Transmitter': ['<<TX1>>', '<<TX2>>', '<<TX3>>', '<<TX4>>', '<<TX5>>'],
  'Dokumentasi Headend & NMS': ['<<Head1>>', '<<Head2>>', '<<Head3>>', '<<Head4>>', '<<Head5>>'],
  'Dokumentasi TV Monitoring': ['<<TV1>>', '<<TV2>>', '<<TV3>>', '<<TV4>>', '<<TV5>>'],
  'Switch Frame Antena & Dehidrator': ['<<SF1>>', '<<SF2>>', '<<SF3>>', '<<SF4>>', '<<SF5>>'],
  'Feeder,Tray Feeder & Claim Feeder': ['<<Feed1>>', '<<Feed2>>', '<<Feed3>>', '<<Feed4>>', '<<Feed5>>'],
  'Tower,Lampu Tower Dan Panel Antena': ['<<Ltower1>>', '<<Ltower2>>', '<<Ltower3>>', '<<Ltower4>>', '<<Ltower5>>'],

  'Dokumentasi MCB Incoming PLN & ATS': ['<<MCB1>>', '<<MCB2>>', '<<MCB3>>', '<<MCB4>>', '<<MCB5>>'],
  'Dokumentasi Panel Utama / MDB': ['<<PU1>>', '<<PU2>>', '<<PU3>>', '<<PU4>>', '<<PU5>>'],
  'Dokumentasi UPS / AVR': ['<<UPS1>>', '<<UPS2>>', '<<UPS3>>', '<<UPS4>>', '<<UPS5>>'],
  'Panel Lampu & Panel AC': ['<<PLA1>>', '<<PLA2>>', '<<PLA3>>', '<<PLA4>>', '<<PLA5>>'],
  'AC Ruang TX & AC Ruang Panel': ['<<ACTX1>>', '<<ACTX2>>', '<<ACTX3>>', '<<ACTX4>>', '<<ACTX5>>'],
  'Genset,Accu & Solar': ['<<Genset1>>', '<<Genset2>>', '<<Genset3>>', '<<Genset4>>', '<<Genset5>>'],
  'Lampu Ruangan': ['<<Lruang1>>', '<<Lruang2>>', '<<Lruang3>>', '<<Lruang4>>', '<<Lruang5>>'],
  'Lampu Taman': ['<<LT1>>', '<<LT2>>', '<<LT3>>', '<<LT4>>', '<<LT5>>'],
  'Grounding': ['<<GR1>>', '<<GR2>>', '<<GR3>>', '<<GR4>>', '<<GR5>>'],
};

/**
 * Trigger utama: Dipicu saat responden mengirimkan Google Form
 */
function onFormSubmit(e) {
  let uploadedImageFileIds = [];
  let createdDocId = '';
  let createdDocUrl = '';
  let createdPdfUrl = '';
  let reportName = '';

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    if (!e || !e.range) {
      throw new Error('Event object onFormSubmit tidak valid atau fungsi dijalankan manual tanpa parameter.');
    }

    const sheet = e.range.getSheet();
    const row = e.range.getRow();

    // 1. Ambil data baris & pastikan header status tersedia
    const headerMap = ensureAndGetHeaderMap_(sheet);
    const rowData = getRowDataFromEventCached_(e, headerMap);

    // 2. Validasi status agar tidak diproses berulang (Idempotency)
    const currentStatus = rowData['Automation Status'] || '';
    const existingPdfUrl = rowData['PDF URL'] || '';

    if (currentStatus === 'PROCESSING') {
      Logger.log(`Row ${row} sedang diproses. Skip.`);
      return;
    }

    if ((currentStatus === 'DONE' || currentStatus === 'DONE_WITH_DELETE_WARNING') && existingPdfUrl) {
      Logger.log(`Row ${row} sudah selesai diproses sebelumnya. Skip.`);
      return;
    }

    // Tandai status awal sebagai PROCESSING
    markProcessing_(sheet, row, headerMap);

    // 3. Susun nama laporan
    const lokasiSite = sanitizeFileName_(rowData['Lokasi Site'] || 'SITE');
    const kunjunganKe = sanitizeFileName_(rowData['Keterangan Kunjungan'] || 'Kunjungan');
    const tanggalKunjungan = formatTanggalFileName_(rowData['Tanggal Kunjungan'] || formatDate_(new Date()));
    const timeStamp = buildTimeStamp_(rowData);

    reportName = `${CONFIG.DEFAULT_REPORT_PREFIX} ${lokasiSite} ${kunjunganKe} ${tanggalKunjungan} ${timeStamp}`.trim();
    const pdfFileName = `${reportName}.pdf`;

    if (pdfAlreadyExists_(CONFIG.OUTPUT_PDF_FOLDER_ID, pdfFileName)) {
      writeBackStatusFast_(sheet, row, headerMap, {
        status: 'SKIPPED_ALREADY_EXISTS',
        reportName,
        docUrl: '',
        pdfUrl: '',
        error: `PDF dengan nama "${pdfFileName}" sudah ada di Drive.`,
      });
      return;
    }

    // 4. Siapkan placeholder teks & ekstrak seluruh file gambar
    const textPlaceholders = buildTextPlaceholders_(rowData);
    const imageLinksMap = extractAllImageLinks_(rowData);
    
    uploadedImageFileIds = getUniqueFileIdsFromLinksMap_(imageLinksMap);

    // Buka izin baca file agar n8n / Docs dapat mengambil gambar
    makeAllFilesAnyoneWithLink_(uploadedImageFileIds);

    let success = false;
    let retryNotes = [];

    // 5. Fallback loop candidate thumbnail width
    for (const thumbWidth of CONFIG.THUMBNAIL_WIDTH_CANDIDATES) {
      let currentDocId = '';
      let currentDocUrl = '';

      try {
        const imagePlaceholders = buildImagePlaceholdersFast_(imageLinksMap, thumbWidth);

        const payload = {
          reportName,
          config: {
            templateDocId: CONFIG.TEMPLATE_DOC_ID,
            outputDocFolderId: CONFIG.OUTPUT_DOC_FOLDER_ID,
          },
          textPlaceholders,
          imagePlaceholders,
          rawRowData: rowData,
        };

        const n8nResult = callN8nWebhook_(payload);
        if (!n8nResult || !n8nResult.ok || !n8nResult.documentId) {
          throw new Error('Respons dari n8n tidak valid: ' + JSON.stringify(n8nResult));
        }

        currentDocId = n8nResult.documentId;
        currentDocUrl = n8nResult.docUrl || '';

        createdDocId = currentDocId;
        createdDocUrl = currentDocUrl;

        // Force save Google Doc agar perubahan dari n8n tersinkron sebelum diekspor
        try {
          DocumentApp.openById(currentDocId).saveAndClose();
        } catch (_) {
          Utilities.sleep(2000);
        }

        const pdfFile = exportDocToPdfAndSave_(
          currentDocId,
          reportName,
          CONFIG.OUTPUT_PDF_FOLDER_ID
        );
        createdPdfUrl = pdfFile.getUrl();

        deleteGeneratedDocIfNeeded_(currentDocId);

        let deleteResult = { deleted: [], errors: [] };
        if (CONFIG.DELETE_UPLOADED_IMAGES_AFTER_SUCCESS) {
          deleteResult = deleteUploadedImages_(uploadedImageFileIds);
        }

        writeBackStatusFast_(sheet, row, headerMap, {
          status: deleteResult.errors.length ? 'DONE_WITH_DELETE_WARNING' : 'DONE',
          reportName,
          docUrl: createdDocUrl,
          pdfUrl: createdPdfUrl,
          error: buildFinalErrorMessage_(retryNotes, deleteResult.errors),
        });

        success = true;
        break;

      } catch (err) {
        retryNotes.push(`w=${thumbWidth}: ${err.message || String(err)}`);

        if (currentDocId) {
          try {
            DriveApp.getFileById(currentDocId).setTrashed(true);
          } catch (_) {}
        }

        createdDocId = '';
        createdDocUrl = '';
        createdPdfUrl = '';
      }
    }

    if (!success) {
      throw new Error(`Semua percobaan export gagal: ${retryNotes.join(' || ')}`);
    }

  } catch (err) {
    console.error(err);
    try {
      const sheet = e.range.getSheet();
      const row = e.range.getRow();
      const headerMap = ensureAndGetHeaderMap_(sheet);
      
      writeBackStatusFast_(sheet, row, headerMap, {
        status: 'ERROR',
        reportName: reportName || '',
        docUrl: createdDocUrl || '',
        pdfUrl: createdPdfUrl || '',
        error: err.message || String(err),
      });
    } catch (writeErr) {
      console.error('Gagal menuliskan status error ke sheet: ', writeErr);
    }
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

// ==========================================
// PENGOLAH GAMBAR & PLACEHOLDER
// ==========================================

function extractAllImageLinks_(rowData) {
  const result = {};
  Object.keys(IMAGE_PLACEHOLDER_MAP).forEach(header => {
    const rawValue = rowData[header] || rowData[findMatchingHeader_(rowData, header)] || '';
    result[header] = splitMultiUploadValue_(rawValue);
  });
  return result;
}

function findMatchingHeader_(rowData, target) {
  const cleanTarget = String(target).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const k of Object.keys(rowData)) {
    if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget) {
      return k;
    }
  }
  return target;
}

function getUniqueFileIdsFromLinksMap_(imageLinksMap) {
  const seen = {};
  Object.values(imageLinksMap).forEach(links => {
    links.forEach(url => {
      const id = extractDriveFileId_(url);
      if (id) seen[id] = true;
    });
  });
  return Object.keys(seen);
}

function makeAllFilesAnyoneWithLink_(fileIds) {
  fileIds.forEach(fileId => {
    try {
      const file = DriveApp.getFileById(fileId);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      Logger.log(`Gagal set sharing file ${fileId}: ${err.message}`);
    }
  });
}

function buildImagePlaceholdersFast_(imageLinksMap, thumbWidth) {
  const output = [];

  Object.keys(IMAGE_PLACEHOLDER_MAP).forEach(sheetHeader => {
    const placeholderSlots = IMAGE_PLACEHOLDER_MAP[sheetHeader] || [];
    const links = imageLinksMap[sheetHeader] || [];

    for (let i = 0; i < placeholderSlots.length; i++) {
      const fileUrl = links[i] || '';
      if (!fileUrl) continue;

      const fileId = extractDriveFileId_(fileUrl);
      if (!fileId) continue;

      output.push({
        placeholder: placeholderSlots[i],
        fileId,
        publicImageUrl: `https://lh3.googleusercontent.com/d/${fileId}=w${thumbWidth}`,
      });
    }
  });

  return output;
}

function buildTextPlaceholders_(rowData) {
  const textPlaceholders = {};
  Object.keys(TEXT_PLACEHOLDER_MAP).forEach(sheetHeader => {
    const placeholder = TEXT_PLACEHOLDER_MAP[sheetHeader];
    const value = rowData[sheetHeader] || rowData[findMatchingHeader_(rowData, sheetHeader)] || '';
    textPlaceholders[placeholder] = value;
  });
  return textPlaceholders;
}

// ==========================================
// WEBHOOK N8N & EXPORT PDF
// ==========================================

function callN8nWebhook_(payload) {
  const response = UrlFetchApp.fetch(CONFIG.N8N_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'ngrok-skip-browser-warning': 'true'
    },
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Webhook n8n gagal. HTTP ${code}. Body: ${body.substring(0, 300)}`);
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`Respons n8n bukan JSON valid. Preview: ${body.substring(0, 200)}`);
  }
}

function exportDocToPdfAndSave_(docId, reportName, outputPdfFolderId) {
  const file = DriveApp.getFileById(docId);
  const pdfBlob = file.getAs(MimeType.PDF).setName(`${reportName}.pdf`);
  const folder = DriveApp.getFolderById(outputPdfFolderId);
  return folder.createFile(pdfBlob);
}

function deleteGeneratedDocIfNeeded_(docId) {
  if (!CONFIG.DELETE_DOC_AFTER_PDF_CREATED || !docId) return;
  try {
    DriveApp.getFileById(docId).setTrashed(true);
  } catch (_) {}
}

function deleteUploadedImages_(fileIds) {
  const result = { deleted: [], errors: [] };
  if (!fileIds || !fileIds.length) return result;

  fileIds.forEach(fileId => {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
      result.deleted.push(fileId);
    } catch (err) {
      result.errors.push(`${fileId}: ${err.message || err}`);
    }
  });

  return result;
}

// ==========================================
// STATUS SHEET & HEADER MANAGEMENT
// ==========================================

function ensureAndGetHeaderMap_(sheet) {
  const headerRow = 1;
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 
    ? sheet.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0] 
    : [];

  const neededHeaders = [
    'Automation Status',
    'Report Name',
    'Doc URL',
    'PDF URL',
    'Automation Error',
    'Processed At',
  ];

  let currentLastCol = lastCol;
  neededHeaders.forEach(h => {
    if (!existingHeaders.includes(h)) {
      currentLastCol++;
      sheet.getRange(headerRow, currentLastCol).setValue(h);
      existingHeaders.push(h);
    }
  });

  const map = {};
  existingHeaders.forEach((h, i) => {
    map[String(h).trim()] = i + 1;
  });
  return map;
}

function getRowDataFromEventCached_(e, headerMap) {
  const range = e.range;
  const sheet = range.getSheet();
  const row = range.getRow();
  const lastCol = sheet.getLastColumn();
  
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const values = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];

  const obj = {};
  headers.forEach((header, i) => {
    obj[String(header).trim()] = values[i];
  });

  return obj;
}

function markProcessing_(sheet, row, headerMap) {
  if (headerMap['Automation Status']) {
    sheet.getRange(row, headerMap['Automation Status']).setValue('PROCESSING');
  }
  if (headerMap['Processed At']) {
    sheet.getRange(row, headerMap['Processed At']).setValue(new Date());
  }
  SpreadsheetApp.flush();
}

function writeBackStatusFast_(sheet, row, headerMap, { status, reportName, docUrl, pdfUrl, error }) {
  if (headerMap['Automation Status']) sheet.getRange(row, headerMap['Automation Status']).setValue(status || '');
  if (headerMap['Report Name']) sheet.getRange(row, headerMap['Report Name']).setValue(reportName || '');
  if (headerMap['Doc URL']) sheet.getRange(row, headerMap['Doc URL']).setValue(docUrl || '');
  if (headerMap['PDF URL']) sheet.getRange(row, headerMap['PDF URL']).setValue(pdfUrl || '');
  if (headerMap['Automation Error']) sheet.getRange(row, headerMap['Automation Error']).setValue(error || '');
  if (headerMap['Processed At']) sheet.getRange(row, headerMap['Processed At']).setValue(new Date());
  SpreadsheetApp.flush();
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function splitMultiUploadValue_(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(/\s*,\s*|\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function extractDriveFileId_(url) {
  if (!url) return '';
  const patterns = [
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /\/d\/([a-zA-Z0-9_-]{20,})/,
  ];

  for (const p of patterns) {
    const m = String(url).match(p);
    if (m && m[1]) return m[1];
  }
  return '';
}

function pdfAlreadyExists_(folderId, fileName) {
  const files = DriveApp.getFolderById(folderId).getFilesByName(fileName);
  return files.hasNext();
}

function buildFinalErrorMessage_(retryNotes, deleteErrors) {
  const parts = [];
  if (retryNotes && retryNotes.length) {
    parts.push('Retry: ' + retryNotes.join(' | '));
  }
  if (deleteErrors && deleteErrors.length) {
    parts.push('Sebagian foto gagal dihapus: ' + deleteErrors.join(' | '));
  }
  return parts.join(' || ');
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function formatTanggalFileName_(value) {
  return String(value || '').trim().replace(/\//g, '-').replace(/\s+/g, ' ');
}

function sanitizeFileName_(text) {
  return String(text || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
}

function buildTimeStamp_(rowData) {
  const ts = rowData['Timestamp'] || '';
  if (ts) {
    const parsed = parseFormTimestamp_(ts);
    if (parsed) {
      return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'HH-mm-ss');
    }
  }
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH-mm-ss');
}

function parseFormTimestamp_(value) {
  const str = String(value || '').trim();
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;

  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
}

/**
 * Helper pengujian manual langsung di Google Apps Script editor
 */
function test_onFormSubmit_SiteVisit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('Belum ada data respons form.');
    return;
  }
  onFormSubmit({
    range: sheet.getRange(lastRow, 1, 1, sheet.getLastColumn())
  });
}
