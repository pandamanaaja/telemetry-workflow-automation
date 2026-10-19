// =====================================================
// KONFIGURASI UTAMA
// =====================================================
const SPREADSHEET_ID = "YOUR_SOURCE_SPREADSHEET_ID";

// Folder ID target ekspor (Mendukung lebih dari 1 folder)
const EXPORT_FOLDER_IDS = [
  "YOUR_PRIMARY_EXPORT_FOLDER_ID",
  "YOUR_SECONDARY_EXPORT_FOLDER_ID"
];

const TIMEZONE = "Asia/Jakarta";
const EXPORT_VALUES_ONLY = true;

// =====================================================
// SEL PEMERIKSAAN DAN STATUS
// =====================================================

// HARIAN
const DAILY_CHECK_CELL = "O249";
const DAILY_STATUS_CELL = "O251";

// MINGGUAN
const WEEKLY_CHECK_CELL = "J249";
const WEEKLY_STATUS_CELL = "J251";

// BULANAN
const MONTHLY_CHECK_CELL = "H249";
const MONTHLY_STATUS_CELL = "H251";

const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember"
];

// =====================================================
// MENU SPREADSHEET
// =====================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Export Laporan")
    .addItem("Export Sheet Aktif", "manualExportActiveSheet")
    .addSeparator()
    .addItem("Export Harian Kemarin (Yesterday)", "manualExportYesterday")
    .addItem("Export Harian Manual (Sheet Aktif)", "manualExportDailyByName")
    .addItem("Export Mingguan Manual (Sheet Aktif)", "manualExportWeeklyByName")
    .addItem("Export Bulanan Manual (Sheet Aktif)", "manualExportMonthlyByName")
    .addToUi();
}

// =====================================================
// EXPORT HARIAN MANUAL LEWAT MENU UI (SHEET KEMARIN)
// =====================================================
function manualExportYesterday() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Hitung tanggal kemarin WIB
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  ss.toast("Mencari sheet kemarin...", "Export Harian", 5);
  const sheet = findDailySheetByDate(yesterday);

  if (!sheet) {
    ui.alert("Gagal: Sheet harian untuk tanggal kemarin tidak ditemukan.");
    return;
  }

  try {
    ss.toast(`Sedang mengekspor sheet: ${sheet.getName()}...`, "Proses Export", 10);
    const fileName = exportSingleSheet(sheet);
    sheet.getRange(DAILY_STATUS_CELL).setValue("EXPORTED_MANUAL");
    ui.alert(`Export Berhasil!\n\nSheet: ${sheet.getName()}\nFile: ${fileName}.xlsx telah tersimpan di folder target.`);
  } catch (err) {
    ui.alert(`Export Gagal: ${err.message}`);
  }
}

// =====================================================
// EXPORT HARIAN OTOMATIS (TRIGGER TIMER)
// Trigger: Day timer, pukul 08:00 - 09:00
// Export sheet tanggal kemarin
// =====================================================
function exportYesterdayAt8AM() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const sheet = findDailySheetByDate(yesterday);

  if (!sheet) {
    Logger.log("Sheet harian kemarin tidak ditemukan.");
    return;
  }

  exportIfReady(
    sheet,
    DAILY_CHECK_CELL,
    DAILY_STATUS_CELL
  );
}

// =====================================================
// EXPORT MINGGUAN OTOMATIS (TRIGGER TIMER)
// Trigger: Week timer, hari Minggu pukul 05:00 - 06:00
// =====================================================
function exportWeeklySundayAt5AM() {
  const reportDate = new Date();
  reportDate.setDate(reportDate.getDate() - 7);

  const weekNumber = getWeekOfMonth(reportDate);
  const month = reportDate.getMonth() + 1;
  const year = reportDate.getFullYear();
  const monthName = MONTH_NAMES_ID[reportDate.getMonth()];
  const paddedMonth = String(month).padStart(2, "0");

  const possibleSheetNames = [
    `MINGGU ${weekNumber} /${month}/${year}`,
    `MINGGU ${weekNumber}/${month}/${year}`,
    `MINGGU ${weekNumber} /${paddedMonth}/${year}`,
    `MINGGU ${weekNumber}/${paddedMonth}/${year}`,

    `Minggu ${weekNumber} /${month}/${year}`,
    `Minggu ${weekNumber}/${month}/${year}`,
    `Minggu ${weekNumber} /${paddedMonth}/${year}`,
    `Minggu ${weekNumber}/${paddedMonth}/${year}`,

    `minggu ${weekNumber} /${month}/${year}`,
    `minggu ${weekNumber}/${month}/${year}`,
    `minggu ${weekNumber} /${paddedMonth}/${year}`,
    `minggu ${weekNumber}/${paddedMonth}/${year}`,

    `MINGGU ${weekNumber}-${month}-${year}`,
    `Minggu ${weekNumber}-${month}-${year}`,
    `minggu ${weekNumber}-${month}-${year}`,

    `MINGGU ${weekNumber} ${monthName} ${year}`,
    `Minggu ${weekNumber} ${monthName} ${year}`,
    `minggu ${weekNumber} ${monthName} ${year}`
  ];

  const sheet = findSheetByPossibleNames(possibleSheetNames);

  if (!sheet) {
    Logger.log("Sheet mingguan tidak ditemukan.");
    return;
  }

  exportIfReady(
    sheet,
    WEEKLY_CHECK_CELL,
    WEEKLY_STATUS_CELL
  );
}

// =====================================================
// EXPORT BULANAN OTOMATIS (TRIGGER TIMER)
// Trigger: Month timer, tanggal 1 pukul 08:00 - 09:00
// =====================================================
function exportMonthlyOnFirstDay() {
  const previousMonthDate = new Date();
  previousMonthDate.setDate(1);
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);

  const month = previousMonthDate.getMonth() + 1;
  const year = previousMonthDate.getFullYear();
  const monthName = MONTH_NAMES_ID[previousMonthDate.getMonth()];
  const paddedMonth = String(month).padStart(2, "0");

  const possibleSheetNames = [
    `${monthName} ${year}`,
    `Bulan ${monthName} ${year}`,
    `${month}/${year}`,
    `${paddedMonth}/${year}`,
    `${month}-${year}`,
    `${paddedMonth}-${year}`
  ];

  const sheet = findSheetByPossibleNames(possibleSheetNames);

  if (!sheet) {
    Logger.log("Sheet bulanan tidak ditemukan.");
    return;
  }

  exportIfReady(
    sheet,
    MONTHLY_CHECK_CELL,
    MONTHLY_STATUS_CELL
  );
}

// =====================================================
// EXPORT MANUAL SHEET AKTIF
// =====================================================
function manualExportActiveSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  exportSingleSheet(sheet);
}

function manualExportDailyByName() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  exportSingleSheet(sheet);
  sheet.getRange(DAILY_STATUS_CELL).setValue("EXPORTED_MANUAL");
}

function manualExportWeeklyByName() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  exportSingleSheet(sheet);
  sheet.getRange(WEEKLY_STATUS_CELL).setValue("EXPORTED_MANUAL");
}

function manualExportMonthlyByName() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  exportSingleSheet(sheet);
  sheet.getRange(MONTHLY_STATUS_CELL).setValue("EXPORTED_MANUAL");
}

// =====================================================
// PEMERIKSAAN SEBELUM EXPORT (UNTUK TIMER OTOMATIS)
// =====================================================
function exportIfReady(sheet, checkCell, statusCell) {
  const checkValue = sheet.getRange(checkCell).getValue();
  const status = String(sheet.getRange(statusCell).getValue()).trim().toUpperCase();

  if (checkValue === "" || checkValue === null) {
    Logger.log("Check cell kosong: " + sheet.getName());
    return;
  }

  if (status === "EXPORTED" || status === "EXPORTED_MANUAL") {
    Logger.log("Sheet sudah pernah diexport: " + sheet.getName());
    return;
  }

  exportSingleSheet(sheet);
  sheet.getRange(statusCell).setValue("EXPORTED");
  Logger.log("Export berhasil: " + sheet.getName());
}

// =====================================================
// MENCARI SHEET HARIAN BERDASARKAN TANGGAL
// =====================================================
function findDailySheetByDate(dateObj) {
  const day = Utilities.formatDate(dateObj, TIMEZONE, "d");
  const paddedDay = Utilities.formatDate(dateObj, TIMEZONE, "dd");
  const month = Utilities.formatDate(dateObj, TIMEZONE, "M");
  const paddedMonth = Utilities.formatDate(dateObj, TIMEZONE, "MM");
  const year = Utilities.formatDate(dateObj, TIMEZONE, "yyyy");
  const monthIndex = parseInt(month, 10) - 1;
  const monthName = MONTH_NAMES_ID[monthIndex] || "";

  const possibleSheetNames = [
    `${day}/${month}/${year}`,
    `${paddedDay}/${paddedMonth}/${year}`,
    `${day}-${month}-${year}`,
    `${paddedDay}-${paddedMonth}-${year}`,
    `${day} ${monthName} ${year}`,
    `${paddedDay} ${monthName} ${year}`,
    `${day}`
  ];

  return findSheetByPossibleNames(possibleSheetNames);
}

// =====================================================
// MENCARI SHEET DARI BEBERAPA KEMUNGKINAN NAMA
// =====================================================
function findSheetByPossibleNames(possibleSheetNames) {
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  // 1. Pencarian cepat (Exact Match)
  for (const name of possibleSheetNames) {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      Logger.log("Sheet ditemukan: " + name);
      return sheet;
    }
  }

  // 2. Pencarian toleran spasi dan huruf besar-kecil (Fuzzy Match)
  const allSheets = ss.getSheets();
  const normalizedTargets = possibleSheetNames.map(n => n.trim().toLowerCase());

  for (const s of allSheets) {
    const sName = s.getName().trim().toLowerCase();
    if (normalizedTargets.includes(sName)) {
      Logger.log("Sheet ditemukan (Fuzzy Match): " + s.getName());
      return s;
    }
  }

  Logger.log("Sheet tidak ditemukan. Nama yang dicari: " + possibleSheetNames.join(", "));
  return null;
}

function getWeekOfMonth(dateObj) {
  return Math.ceil(dateObj.getDate() / 7);
}

// =====================================================
// EXPORT SATU SHEET MENJADI FILE XLSX (HIGH PERFORMANCE)
// =====================================================
function exportSingleSheet(sourceSheet) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error("Export lain sedang berjalan. Coba kembali beberapa saat lagi.");
  }

  let tempFileId = null;

  try {
    const safeSheetName = sourceSheet.getName().replace(/[\/\\:*?"<>|]/g, "-");
    const timestamp = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd_HH-mm");
    const fileName = `Laporan_${safeSheetName}_${timestamp}`;

    Logger.log("Memulai Export: " + fileName);

    // 1. Ambil data HANYA sebatas baris & kolom yang terisi
    const lastRow = Math.max(sourceSheet.getLastRow(), 1);
    const lastCol = Math.max(sourceSheet.getLastColumn(), 1);

    let displayValues = null;
    if (EXPORT_VALUES_ONLY) {
      displayValues = sourceSheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    }

    // 2. Buat spreadsheet sementara
    const tempSS = SpreadsheetApp.create("TEMP_" + fileName);
    tempFileId = tempSS.getId();

    // 3. Salin sheet asal ke spreadsheet sementara
    const copiedSheet = sourceSheet.copyTo(tempSS);
    copiedSheet.setName(safeSheetName);

    // 4. Hapus sheet bawaan "Sheet1"
    const defaultSheet = tempSS.getSheets()[0];
    if (defaultSheet.getSheetId() !== copiedSheet.getSheetId()) {
      tempSS.deleteSheet(defaultSheet);
    }

    // 5. Timpa rumus dengan teks mati hanya pada area data riil
    if (EXPORT_VALUES_ONLY && displayValues && displayValues.length > 0) {
      copiedSheet
        .getRange(1, 1, lastRow, lastCol)
        .setValues(displayValues);
    }

    // 6. [KUNCI PERBAIKAN TIMEOUT]: Pangkas baris & kolom kosong berlebih
    // Menghapus ribuan baris kosong membuat ukuran file XLSX kecil dan
    // proses render Google Docs selesai dalam 1-3 detik.
    const maxRows = copiedSheet.getMaxRows();
    const maxCols = copiedSheet.getMaxColumns();

    if (maxRows > lastRow) {
      copiedSheet.deleteRows(lastRow + 1, maxRows - lastRow);
    }
    if (maxCols > lastCol) {
      copiedSheet.deleteColumns(lastCol + 1, maxCols - lastCol);
    }

    SpreadsheetApp.flush();

    // 7. Unduh file sebagai XLSX
    const exportUrl = `https://docs.google.com/spreadsheets/d/${tempFileId}/export?format=xlsx`;

    const response = UrlFetchApp.fetch(exportUrl, {
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken()
      },
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      throw new Error(
        `Gagal membuat file XLSX. HTTP ${responseCode}: ${response.getContentText().slice(0, 300)}`
      );
    }

    const blob = response.getBlob().setName(`${fileName}.xlsx`);

    // 8. Simpan ke folder target Google Drive
    EXPORT_FOLDER_IDS.forEach(folderId => {
      try {
        DriveApp.getFolderById(folderId).createFile(blob);
        Logger.log(`File berhasil dikirim ke folder ID: ${folderId}`);
      } catch (err) {
        Logger.log(`Gagal mengirim ke folder ID ${folderId}: ${err.message}`);
      }
    });

    Logger.log(`Export selesai: ${fileName}.xlsx`);
    return fileName;

  } catch (error) {
    Logger.log("Export gagal: " + error.message);
    throw error;

  } finally {
    // 9. Bersihkan file spreadsheet sementara
    if (tempFileId) {
      try {
        DriveApp.getFileById(tempFileId).setTrashed(true);
      } catch (cleanupError) {
        Logger.log("Gagal menghapus file sementara: " + cleanupError.message);
      }
    }
    lock.releaseLock();
  }
}
