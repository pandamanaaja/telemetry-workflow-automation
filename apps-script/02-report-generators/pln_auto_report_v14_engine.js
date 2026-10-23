/**
 * ============================================================
 * PLN AUTO REPORT v14.6 (FIXED SINGLE PAGE & PRINT BOUNDS)
 * COMPLETE MULTI-CUSTOMER GOOGLE APPS SCRIPT
 * ============================================================
 *
 * FEATURES:
 * 1. FIXED PRINT BOUNDS: Instruction text [1] TEKS TETAP / AREA INPUT
 *    is strictly excluded from PDF export boundaries.
 * 2. FOOTER DETECTION: Robust regex matching for "Form: FPP PLN", "Form: FPP PLN 2",
 *    and "Form: FPP PLN2".
 * 3. SINGLE PAGE: Direct GID range export forcing 1 page per sheet.
 * 4. DEADLOCK-FREE: Script lock released prior to calling n8n webhook.
 * 5. AUTO CLEANUP: Temporary PDF artifacts automatically trashed after merge.
 * ============================================================
 */


// ============================================================
// 1. CONFIGURATION (SANITIZED PLACEHOLDERS)
// ============================================================

const PLN_CONFIG = {

  VERSION: '14.6',

  MASTER_ID:
    'YOUR_PLN_MASTER_SPREADSHEET_ID',

  REPORT_FOLDER_ID:
    'YOUR_PLN_REPORT_OUTPUT_FOLDER_ID',

  BANK_SHEET:
    'PLN OCR Results',

  ARCHIVE_SHEET:
    'PLN OCR Archive',

  LOG_SHEET:
    'PLN_REPORT_LOG',

  CONTROL_SHEET:
    'CONTROL',

  TIMEZONE:
    'Asia/Jakarta',

  DEFAULT_STAMP:
    10000,

  REPORT_SECRET:
    'YOUR_PLN_REPORT_WEBHOOK_SECRET',

  FINALIZE_TOKEN:
    'YOUR_PLN_FINALIZE_TRIGGER_TOKEN',

  FINALIZE_WEBHOOK:
    'https://your-n8n-instance.example.com/webhook/pln-finalize-pdf-webhook',

  MONTHS: [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember'
  ],

  ROMAN: [
    'I',
    'II',
    'III',
    'IV',
    'V',
    'VI',
    'VII',
    'VIII',
    'IX',
    'X',
    'XI',
    'XII'
  ]

};


// ============================================================
// 2. CUSTOMER CONFIGURATION
// ============================================================

const PLN_CUSTOMERS = {

  '543100000001': {
    key: 'SITE_A',
    name: 'PT TRANSMISI SITE ALPHA',
    paymentTemplate: 'TN-SiteA',
    comparisonTemplate: 'TN-SiteA A',
    filePrefix: 'SITE_A_PEMBAYARAN_PLN',
    documentCode: 'ST.ALPHA-PLN-OPS'
  },

  '543100000002': {
    key: 'SITE_B',
    name: 'SITE BETA STATION',
    paymentTemplate: 'TN-1',
    comparisonTemplate: 'TN-1 A',
    filePrefix: 'SITE_B_Permohonan Pembayaran_PLN',
    documentCode: ''
  },

  '548400000003': {
    key: 'SITE_C',
    name: 'PT TRANSMISI SITE GAMMA',
    paymentTemplate: 'TN-SiteC',
    comparisonTemplate: 'TN-SiteC A',
    filePrefix: 'SITE_C_Permohonan Pembayaran_PLN',
    documentCode: ''
  },

  '537400000004': {
    key: 'SITE_D',
    name: 'PT INFRASTRUKTUR SITE DELTA',
    paymentTemplate: 'TN-SiteD',
    comparisonTemplate: 'TN-SiteD A',
    filePrefix: 'SITE_D_Permohonan Pembayaran PLN',
    documentCode: 'DELTA-PLN-OPS'
  },

  '538600000005': {
    key: 'SITE_E',
    name: 'PT INFRASTRUKTUR SITE EPSILON',
    paymentTemplate: 'TN-SiteE',
    comparisonTemplate: 'TN-SiteE A',
    filePrefix: 'SITE_E_Permohonan Pembayaran PLN',
    documentCode: ''
  }

};


// ============================================================
// 3. UTILITIES & IN-MEMORY CACHING
// ============================================================

let _cachedMasterSpreadsheet = null;
let _cachedScriptProps = null;

function plnMaster_() {
  if (!_cachedMasterSpreadsheet) {
    _cachedMasterSpreadsheet = SpreadsheetApp.openById(PLN_CONFIG.MASTER_ID);
  }
  return _cachedMasterSpreadsheet;
}

function plnCustomer_(id) {
  const customerId = String(id || '').trim();
  const customer = PLN_CUSTOMERS[customerId];

  if (!customer) {
    throw new Error('UNKNOWN_CUSTOMER_ID: ' + customerId);
  }

  return {
    ...customer,
    customerId
  };
}

function plnProperty_(name, fallback) {
  if (!_cachedScriptProps) {
    _cachedScriptProps = PropertiesService.getScriptProperties().getProperties() || {};
  }
  const value = String(_cachedScriptProps[name] || '').trim();
  return value || fallback || '';
}

function plnReportSecret_() {
  return plnProperty_('PLN_REPORT_WEBHOOK_SECRET', PLN_CONFIG.REPORT_SECRET);
}

function plnFinalizeToken_() {
  return plnProperty_('PLN_FINALIZE_TRIGGER_TOKEN', PLN_CONFIG.FINALIZE_TOKEN);
}

function plnFinalizeUrl_() {
  return plnProperty_('PLN_FINALIZE_N8N_WEBHOOK_URL', PLN_CONFIG.FINALIZE_WEBHOOK);
}

function plnOutputFolderId_() {
  return plnProperty_('PLN_REPORT_FOLDER_ID', PLN_CONFIG.REPORT_FOLDER_ID);
}

function plnMonthNumber_(value) {
  const text = String(value || '').trim().toLowerCase();
  const index = PLN_CONFIG.MONTHS.findIndex(month => month.toLowerCase() === text);

  if (index >= 0) {
    return index + 1;
  }

  const number = Number(text);
  if (Number.isInteger(number) && number >= 1 && number <= 12) {
    return number;
  }

  throw new Error('INVALID_MONTH: ' + value);
}

function plnPeriod_(month, year) {
  const m = plnMonthNumber_(month);
  const y = Number(year);

  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error('INVALID_YEAR: ' + year);
  }

  return new Date(y, m - 1, 1);
}

function plnShiftMonth_(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function plnMonthLabel_(date) {
  return PLN_CONFIG.MONTHS[date.getMonth()] + ' ' + date.getFullYear();
}

function plnDateLabel_(date) {
  return date.getDate() + ' ' + PLN_CONFIG.MONTHS[date.getMonth()] + ' ' + date.getFullYear();
}

function plnPeriodKey_(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function plnRomanMonth_(date) {
  return PLN_CONFIG.ROMAN[date.getMonth()];
}

function plnNumber_(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  let text = String(value ?? '')
    .trim()
    .replace(/^Rp\.?\s*/i, '')
    .replace(/\s/g, '');

  if (!text) {
    throw new Error('EMPTY_NUMBER');
  }

  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d+$/.test(text)) {
    text = text.replace(',', '.');
  }

  const number = Number(text);
  if (!Number.isFinite(number)) {
    throw new Error('INVALID_NUMBER: ' + value);
  }

  return number;
}

function plnJson_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

function plnError_(error) {
  return {
    ok: false,
    status: 'ERROR',
    hint: 'n8n must check response.ok, not only HTTP status',
    version: PLN_CONFIG.VERSION,
    error: String(error && error.message ? error.message : error)
  };
}


// ============================================================
// 4. TECHNICIAN VALIDATION
// ============================================================

function plnGetTechnician_(payload) {
  const technician = String(
    payload.technician ||
    payload.nama_teknisi ||
    payload['Nama Teknisi'] ||
    payload['Technician'] ||
    ''
  ).trim();

  if (!technician) {
    throw new Error(
      'TECHNICIAN_MISSING: Webhook Google Form must send Nama Teknisi; check n8n Split PDF IDs and Generate Report payload.'
    );
  }

  if (technician.includes('<<') || technician.includes('>>')) {
    throw new Error('INVALID_TECHNICIAN_NAME: ' + technician);
  }

  return technician;
}


// ============================================================
// 5. FLEXIBLE PLACEHOLDER REPLACEMENT
// ============================================================

function plnReplaceText_(sheet, search, replacement) {
  const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/^<</, '<<\\s*')
    .replace(/>>$/, '\\s*>>');

  return sheet.createTextFinder(pattern)
    .useRegularExpression(true)
    .matchCase(false)
    .replaceAllWith(String(replacement));
}

function plnVerifyTechnician_(sheet) {
  const finder = sheet.createTextFinder('<<\\s*Nama\\s+Teknisi\\s*>>')
    .useRegularExpression(true)
    .matchCase(false)
    .findNext();

  if (finder) {
    throw new Error(
      'TECHNICIAN_PLACEHOLDER_NOT_REPLACED: ' +
      sheet.getName() + '!' + finder.getA1Notation()
    );
  }

  return true;
}


// ============================================================
// 6. DOCUMENT NUMBER
// ============================================================

function plnFillDocumentMetadata_(sheet, customer, duePeriod, technician) {
  const monthUpper = PLN_CONFIG.MONTHS[duePeriod.getMonth()].toUpperCase();
  const roman = plnRomanMonth_(duePeriod);
  const year = duePeriod.getFullYear();

  plnReplaceText_(sheet, '<<Nama Teknisi>>', technician);

  const lastRow = Math.min(sheet.getLastRow(), 30);
  const lastColumn = Math.min(sheet.getLastColumn(), 20);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const original = String(values[r][c] || '');
      if (!original) continue;

      const containsCode =
        customer.documentCode &&
        original.toUpperCase().includes(customer.documentCode.toUpperCase());
      const containsRomanPlaceholder = /dalam angka romawi/i.test(original);

      if (!containsCode && !containsRomanPlaceholder) continue;

      let updated = original;

      updated = updated.replace(
        /["“”]?\s*dalam angka romawi\s*["“”]?/gi,
        roman
      );

      PLN_CONFIG.MONTHS.forEach(month => {
        updated = updated.replace(new RegExp(month, 'gi'), monthUpper);
      });

      updated = updated.replace(
        new RegExp('/' + monthUpper + '\\s*[/\\s]+\\s*' + roman + '(?=/)', 'gi'),
        '/' + roman
      );

      updated = updated.replace(
        new RegExp('/' + roman + '\\s+' + roman + '(?=/)', 'gi'),
        '/' + roman
      );

      if (customer.documentCode) {
        const escapedCode = customer.documentCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(
          '^(?:' + PLN_CONFIG.MONTHS.join('|') + ')\\s*\\/\\s*' + escapedCode + '\\s*\\/.*$',
          'i'
        );

        if (pattern.test(updated)) {
          updated = monthUpper + '/' + customer.documentCode + '/' + roman + '/' + year;
        }
      }

      updated = updated.replace(/\/\d{4}\s*$/, '/' + year);

      if (updated !== original) {
        sheet.getRange(r + 1, c + 1).setValue(updated);
      }
    }
  }
}


// ============================================================
// 7. OCR BANK
// ============================================================

function plnBankRows_() {
  const sheet = plnMaster_().getSheetByName(PLN_CONFIG.BANK_SHEET);
  if (!sheet) {
    throw new Error('OCR_BANK_NOT_FOUND');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  return values.map((row, index) => ({
    rowNumber: index + 2,
    timestamp: row[0],
    customerId: String(row[1] || '').trim(),
    customerName: String(row[2] || '').trim(),
    dueMonth: row[3],
    dueYear: row[4],
    total: row[5],
    endLWBP: row[6],
    endWBP: row[7],
    startLWBP: row[8],
    startWBP: row[9],
    endKvarh: row[10],
    startKvarh: row[11],
    sourceFileId: String(row[12] || '').trim(),
    status: String(row[13] || '').trim().toUpperCase(),
    raw: row
  }));
}


// ============================================================
// 8. HISTORICAL RECORD SELECTION
// ============================================================

function plnRecordSignature_(record) {
  return JSON.stringify([
    record.total,
    record.endLWBP,
    record.endWBP,
    record.startLWBP,
    record.startWBP,
    record.endKvarh,
    record.startKvarh
  ].map(plnNumber_));
}

function plnSelectPeriodRecord_(customerId, duePeriod, preloadedRows) {
  const key = plnPeriodKey_(duePeriod);
  const allRows = Array.isArray(preloadedRows) ? preloadedRows : plnBankRows_();

  const records = allRows.filter(record => {
    if (record.customerId !== String(customerId)) return false;
    if (record.status !== 'VALID') return false;
    try {
      return plnPeriodKey_(plnPeriod_(record.dueMonth, record.dueYear)) === key;
    } catch (_) {
      return false;
    }
  });

  if (!records.length) {
    throw new Error(
      'HISTORICAL_DATA_MISSING: ' + customerId + ' / ' + plnMonthLabel_(duePeriod)
    );
  }

  const signatures = new Set(records.map(plnRecordSignature_));
  if (signatures.size > 1) {
    throw new Error(
      'HISTORICAL_DATA_CONFLICT: ' + customerId + ' / ' + plnMonthLabel_(duePeriod)
    );
  }

  records.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime() || 0;
    const tb = new Date(b.timestamp).getTime() || 0;
    return tb - ta || b.rowNumber - a.rowNumber;
  });

  return records[0];
}


// ============================================================
// 9. THREE MONTH DATA
// ============================================================

function plnGetThreeMonths_(customerId, latestDuePeriod) {
  const bankRows = plnBankRows_();
  const result = [];

  for (let offset = -2; offset <= 0; offset++) {
    const dueDate = plnShiftMonth_(latestDuePeriod, offset);
    const billingDate = plnShiftMonth_(dueDate, -1);
    const record = plnSelectPeriodRecord_(customerId, dueDate, bankRows);

    result.push({
      dueDate,
      billingDate,
      record
    });
  }

  return result;
}


// ============================================================
// 10. PAYMENT ROW DETECTION
// ============================================================

function plnFindPaymentRows_(sheet) {
  const lastRow = Math.min(sheet.getLastRow(), 100);
  const values = sheet.getRange(1, 2, lastRow, 1).getDisplayValues();

  const rows = {
    period: 0,
    bill: 0,
    stamp: 0,
    total: 0
  };

  values.forEach((row, index) => {
    const text = String(row[0] || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const actualRow = index + 1;

    if (text === 'periode') {
      rows.period = actualRow;
    } else if (text.includes('jumlah tagihan pln')) {
      rows.bill = actualRow;
    } else if (text.includes('materai') || text.includes('meterai')) {
      rows.stamp = actualRow;
    } else if (text === 'total') {
      rows.total = actualRow;
    }
  });

  if (!rows.period || !rows.bill || !rows.stamp || !rows.total) {
    throw new Error(
      'PAYMENT_ROWS_NOT_FOUND: ' + sheet.getName() + ' / ' + JSON.stringify(rows)
    );
  }

  return rows;
}


// ============================================================
// 11. FILL TN
// ============================================================

function plnFillTN_(sheet, customer, duePeriod, record, technician) {
  const rows = plnFindPaymentRows_(sheet);
  const amount = plnNumber_(record.total);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('INVALID_BILL_AMOUNT');
  }

  const periodLabel = plnMonthLabel_(duePeriod);

  const placeholders = {
    '<<Nama Pelanggan>>': customer.name,
    '<<ID Pelanggan>>': customer.customerId,
    '<<Nama Teknisi>>': technician,
    '<<Bulan Jatuh Tempo>>': PLN_CONFIG.MONTHS[duePeriod.getMonth()],
    '<<Tahun Jatuh Tempo>>': String(duePeriod.getFullYear())
  };

  Object.keys(placeholders).forEach(key => {
    plnReplaceText_(sheet, key, placeholders[key]);
  });

  const stampCell = sheet.getRange(rows.stamp, 7);
  let stampAmount = PLN_CONFIG.DEFAULT_STAMP;

  try {
    const existing = stampCell.getValue();
    if (existing !== '' && existing !== null) {
      const parsed = plnNumber_(existing);
      if (Number.isFinite(parsed) && parsed >= 0) {
        stampAmount = parsed;
      }
    }
  } catch (_) {
    stampAmount = PLN_CONFIG.DEFAULT_STAMP;
  }

  sheet.getRange(rows.period, 6, 1, 2).setValues([[':', periodLabel]]);
  sheet.getRange(rows.bill, 6, 1, 2).setValues([[':', amount]]);
  sheet.getRange(rows.stamp, 6, 1, 2).setValues([[':', stampAmount]]);
  sheet.getRange(rows.total, 6).setValue(':');
  sheet.getRange(rows.total, 7).setFormula('=G' + rows.bill + '+G' + rows.stamp);

  [rows.period, rows.bill, rows.stamp, rows.total].forEach(row => {
    sheet.getRange(row, 7).setHorizontalAlignment('left');
  });

  [rows.bill, rows.stamp, rows.total].forEach(row => {
    sheet.getRange(row, 7).setNumberFormat('"Rp" #,##0');
  });

  plnFillDocumentMetadata_(sheet, customer, duePeriod, technician);
  SpreadsheetApp.flush();
  plnVerifyTechnician_(sheet);

  return {
    rows,
    amount,
    stamp: stampAmount,
    total: amount + stampAmount
  };
}


// ============================================================
// 12. FILL COMPARISON (BATCHED WRITES)
// ============================================================

function plnFillComparison_(sheet, months, technician) {
  const data = {
    headings: [],
    startLWBP: [],
    endLWBP: [],
    startWBP: [],
    endWBP: [],
    startKvarh: [],
    endKvarh: [],
    startDates: [],
    endDates: [],
    days: [],
    bills: [],
    billPeriods: []
  };

  months.forEach(item => {
    const r = item.record;
    const billingDate = item.billingDate;
    const endDate = plnShiftMonth_(billingDate, 1);

    data.headings.push(plnMonthLabel_(billingDate));
    data.startLWBP.push(plnNumber_(r.startLWBP));
    data.endLWBP.push(plnNumber_(r.endLWBP));
    data.startWBP.push(plnNumber_(r.startWBP));
    data.endWBP.push(plnNumber_(r.endWBP));
    data.startKvarh.push(plnNumber_(r.startKvarh));
    data.endKvarh.push(plnNumber_(r.endKvarh));
    data.startDates.push(plnDateLabel_(billingDate));
    data.endDates.push(plnDateLabel_(endDate));
    data.days.push(
      new Date(billingDate.getFullYear(), billingDate.getMonth() + 1, 0).getDate() + ' Hari'
    );
    data.bills.push(plnNumber_(r.total));
    data.billPeriods.push(plnMonthLabel_(item.dueDate));
  });

  sheet.getRange(8, 2, 1, 3).setValues([data.headings]);

  sheet.getRange(11, 2, 5, 3).setValues([
    data.startLWBP,
    data.startDates,
    data.endLWBP,
    data.endDates,
    data.startLWBP.map((value, i) => data.endLWBP[i] - value)
  ]);

  sheet.getRange(18, 2, 5, 3).setValues([
    data.startWBP,
    data.startDates,
    data.endWBP,
    data.endDates,
    data.startWBP.map((value, i) => data.endWBP[i] - value)
  ]);

  sheet.getRange(25, 2, 5, 3).setValues([
    data.startKvarh,
    data.startDates,
    data.endKvarh,
    data.endDates,
    data.startKvarh.map((value, i) => data.endKvarh[i] - value)
  ]);

  sheet.getRange(31, 2, 1, 3).setValues([data.days]);
  sheet.getRange(33, 2, 2, 3).setValues([data.bills, data.billPeriods]);
  sheet.getRange('B33:D33').setNumberFormat('"Rp" #,##0');

  [11, 13, 15, 18, 20, 22, 25, 27, 29].forEach(row => {
    sheet.getRange(row, 2, 1, 3).setNumberFormat('#,##0.###');
  });

  const oldDifference = sheet.getRange('D37');
  if (oldDifference.getFormula()) {
    oldDifference.clearContent();
  }

  plnReplaceText_(sheet, '<<Nama Teknisi>>', technician);
  plnReplaceText_(sheet, '<<tanggal saat laporan dibuat>>', plnDateLabel_(new Date()));

  SpreadsheetApp.flush();
  plnVerifyTechnician_(sheet);
}


// ============================================================
// 13. CONTROL SHEET
// ============================================================

function plnCreateControl_(report, customer, sourceFileId, pdfName, folderId) {
  const sheet = report.insertSheet(PLN_CONFIG.CONTROL_SHEET);

  const values = [
    ['PLN AUTO REPORT', PLN_CONFIG.VERSION],
    ['Customer ID', customer.customerId],
    ['Customer', customer.name],
    ['Source PDF ID', sourceFileId],
    ['Report Spreadsheet ID', report.getId()],
    ['Status', 'PENDING_REVIEW'],
    ['Last Updated', new Date()],
    ['Review Approved', false],
    ['Final PDF ID', ''],
    ['Final PDF Name', pdfName],
    ['Output Folder ID', folderId],
    ['Temp TN PDF ID', ''],
    ['Temp Comparison PDF ID', '']
  ];

  sheet.getRange(1, 1, values.length, 2).setValues(values);
  sheet.getRange('B8').insertCheckboxes();
  sheet.getRange('B8').setValue(false);
  sheet.getRange('A1:B1').setFontWeight('bold');
  sheet.setColumnWidth(1, 210);
  sheet.setColumnWidth(2, 370);

  return sheet;
}


// ============================================================
// 14. REPORT LOG
// ============================================================

function plnAppendReportLog_(data) {
  const sheet = plnMaster_().getSheetByName(PLN_CONFIG.LOG_SHEET);
  if (!sheet) {
    throw new Error('REPORT_LOG_NOT_FOUND');
  }

  sheet.appendRow([
    data.sourceFileId || '',
    data.customerId || '',
    data.period || '',
    data.reportUrl || '',
    data.pdfUrl || '',
    new Date(),
    data.status || '',
    data.technician || '',
    '',
    data.template || '',
    data.customerName || ''
  ]);
}

function plnUpdateReportLog_(sourceFileId, reportUrl, pdfUrl, status) {
  const sheet = plnMaster_().getSheetByName(PLN_CONFIG.LOG_SHEET);
  if (!sheet) {
    throw new Error('REPORT_LOG_NOT_FOUND');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('REPORT_LOG_EMPTY');
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  let targetRow = -1;

  for (let i = rows.length - 1; i >= 0; i--) {
    if (
      String(rows[i][0]) === String(sourceFileId) &&
      String(rows[i][3]) === String(reportUrl)
    ) {
      targetRow = i + 2;
      break;
    }
  }

  if (targetRow < 0) {
    throw new Error('REPORT_LOG_ROW_NOT_FOUND');
  }

  sheet.getRange(targetRow, 5).setValue(pdfUrl);
  sheet.getRange(targetRow, 7).setValue(status);
}


// ============================================================
// 15. CREATE REPORT
// ============================================================

function plnCreateReportV138(payload) {
  payload = payload || {};
  if (payload.data && typeof payload.data === 'object') {
    payload = Object.assign({}, payload.data, payload);
  }

  const customerId = String(
    payload.customer_id || payload.id_pelanggan || payload.customerId ||
    payload['ID Pelanggan'] || ''
  ).trim();
  const customer = plnCustomer_(customerId);
  const dueMonth = payload.bulan_jatuh_tempo || payload.due_month ||
    payload.month || payload['Bulan Jatuh Tempo'];
  const dueYear = payload.tahun_jatuh_tempo || payload.due_year ||
    payload.year || payload['Tahun Jatuh Tempo'];
  if (!dueMonth || !dueYear) throw new Error('DUE_PERIOD_REQUIRED');

  const technician = plnGetTechnician_(payload);
  const duePeriod = plnPeriod_(dueMonth, dueYear);

  const bankRows = plnBankRows_();
  const latest = plnSelectPeriodRecord_(customerId, duePeriod, bankRows);
  const months = [];
  const missingPeriods = [];

  for (let offset = -2; offset <= 0; offset++) {
    const d = plnShiftMonth_(duePeriod, offset);
    const item = {
      dueDate: d,
      billingDate: plnShiftMonth_(d, -1),
      record: null
    };
    try {
      item.record = offset === 0 ? latest :
        plnSelectPeriodRecord_(customerId, d, bankRows);
    } catch (error) {
      if (!String(error.message).startsWith('HISTORICAL_DATA_MISSING:')) {
        throw error;
      }
      missingPeriods.push(plnMonthLabel_(d));
    }
    months.push(item);
  }
  const historyReady = missingPeriods.length === 0;

  const sourceFileId = String(payload.source_file_id || payload.file_id ||
    payload['File ID'] || latest.sourceFileId || '').trim();
  if (!sourceFileId) throw new Error('SOURCE_FILE_ID_MISSING');
  try {
    DriveApp.getFileById(sourceFileId).getName();
  } catch (error) {
    throw new Error('SOURCE_PDF_NOT_ACCESSIBLE: ' + sourceFileId +
      ' / ' + error.message);
  }

  const master = plnMaster_();
  const paymentTemplate = master.getSheetByName(customer.paymentTemplate);
  const comparisonTemplate = master.getSheetByName(customer.comparisonTemplate);
  if (!paymentTemplate || !comparisonTemplate) {
    throw new Error('CUSTOMER_TEMPLATE_MISSING: ' + customerId +
      ' / TN=' + customer.paymentTemplate +
      ' / COMP=' + customer.comparisonTemplate);
  }
  plnFindPaymentRows_(paymentTemplate);

  const baseName = customer.filePrefix + '_' +
    PLN_CONFIG.MONTHS[duePeriod.getMonth()] + '_' + duePeriod.getFullYear();
  const folderId = plnOutputFolderId_();
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
    folder.getName();
  } catch (error) {
    throw new Error('REPORT_FOLDER_NOT_ACCESSIBLE: ' + folderId +
      ' / ' + error.message);
  }

  let report = null;
  let stage = 'PREPARE';
  try {
    stage = 'CREATE_FILE';
    report = SpreadsheetApp.create(baseName);
    const reportId = report.getId();
    const reportUrl = report.getUrl();
    let folderWarning = '';
    try {
      DriveApp.getFileById(reportId).moveTo(folder);
    } catch (error) {
      folderWarning = 'SHEET_CREATED_BUT_MOVE_FAILED: ' + error.message;
      console.error(folderWarning);
    }

    stage = 'COPY_TEMPLATES';
    const tn = paymentTemplate.copyTo(report);
    tn.setName('TN');
    const comparison = comparisonTemplate.copyTo(report);
    comparison.setName('PERBANDINGAN');
    report.getSheets().forEach(sheet => {
      if (sheet.getSheetId() !== tn.getSheetId() &&
          sheet.getSheetId() !== comparison.getSheetId()) {
        report.deleteSheet(sheet);
      }
    });
    report.setActiveSheet(tn); report.moveActiveSheet(1);
    report.setActiveSheet(comparison); report.moveActiveSheet(2);

    stage = 'FILL_TN';
    const payment = plnFillTN_(tn, customer, duePeriod, latest, technician);

    stage = 'FILL_COMPARISON';
    if (historyReady) {
      plnFillComparison_(comparison, months, technician);
    } else {
      plnFillIncompleteComparisonV139_(comparison, months, technician);
    }

    stage = 'CREATE_CONTROL';
    const control = plnCreateControl_(report, customer, sourceFileId,
      baseName + '.pdf', folderId);
    const reportStatus = historyReady ? 'PENDING_REVIEW' : 'WAITING_HISTORY';
    control.getRange('B6').setValue(reportStatus);
    SpreadsheetApp.flush();

    const warnings = [];
    if (folderWarning) warnings.push(folderWarning);
    try {
      plnAppendReportLog_({
        sourceFileId, customerId, period: plnMonthLabel_(duePeriod),
        reportUrl, pdfUrl: '', status: reportStatus, technician,
        template: customer.paymentTemplate, customerName: customer.name
      });
    } catch (error) {
      warnings.push('LOG_FAILED: ' + error.message);
    }
    if (historyReady) {
      try {
        plnInstallReviewTrigger_(reportId);
      } catch (error) {
        warnings.push('REVIEW_TRIGGER_FAILED: ' + error.message);
      }
    }

    return {
      ok: true,
      status: reportStatus,
      version: PLN_CONFIG.VERSION,
      customer_id: customerId,
      customer_name: customer.name,
      technician,
      file_id: reportId,
      sheet_id: reportId,
      sheet_url: reportUrl,
      source_file_id: sourceFileId,
      final_pdf_name: baseName + '.pdf',
      output_folder_id: folderId,
      amount: payment.amount,
      stamp: payment.stamp,
      total: payment.total,
      comparison_ready: historyReady,
      missing_periods: missingPeriods,
      review_required: historyReady,
      warnings
    };
  } catch (error) {
    const reportUrl = report ? report.getUrl() : '';
    const reportId = report ? report.getId() : '';
    throw new Error('REPORT_CREATION_FAILED stage=' + stage +
      ' / ' + error.message +
      (reportUrl ? ' / partial_sheet_url=' + reportUrl : '') +
      (reportId ? ' / partial_sheet_id=' + reportId : ''));
  }
}

function plnFillIncompleteComparisonV139_(sheet, months, technician) {
  const rows = [11,12,13,14,15,18,19,20,21,22,25,26,27,28,29,31,33,34];
  rows.forEach(row => sheet.getRange(row, 2, 1, 3).clearContent());
  sheet.getRange('B8:D8').setValues([months.map(item =>
    plnMonthLabel_(item.billingDate)
  )]);

  const row33 = [];
  const row34 = [];
  months.forEach(item => {
    row33.push(item.record ? plnNumber_(item.record.total) : 'DATA BELUM ADA');
    row34.push(plnMonthLabel_(item.dueDate));
  });
  sheet.getRange(33, 2, 2, 3).setValues([row33, row34]);

  const oldDifference = sheet.getRange('D37');
  if (oldDifference.getFormula()) oldDifference.clearContent();
  plnReplaceText_(sheet, '<<Nama Teknisi>>', technician);
  plnReplaceText_(sheet, '<<tanggal saat laporan dibuat>>',
    plnDateLabel_(new Date()));
  sheet.getRange('B33:D33').setNumberFormat('General');
  SpreadsheetApp.flush();
  plnVerifyTechnician_(sheet);
}


// ============================================================
// 16. INSTALL REVIEW TRIGGER
// ============================================================

function plnIsPlnReviewTriggerV140_(trigger) {
  const name = String(trigger.getHandlerFunction() || '');
  return /^onPlnReviewEditV\d+_$/.test(name) &&
    trigger.getEventType() === ScriptApp.EventType.ON_EDIT;
}

function plnReviewTriggerInventoryV140_(options) {
  options = options || {};
  const triggers = ScriptApp.getProjectTriggers()
    .filter(plnIsPlnReviewTriggerV140_);
  const results = [];
  triggers.forEach(trigger => {
    const spreadsheetId = trigger.getTriggerSourceId() || '';
    const item = {
      uid: trigger.getUniqueId(),
      handler: trigger.getHandlerFunction(),
      spreadsheet_id: spreadsheetId,
      status: '',
      action: 'KEEP',
      reason: ''
    };
    if (!spreadsheetId) {
      item.reason = 'NO_SPREADSHEET_ID_MANUAL_REVIEW';
      results.push(item);
      return;
    }
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const control = ss.getSheetByName(PLN_CONFIG.CONTROL_SHEET);
      if (!control) {
        item.reason = 'CONTROL_SHEET_MISSING_MANUAL_REVIEW';
      } else {
        item.status = String(control.getRange('B6').getDisplayValue()).trim().toUpperCase();
        if (item.status === 'COMPLETED') {
          item.action = 'DELETE';
          item.reason = 'REPORT_COMPLETED';
        } else if (options.includeFailed === true &&
            (item.status === 'FAILED' || item.status.startsWith('FAILED:'))) {
          item.action = 'DELETE';
          item.reason = 'FAILED_REPORT_EXPLICIT_OPT_IN';
        } else {
          item.reason = 'REPORT_STILL_REQUIRES_REVIEW_OR_FINALIZATION';
        }
      }
    } catch (error) {
      item.reason = 'CANNOT_OPEN_SHEET_MANUAL_REVIEW: ' +
        String(error.message || error).slice(0, 160);
      if (options.includeInaccessible === true) {
        item.action = 'DELETE';
        item.reason = 'INACCESSIBLE_EXPLICIT_OPT_IN: ' + item.reason;
      }
    }
    results.push(item);
  });
  return results;
}

function plnPreviewOldTriggersV140() {
  const items = plnReviewTriggerInventoryV140_();
  const result = {
    ok: true, dry_run: true,
    total_pln_review_triggers: items.length,
    deletable: items.filter(x => x.action === 'DELETE').length,
    retained: items.filter(x => x.action !== 'DELETE').length,
    items
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function plnCleanupOldTriggersV140(options) {
  options = options || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('TRIGGER_CLEANUP_LOCK_BUSY');
  try {
    const eligible = plnReviewTriggerInventoryV140_(options)
      .filter(x => x.action === 'DELETE');
    const eligibleIds = new Set(eligible.map(x => x.uid));
    const deleted = [];
    const errors = [];
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (!plnIsPlnReviewTriggerV140_(trigger)) return;
      if (!eligibleIds.has(trigger.getUniqueId())) return;
      try {
        ScriptApp.deleteTrigger(trigger);
        deleted.push({ uid: trigger.getUniqueId(), spreadsheet_id: trigger.getTriggerSourceId() });
      } catch (error) {
        errors.push({ uid: trigger.getUniqueId(), error: String(error.message || error) });
      }
    });
    const result = { ok: errors.length === 0, deleted_count: deleted.length,
      deleted, errors, remaining: ScriptApp.getProjectTriggers()
        .filter(plnIsPlnReviewTriggerV140_).length };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function plnInstallReviewTrigger_(spreadsheetId) {
  const triggers = ScriptApp.getProjectTriggers();
  const alreadyExists = triggers.some(t =>
    t.getHandlerFunction() === 'onPlnReviewEditV138_' &&
    t.getTriggerSourceId() === spreadsheetId
  );
  if (alreadyExists) return;

  try {
    ScriptApp.newTrigger('onPlnReviewEditV138_')
      .forSpreadsheet(spreadsheetId)
      .onEdit()
      .create();
  } catch (error) {
    try {
      plnCleanupOldTriggersV140();
      ScriptApp.newTrigger('onPlnReviewEditV138_')
        .forSpreadsheet(spreadsheetId)
        .onEdit()
        .create();
    } catch (retryError) {
      throw new Error('REVIEW_TRIGGER_INSTALL_FAILED: ' + retryError.message +
        '. Run plnPreviewOldTriggersV140 and plnCleanupOldTriggersV140.');
    }
  }
}

function plnRemoveCompletedReportTriggerV140_(spreadsheetId) {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => plnIsPlnReviewTriggerV140_(t) &&
      t.getTriggerSourceId() === spreadsheetId);
  let removed = 0;
  triggers.forEach(t => {
    ScriptApp.deleteTrigger(t);
    removed++;
  });
  return removed;
}


// ============================================================
// 17. MANUAL REVIEW HANDLER (DEADLOCK-FREE)
// ============================================================

function onPlnReviewEditV138_(e) {
  if (!e || !e.range) return;

  const range = e.range;
  const sheet = range.getSheet();

  if (sheet.getName() !== PLN_CONFIG.CONTROL_SHEET) return;
  if (range.getA1Notation() !== 'B8') return;
  if (String(e.value).toUpperCase() !== 'TRUE') return;

  const report = sheet.getParent();
  const statusCell = sheet.getRange('B6');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    statusCell.setValue('LOCK_BUSY');
    sheet.getRange('B8').setValue(false);
    return;
  }

  let reportId = '';
  try {
    const status = String(statusCell.getValue()).trim();

    if (status === 'WAITING_HISTORY') {
      sheet.getRange('B8').setValue(false);
      return;
    }

    if (
      status === 'COMPLETED' ||
      status === 'FINALIZING' ||
      status === 'FINALIZATION_REQUESTED'
    ) {
      return;
    }

    reportId = report.getId();
    statusCell.setValue('FINALIZING');
    sheet.getRange('B7').setValue(new Date());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (!reportId) return;

  try {
    const response = UrlFetchApp.fetch(plnFinalizeUrl_(), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        token: plnFinalizeToken_(),
        action: 'finalize_pdf',
        file_id: reportId
      }),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('N8N_WEBHOOK_HTTP_' + code);
    }

    SpreadsheetApp.flush();
    const latestStatus = String(statusCell.getValue()).trim();
    if (latestStatus !== 'COMPLETED') {
      statusCell.setValue('FINALIZATION_REQUESTED');
    }
    sheet.getRange('B7').setValue(new Date());

  } catch (error) {
    statusCell.setValue('FAILED: ' + String(error.message).slice(0, 120));
    sheet.getRange('B8').setValue(false);
    console.error(error);
  }
}


// ============================================================
// 18. PDF EXPORT HELPERS (FIXED PRINT RANGE - STRICT NO INSTRUCTIONS)
// ============================================================

function plnReportPrintRangeV143_(sheet, landscape) {
  const maxRows = Math.min(sheet.getMaxRows(), 130);
  const maxCols = Math.min(sheet.getMaxColumns(), 20);
  const rows = sheet.getRange(1, 1, maxRows, maxCols).getDisplayValues();

  let footerRow = 0;
  let instructionsRow = 0;

  rows.forEach((cells, index) => {
    const line = cells.join(' ').replace(/\s+/g, ' ').trim();

    if (
      !instructionsRow &&
      (
        /\[1\]\s*TEKS\s+TETAP/i.test(line) ||
        /Jangan ketik penjelasan pada/i.test(line) ||
        /AREA INPUT/i.test(line)
      )
    ) {
      instructionsRow = index + 1;
    }

    if (/\bForm\s*:\s*FPP\s*PLN/i.test(line)) {
      footerRow = index + 1;
    }
  });

  let endRow = footerRow;
  if (instructionsRow) {
    endRow = (footerRow && footerRow < instructionsRow) ? footerRow : instructionsRow - 1;
  }

  if (!endRow || endRow < 10) {
    endRow = landscape ? 42 : 55;
  }

  const lastCol = Math.min(14, sheet.getMaxColumns());

  return {
    r1: 0,
    c1: 0,
    r2: endRow,
    c2: lastCol,
    a1: 'A1:' + sheet.getRange(endRow, lastCol).getA1Notation()
  };
}

function plnExportSingleSheetPdf_(spreadsheetId, sheet, landscape, filename) {
  const bound = plnReportPrintRangeV143_(sheet, landscape);
  SpreadsheetApp.flush();

  const options = {
    format: 'pdf',
    size: 'A4',
    portrait: String(!landscape),
    scale: '4',
    sheetnames: 'false',
    printtitle: 'false',
    pagenumbers: 'false',
    gridlines: 'false',
    fzr: 'false',
    top_margin: '0.15',
    bottom_margin: '0.15',
    left_margin: '0.20',
    right_margin: '0.20',
    horizontal_alignment: 'CENTER',
    vertical_alignment: 'TOP',
    gid: String(sheet.getSheetId()),
    r1: String(bound.r1),
    c1: String(bound.c1),
    r2: String(bound.r2),
    c2: String(bound.c2)
  };

  const query = Object.entries(options)
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value))
    .join('&');

  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?' + query;

  const response = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  if (responseCode !== 200) {
    throw new Error(
      'PDF_EXPORT_FAILED: ' + sheet.getName() + ' / HTTP ' + responseCode + ' / ' +
      response.getContentText().slice(0, 250)
    );
  }

  const blob = response.getBlob().setName(filename);
  const bytes = blob.getBytes();

  const signature = bytes
    .slice(0, 5)
    .map(byte => String.fromCharCode(byte < 0 ? byte + 256 : byte))
    .join('');

  if (bytes.length < 100 || signature !== '%PDF-') {
    throw new Error('INVALID_EXPORTED_PDF: ' + sheet.getName());
  }

  console.log(
    'PLN_PDF_EXPORT_SUCCESS: ' +
    JSON.stringify({
      sheet: sheet.getName(),
      filename: filename,
      print_range: bound.a1,
      orientation: landscape ? 'LANDSCAPE' : 'PORTRAIT',
      bytes: bytes.length
    })
  );

  return blob;
}


// ============================================================
// 19. PREPARE PDF (DIRECT GID EXPORT)
// ============================================================

function plnPreparePdfV138(spreadsheetId) {
  const report = SpreadsheetApp.openById(spreadsheetId);
  const tn = report.getSheetByName('TN');
  const comparison = report.getSheetByName('PERBANDINGAN');
  const control = report.getSheetByName(PLN_CONFIG.CONTROL_SHEET);

  if (!tn || !comparison || !control) {
    throw new Error('INVALID_REPORT_STRUCTURE');
  }

  const controlValues = control.getRange('B2:B11').getValues();
  const customerId = String(controlValues[0][0] || '').trim();
  const sourceFileId = String(controlValues[2][0] || '').trim();
  const reviewStatus = String(controlValues[4][0] || '').trim();
  const reviewApproved = controlValues[6][0] === true;
  const finalPdfName = String(controlValues[8][0] || '').trim();
  const folderId = String(controlValues[9][0] || '').trim();

  plnCustomer_(customerId);

  if (!reviewApproved || !['FINALIZING', 'FINALIZATION_REQUESTED'].includes(reviewStatus)) {
    throw new Error('PDF_REVIEW_NOT_APPROVED: ' + reviewStatus);
  }

  if (!sourceFileId || !folderId) {
    throw new Error('CONTROL_METADATA_MISSING');
  }

  const folder = DriveApp.getFolderById(folderId);
  SpreadsheetApp.flush();

  const tnBlob = plnExportSingleSheetPdf_(
    spreadsheetId,
    tn,
    false,
    'TEMP_TN_' + finalPdfName
  );

  const comparisonBlob = plnExportSingleSheetPdf_(
    spreadsheetId,
    comparison,
    true,
    'TEMP_COMPARISON_' + finalPdfName
  );

  const tnPdf = folder.createFile(tnBlob);
  const comparisonPdf = folder.createFile(comparisonBlob);

  control.getRange('A12:B13').setValues([
    ['Temp TN PDF ID', tnPdf.getId()],
    ['Temp Comparison PDF ID', comparisonPdf.getId()]
  ]);
  SpreadsheetApp.flush();

  return {
    ok: true,
    status: 'PREPARED',
    version: PLN_CONFIG.VERSION,
    file_id: spreadsheetId,
    customer_id: customerId,
    tn_pdf_file_id: tnPdf.getId(),
    comparison_pdf_file_id: comparisonPdf.getId(),
    original_pdf_file_id: sourceFileId,
    source_file_id: sourceFileId,
    final_pdf_name: finalPdfName,
    output_folder_id: folderId,
    orientation: {
      tn: 'PORTRAIT',
      comparison: 'LANDSCAPE'
    }
  };
}


// ============================================================
// 20. FINALIZE REPORT (AUTO CLEANUP TEMP ARTIFACTS)
// ============================================================

function plnFinalizeReportV138(spreadsheetId, finalPdfId) {
  if (!spreadsheetId || !finalPdfId) {
    throw new Error('FINALIZE_PARAMETER_MISSING');
  }

  const report = SpreadsheetApp.openById(spreadsheetId);
  const control = report.getSheetByName(PLN_CONFIG.CONTROL_SHEET);

  if (!control) {
    throw new Error('CONTROL_SHEET_MISSING');
  }

  const pdfFile = DriveApp.getFileById(finalPdfId);
  if (pdfFile.getMimeType() !== MimeType.PDF) {
    throw new Error('FINAL_FILE_NOT_PDF');
  }

  const sourceFileId = String(control.getRange('B4').getValue());

  plnUpdateReportLog_(
    sourceFileId,
    report.getUrl(),
    pdfFile.getUrl(),
    'COMPLETED'
  );

  control.getRange('B6').setValue('COMPLETED');
  control.getRange('B7').setValue(new Date());
  control.getRange('B9').setValue(finalPdfId);

  try {
    const tempIds = control.getRange('B12:B13').getValues().flat();
    tempIds.forEach(id => {
      const cleanId = String(id || '').trim();
      if (cleanId) {
        DriveApp.getFileById(cleanId).setTrashed(true);
      }
    });
    control.getRange('B12:B13').clearContent();
  } catch (error) {
    console.warn('TEMP_PDF_CLEANUP_WARNING: ' + error.message);
  }

  try {
    plnRemoveCompletedReportTriggerV140_(spreadsheetId);
  } catch (error) {
    console.warn('COMPLETED_TRIGGER_CLEANUP_FAILED: ' + error.message);
  }

  return {
    ok: true,
    status: 'COMPLETED',
    file_id: spreadsheetId,
    final_pdf_id: finalPdfId,
    pdf_url: pdfFile.getUrl()
  };
}


// ============================================================
// 21. DUPLICATE PREVIEW
// ============================================================

function plnAnalyzeDuplicatesV138() {
  const records = plnBankRows_();
  const groups = new Map();

  records.forEach(record => {
    if (record.status !== 'VALID') return;

    let period;
    try {
      period = plnPeriod_(record.dueMonth, record.dueYear);
    } catch (_) {
      return;
    }

    const key = record.customerId + '|' + plnPeriodKey_(period);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  });

  const duplicates = [];
  const conflicts = [];

  groups.forEach((items, key) => {
    if (items.length <= 1) return;

    items.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return tb - ta || b.rowNumber - a.rowNumber;
    });

    const signatures = new Set(items.map(plnRecordSignature_));
    if (signatures.size > 1) {
      conflicts.push({
        key,
        rows: items.map(item => item.rowNumber)
      });
      return;
    }

    duplicates.push(...items.slice(1));
  });

  return {
    total: records.length,
    duplicateCount: duplicates.length,
    conflictCount: conflicts.length,
    duplicates,
    conflicts
  };
}

function plnPreviewDuplicatesV138() {
  const result = plnAnalyzeDuplicatesV138();
  const summary = {
    total: result.total,
    duplicateCount: result.duplicateCount,
    conflictCount: result.conflictCount,
    conflicts: result.conflicts
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}


// ============================================================
// 22. MANUAL DUPLICATE CLEANUP
// ============================================================

function plnCleanupDuplicatesV138() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('CLEANUP_LOCK_BUSY');
  }

  try {
    const ss = plnMaster_();
    const bank = ss.getSheetByName(PLN_CONFIG.BANK_SHEET);
    const analysis = plnAnalyzeDuplicatesV138();

    if (analysis.duplicateCount === 0) {
      return {
        ok: true,
        archived: 0,
        deleted: 0,
        conflicts: analysis.conflicts
      };
    }

    let archive = ss.getSheetByName(PLN_CONFIG.ARCHIVE_SHEET);
    if (!archive) {
      archive = ss.insertSheet(PLN_CONFIG.ARCHIVE_SHEET);
    }

    if (archive.getLastRow() === 0) {
      const headers = bank.getRange(1, 1, 1, 14).getValues()[0];
      archive.getRange(1, 1, 1, 17).setValues([
        headers.concat(['Archived At', 'Original Row', 'Duplicate Key'])
      ]);
    }

    const archiveRows = analysis.duplicates.map(record => {
      const period = plnPeriod_(record.dueMonth, record.dueYear);
      return record.raw.concat([
        new Date(),
        record.rowNumber,
        record.customerId + '|' + plnPeriodKey_(period)
      ]);
    });

    const before = archive.getLastRow();
    archive.getRange(before + 1, 1, archiveRows.length, 17).setValues(archiveRows);
    SpreadsheetApp.flush();

    if (archive.getLastRow() - before !== archiveRows.length) {
      throw new Error('ARCHIVE_VERIFICATION_FAILED');
    }

    const deleteRows = analysis.duplicates
      .map(record => record.rowNumber)
      .sort((a, b) => b - a);

    deleteRows.forEach(row => {
      bank.deleteRow(row);
    });

    return {
      ok: true,
      archived: archiveRows.length,
      deleted: deleteRows.length,
      conflicts: analysis.conflicts
    };
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// 23. TEMPLATE VALIDATION
// ============================================================

function plnValidateTemplatesV138() {
  const master = plnMaster_();
  const results = [];

  Object.keys(PLN_CUSTOMERS).forEach(customerId => {
    const customer = plnCustomer_(customerId);
    const tn = master.getSheetByName(customer.paymentTemplate);
    const comparison = master.getSheetByName(customer.comparisonTemplate);

    const result = {
      customer_id: customerId,
      customer: customer.name,
      tn_exists: !!tn,
      comparison_exists: !!comparison,
      rows: null,
      valid: false
    };

    if (tn && comparison) {
      try {
        result.rows = plnFindPaymentRows_(tn);
        result.valid = true;
      } catch (error) {
        result.error = String(error.message);
      }
    }

    results.push(result);
  });

  console.log(JSON.stringify(results, null, 2));
  return results;
}


// ============================================================
// 24. HEALTH CHECK
// ============================================================

function plnHealthCheckV138() {
  const templates = plnValidateTemplatesV138();
  const records = plnBankRows_();

  const result = {
    ok: templates.every(t => t.valid),
    version: PLN_CONFIG.VERSION,
    customer_count: Object.keys(PLN_CUSTOMERS).length,
    bank_records: records.length,
    valid_records: records.filter(r => r.status === 'VALID').length,
    templates_valid: templates.every(t => t.valid),
    report_folder_configured: !!plnOutputFolderId_(),
    report_secret_configured: !!plnReportSecret_(),
    finalize_token_configured: !!plnFinalizeToken_(),
    finalize_webhook_configured: !!plnFinalizeUrl_()
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}


// ============================================================
// 25. WEB APP POST
// ============================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('EMPTY_REQUEST_BODY');
    }

    const body = JSON.parse(e.postData.contents);

    if (String(body.secret || '') !== plnReportSecret_()) {
      return plnJson_({
        ok: false,
        status: 'UNAUTHORIZED'
      });
    }

    const action = String(body.action || 'create_report').trim().toLowerCase();
    let result;

    switch (action) {
      case 'create_report':
      case 'generate_report':
        result = plnCreateReportV138(body);
        break;

      case 'prepare_pdf':
        result = plnPreparePdfV138(
          String(body.file_id || body.sheet_id || '')
        );
        break;

      case 'finalize_pdf':
        result = plnFinalizeReportV138(
          String(body.file_id || body.sheet_id || ''),
          String(body.final_pdf_id || body.pdf_file_id || '')
        );
        break;

      default:
        throw new Error('UNKNOWN_ACTION: ' + action);
    }

    return plnJson_(result);

  } catch (error) {
    console.error(error);
    return plnJson_(plnError_(error));
  }
}


// ============================================================
// 26. WEB APP GET
// ============================================================

function doGet() {
  return plnJson_({
    ok: true,
    application: 'PLN AUTO REPORT',
    version: PLN_CONFIG.VERSION,
    status: 'WEB_APP_RUNNING',
    customers: Object.keys(PLN_CUSTOMERS).length
  });
}
