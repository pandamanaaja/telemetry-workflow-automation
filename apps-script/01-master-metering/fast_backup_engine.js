/**
 * =========================================================================
 * HIGH-PERFORMANCE IN-MEMORY BACKUP & RETENTION ENGINE
 * =========================================================================
 * Copies matching historical records from source sheet to backup sheet
 * and cleans up transferred rows in a single batch operation.
 * Eliminates API timeouts associated with row-by-row deletions.
 */

const BACKUP_CONFIG = {
  SOURCE_SPREADSHEET_ID: "YOUR_SOURCE_SPREADSHEET_ID",
  TARGET_SPREADSHEET_ID: "YOUR_TARGET_SPREADSHEET_ID",
  SHEET_NAME: "Master Metering"
};

/**
 * Trigger manual backup by custom date range
 */
function runManualBackupByCustomDate() {
  const START_DATE_STR = "2026-08-01";
  const END_DATE_STR = "2026-08-01";

  const startDate = new Date(START_DATE_STR);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(END_DATE_STR);
  endDate.setHours(23, 59, 59, 999);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    SpreadsheetApp.getUi().alert("Invalid Date Format! Use YYYY-MM-DD.");
    return;
  }

  processBackupData((rowDate) => {
    return rowDate >= startDate && rowDate <= endDate;
  }, `Manual Backup: ${START_DATE_STR} to ${END_DATE_STR}`);
}

/**
 * Trigger manual backup by custom month & year
 */
function runManualBackupByCustomMonth() {
  const MONTH = 8;    // 1 - 12 (e.g. 8 for August)
  const YEAR = 2026;

  const monthIndex = MONTH - 1;

  processBackupData((rowDate) => {
    return rowDate.getMonth() === monthIndex && rowDate.getFullYear() === YEAR;
  }, `Manual Backup: Month ${MONTH}/${YEAR}`);
}

/**
 * Automated backup: archives data from 2 months prior
 */
function backupTwoMonthsPriorData() {
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const targetMonth = targetDate.getMonth();
  const targetYear = targetDate.getFullYear();

  processBackupData(
    (rowDate) => {
      return rowDate.getMonth() === targetMonth && rowDate.getFullYear() === targetYear;
    },
    `Automated Backup 2 Months Prior (${targetDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })})`,
    true
  );
}

/**
 * Core Batch Processing Engine (In-Memory Filtering)
 * Avoids deleteRow loop overhead by rewriting retained data in one setValues call.
 */
function processBackupData(filterCriteria, titleInfo, isStrict = false) {
  const ui = SpreadsheetApp.getUi();

  try {
    const srcSpreadsheet = SpreadsheetApp.openById(BACKUP_CONFIG.SOURCE_SPREADSHEET_ID);
    const srcSheet = srcSpreadsheet.getSheetByName(BACKUP_CONFIG.SHEET_NAME);

    const tgtSpreadsheet = SpreadsheetApp.openById(BACKUP_CONFIG.TARGET_SPREADSHEET_ID);
    let tgtSheet = tgtSpreadsheet.getSheetByName(BACKUP_CONFIG.SHEET_NAME);

    if (!srcSheet) {
      ui.alert(`Sheet "${BACKUP_CONFIG.SHEET_NAME}" not found in source spreadsheet.`);
      return;
    }

    if (!tgtSheet) {
      tgtSheet = tgtSpreadsheet.insertSheet(BACKUP_CONFIG.SHEET_NAME);
    }

    const lastRow = srcSheet.getLastRow();
    const lastCol = srcSheet.getLastColumn();

    if (lastRow < 2) {
      ui.alert("Notice: No data rows available in Source Sheet.");
      return;
    }

    const headers = srcSheet.getRange(1, 1, 1, lastCol).getValues()[0];

    let timestampColIdx = -1;
    for (let c = 0; c < lastCol; c++) {
      const h = String(headers[c]).toLowerCase();
      if (h.includes("timestamp") || h.includes("stempel") || h.includes("waktu") || h.includes("date")) {
        timestampColIdx = c;
        break;
      }
    }

    if (timestampColIdx === -1) {
      ui.alert("Timestamp header not found in Source Sheet.");
      return;
    }

    if (tgtSheet.getLastRow() === 0) {
      tgtSheet.appendRow(headers);
    }

    const data = srcSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const rowsToBackup = [];
    const rowsToKeep = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rawDate = row[timestampColIdx];

      let isMatch = false;
      if (rawDate) {
        const rowDate = new Date(rawDate);
        if (!isNaN(rowDate.getTime()) && filterCriteria(rowDate)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        rowsToBackup.push(row);
      } else {
        rowsToKeep.push(row);
      }
    }

    if (rowsToBackup.length === 0) {
      if (isStrict) {
        ui.alert(`No data found matching: "${titleInfo}". Operation aborted.`);
      } else {
        ui.alert(`${titleInfo}\n\nCompleted: No rows matched filter criteria.`);
      }
      return;
    }

    // 1. Batch append to target backup sheet
    const tgtStartRow = tgtSheet.getLastRow() + 1;
    tgtSheet.getRange(tgtStartRow, 1, rowsToBackup.length, lastCol).setValues(rowsToBackup);

    // 2. Batch rewrite source sheet with retained rows (Instant performance)
    srcSheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();

    if (rowsToKeep.length > 0) {
      srcSheet.getRange(2, 1, rowsToKeep.length, lastCol).setValues(rowsToKeep);
    }

    ui.alert(
      `${titleInfo} Successful!\n\n` +
      `- Rows moved to backup: ${rowsToBackup.length}\n` +
      `- Destination row start: ${tgtStartRow}\n` +
      `- Retained rows in source: ${rowsToKeep.length}`
    );

  } catch (e) {
    ui.alert("Backup Engine Exception: " + e.message);
  }
}
