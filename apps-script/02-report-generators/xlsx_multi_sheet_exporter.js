/**
 * =========================================================================
 * AUTOMATED MULTI-SHEET XLSX EXPORTER & DRIVE DISTRIBUTOR
 * =========================================================================
 * Automatically generates standalone XLSX files from daily/weekly/monthly
 * report sheets, strips volatile formulas (values-only mode), and uploads
 * to designated Google Drive distribution folders.
 */

const XLSX_CONFIG = {
  SPREADSHEET_ID: "YOUR_SOURCE_SPREADSHEET_ID",
  EXPORT_FOLDER_PRIMARY: "YOUR_PRIMARY_EXPORT_FOLDER_ID",
  EXPORT_FOLDER_SECONDARY: "YOUR_SECONDARY_EXPORT_FOLDER_ID",
  TIMEZONE: "Asia/Jakarta",
  MIN_EXPORT_ROWS: 251,
  MIN_EXPORT_COLS: 15,
  EXPORT_VALUES_ONLY: true // Converts formulas to evaluated values in output file
};

// Check & status verification cells
const STATUS_CELLS = {
  DAILY: { check: "O249", status: "O251" },
  WEEKLY: { check: "J249", status: "J251" },
  MONTHLY: { check: "H249", status: "H251" }
};

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

/**
 * Trigger: Daily timer (08:00 - 09:00 AM)
 * Exports yesterday's daily sheet
 */
function exportYesterdayAt8AM() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const sheet = findDailySheetByDate(yesterday);
  if (!sheet) {
    Logger.log("Yesterday's daily sheet not found.");
    return;
  }

  exportIfReady(sheet, STATUS_CELLS.DAILY.check, STATUS_CELLS.DAILY.status);
}

/**
 * Trigger: Weekly Sunday timer (05:00 - 06:00 AM)
 * Exports the previous week's sheet
 */
function exportWeeklySundayAt5AM() {
  const reportDate = new Date();
  reportDate.setDate(reportDate.getDate() - 7);

  const weekNum = Math.ceil(reportDate.getDate() / 7);
  const month = reportDate.getMonth() + 1;
  const year = reportDate.getFullYear();
  const monthName = MONTH_NAMES[reportDate.getMonth()];
  const paddedMonth = String(month).padStart(2, "0");

  const candidates = [
    `MINGGU ${weekNum}/${month}/${year}`,
    `MINGGU ${weekNum}/${paddedMonth}/${year}`,
    `Minggu ${weekNum} ${monthName} ${year}`
  ];

  const sheet = findSheetByPossibleNames(candidates);
  if (!sheet) {
    Logger.log("Weekly sheet not found.");
    return;
  }

  exportIfReady(sheet, STATUS_CELLS.WEEKLY.check, STATUS_CELLS.WEEKLY.status);
}

/**
 * Trigger: Monthly timer on 1st day (08:00 - 09:00 AM)
 * Exports previous month's sheet
 */
function exportMonthlyOnFirstDay() {
  const prevDate = new Date();
  prevDate.setDate(1);
  prevDate.setMonth(prevDate.getMonth() - 1);

  const monthName = MONTH_NAMES[prevDate.getMonth()];
  const year = prevDate.getFullYear();

  const candidates = [
    `${monthName} ${year}`,
    `Bulan ${monthName} ${year}`
  ];

  const sheet = findSheetByPossibleNames(candidates);
  if (!sheet) {
    Logger.log("Monthly sheet not found.");
    return;
  }

  exportIfReady(sheet, STATUS_CELLS.MONTHLY.check, STATUS_CELLS.MONTHLY.status);
}

function exportIfReady(sheet, checkCell, statusCell) {
  const checkValue = sheet.getRange(checkCell).getValue();
  const status = String(sheet.getRange(statusCell).getValue()).trim().toUpperCase();

  if (!checkValue) {
    Logger.log("Check cell is empty: " + sheet.getName());
    return;
  }

  if (status === "EXPORTED" || status === "EXPORTED_MANUAL") {
    Logger.log("Sheet already exported previously: " + sheet.getName());
    return;
  }

  exportSingleSheet(sheet);
  sheet.getRange(statusCell).setValue("EXPORTED");
  Logger.log("Export complete: " + sheet.getName());
}

function findDailySheetByDate(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const year = dateObj.getFullYear();

  return findSheetByPossibleNames([
    `${dateObj.getDate()}/${dateObj.getMonth() + 1}/${year}`,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`
  ]);
}

function findSheetByPossibleNames(names) {
  const ss = SpreadsheetApp.openById(XLSX_CONFIG.SPREADSHEET_ID);
  for (const name of names) {
    const sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }
  return null;
}

/**
 * Generates an isolated XLSX file from target sheet and saves to Drive
 */
function exportSingleSheet(sourceSheet) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error("Another export process is currently active.");
  }

  let tempFileId = null;

  try {
    const exportRows = Math.min(sourceSheet.getMaxRows(), Math.max(sourceSheet.getLastRow(), XLSX_CONFIG.MIN_EXPORT_ROWS));
    const exportCols = Math.min(sourceSheet.getMaxColumns(), Math.max(sourceSheet.getLastColumn(), XLSX_CONFIG.MIN_EXPORT_COLS));

    const sourceRange = sourceSheet.getRange(1, 1, exportRows, exportCols);
    const sourceValues = XLSX_CONFIG.EXPORT_VALUES_ONLY ? sourceRange.getValues() : null;

    const safeSheetName = sourceSheet.getName().replace(/[\/\\:*?"<>|]/g, "-");
    const timestamp = Utilities.formatDate(new Date(), XLSX_CONFIG.TIMEZONE, "yyyy-MM-dd_HH-mm");
    const fileName = `Report_${safeSheetName}_${timestamp}`;

    // 1. Create temporary spreadsheet container
    const tempSS = SpreadsheetApp.create(fileName);
    tempFileId = tempSS.getId();

    const copiedSheet = sourceSheet.copyTo(tempSS);
    tempSS.getSheets().forEach(s => {
      if (s.getSheetId() !== copiedSheet.getSheetId()) tempSS.deleteSheet(s);
    });
    copiedSheet.setName(safeSheetName);

    if (XLSX_CONFIG.EXPORT_VALUES_ONLY) {
      copiedSheet.getDataRange().breakApart();
      copiedSheet.getRange(1, 1, exportRows, exportCols).setValues(sourceValues);
    }

    SpreadsheetApp.flush();
    Utilities.sleep(1200);

    // 2. Fetch converted XLSX blob from Google export endpoint
    const exportUrl = `https://docs.google.com/spreadsheets/d/${tempFileId}/export?format=xlsx`;
    const response = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`XLSX export failed. HTTP ${response.getResponseCode()}`);
    }

    const blob = response.getBlob().setName(fileName + ".xlsx");

    // 3. Distribute to Primary and Secondary Google Drive folders
    DriveApp.getFolderById(XLSX_CONFIG.EXPORT_FOLDER_PRIMARY).createFile(blob);
    DriveApp.getFolderById(XLSX_CONFIG.EXPORT_FOLDER_SECONDARY).createFile(blob);

    Logger.log(`XLSX generated and distributed: ${fileName}.xlsx`);

  } finally {
    if (tempFileId) {
      try {
        DriveApp.getFileById(tempFileId).setTrashed(true);
      } catch (_) {}
    }
    lock.releaseLock();
  }
}
