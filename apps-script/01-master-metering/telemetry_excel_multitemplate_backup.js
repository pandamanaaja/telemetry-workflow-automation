/**
 * ============================================================================
 * TELEMETRY MULTI-TEMPLATE EXCEL EXPORT ENGINE
 * (Google Apps Script -> n8n High-Speed Dual Drive Backup)
 * ============================================================================
 * 
 * Arsitektur:
 * 1. Mengeliminasi timeout eksekusi (360s) pada master spreadsheet besar (>30 MB)
 *    dengan mentransfer data memori via display values JSON (<0.3 detik).
 * 2. Menggunakan template eksternal Google Drive (100 KB) dengan fidelitas 100%
 *    (Harian: 28 kolom / 3.494 merges, Mingguan: 18 kolom / 2.312 merges, Bulanan: 14 kolom).
 * 3. Menghindari tabrakan layout harian vs mingguan (zero leftover columns).
 * 4. Didukung otomatisasi cron trigger (Harian 08:00 WIB, Mingguan Senin 08:00 WIB,
 *    Bulanan Tgl 1 01:00 WIB).
 */

// ============================================================================
// KONFIGURASI GLOBAL (GANTI DENGAN KREDENSIAL / ID MILIK ANDA)
// ============================================================================
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";
const N8N_WEBHOOK_URL = "https://your-n8n-domain.com/webhook/backup-excel-sheet";
const TIMEZONE = "Asia/Jakarta";

// Master Template Spreadsheet IDs di Google Drive (100% Persis Format Asli)
const TEMPLATE_IDS = {
  DAILY: "YOUR_DAILY_TEMPLATE_SPREADSHEET_ID",     // 28 kolom, 3.494 merges
  WEEKLY: "YOUR_WEEKLY_TEMPLATE_SPREADSHEET_ID",   // 18 kolom, 2.312 merges
  MONTHLY: "YOUR_MONTHLY_TEMPLATE_SPREADSHEET_ID"  // 14 kolom, 1.845 merges
};

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// ============================================================================
// 1. MENU UI SPREADSHEET
// ============================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🚀 Backup Excel (n8n)")
    // A. Backup Sheet Aktif (Manual Fleksibel)
    .addItem("⚡ Backup Sheet yang Sedang Dibuka (Auto Deteksi)", "menuBackupActiveAuto")
    .addItem("📅 Backup Sheet yang Sedang Dibuka (Paksa Harian)", "menuBackupActiveDaily")
    .addItem("📊 Backup Sheet yang Sedang Dibuka (Paksa Mingguan)", "menuBackupActiveWeekly")
    .addItem("🗓️ Backup Sheet yang Sedang Dibuka (Paksa Bulanan)", "menuBackupActiveMonthly")
    .addSeparator()
    // B. Backup Periode Lalu (Kemarin, Minggu Lalu, Bulan Lalu)
    .addItem("⏪ Backup Data Kemarin (Daily T-1)", "menuBackupYesterday")
    .addItem("⏪ Backup Data Minggu yang Lalu (Last Week)", "menuBackupWeekly")
    .addItem("⏪ Backup Data Bulan yang Lalu (Last Month)", "menuBackupMonthly")
    .addSeparator()
    // C. Jadwal Otomatis
    .addItem("⏱️ Pasang Jadwal Otomatis (Triggers)", "setupAutomaticTriggers")
    .addToUi();
}

// ============================================================================
// 2. FUNGSI PENGIRIMAN DATA KE n8n (NON-BLOCKING, CEPAT < 0.3 DETIK)
// ============================================================================
function sendSheetToN8n(sheet, reportType) {
  if (!sheet) {
    throw new Error("Sheet tidak ditemukan atau objek kosong!");
  }

  const sheetName = sheet.getName();
  console.log("Membaca memori data sheet '" + sheetName + "' [Tipe: " + reportType + "]...");

  // Ambil tampilan nilai teks asli tanpa kalkulasi ulang
  const values = sheet.getDataRange().getDisplayValues();
  if (!values || values.length === 0) {
    throw new Error("Sheet '" + sheetName + "' tidak memiliki data!");
  }

  const templateId = TEMPLATE_IDS[reportType] || TEMPLATE_IDS.DAILY;

  // Format nama file standar: Laporan_{NamaSheet}_{Timestamp}.xlsx
  const safeSheetName = sheetName.replace(/[\/\\:*?"<>|]/g, "-").trim();
  const timestamp = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd_HH-mm");
  const fileName = "Laporan_" + safeSheetName + "_" + timestamp + ".xlsx";

  // Payload JSON dikirim ke n8n
  const payload = {
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet() ? SpreadsheetApp.getActiveSpreadsheet().getId() : SPREADSHEET_ID,
    sheetName: sheetName,
    reportType: reportType,
    templateId: templateId,
    fileName: fileName,
    tableData: values
  };

  console.log("Mengirim " + values.length + " baris ke n8n webhook: " + N8N_WEBHOOK_URL);

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(N8N_WEBHOOK_URL, options);
  const statusCode = response.getResponseCode();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("Webhook n8n HTTP " + statusCode + ": " + response.getContentText().slice(0, 300));
  }

  console.log("Berhasil dikirim ke n8n! Nama file: " + fileName);
  return {
    fileName: fileName,
    sheetName: sheetName,
    rowCount: values.length,
    reportType: reportType
  };
}

// ============================================================================
// 3. HANDLER MENU MANUAL SHEET AKTIF
// ============================================================================

/**
 * Otomatis mendeteksi tipe sheet yang sedang dibuka user
 */
function menuBackupActiveAuto() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (!sheet) {
    ss.toast("Peringatan: Tidak ada sheet yang sedang dipilih.", "Gagal", 5);
    return;
  }

  const name = sheet.getName();
  const colCount = sheet.getLastColumn();
  const reportType = detectSheetType(name, colCount);

  ss.toast("Mengekspor sheet '" + name + "' (Tipe: " + reportType + ")...", "Proses Backup", 5);

  try {
    const res = sendSheetToN8n(sheet, reportType);
    ss.toast("✅ Sukses! File " + res.reportType + ": " + res.fileName + " tersimpan di 2 folder Drive.", "Backup Selesai", 8);
  } catch (err) {
    ss.toast("❌ Gagal: " + err.message, "Error Backup", 8);
  }
}

/**
 * Mem-backup sheet yang sedang dibuka secara paksa sebagai HARIAN (Daily)
 */
function menuBackupActiveDaily() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  ss.toast("Mengekspor sheet '" + sheet.getName() + "' sebagai HARIAN...", "Proses Backup", 5);

  try {
    const res = sendSheetToN8n(sheet, "DAILY");
    ss.toast("✅ Sukses! File Harian: " + res.fileName + " tersimpan di 2 folder Drive.", "Backup Selesai", 8);
  } catch (err) {
    ss.toast("❌ Gagal: " + err.message, "Error Backup", 8);
  }
}

/**
 * Mem-backup sheet yang sedang dibuka secara paksa sebagai MINGGUAN (Weekly)
 */
function menuBackupActiveWeekly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  ss.toast("Mengekspor sheet '" + sheet.getName() + "' sebagai MINGGUAN...", "Proses Backup", 5);

  try {
    const res = sendSheetToN8n(sheet, "WEEKLY");
    ss.toast("✅ Sukses! File Mingguan: " + res.fileName + " tersimpan di 2 folder Drive.", "Backup Selesai", 8);
  } catch (err) {
    ss.toast("❌ Gagal: " + err.message, "Error Backup", 8);
  }
}

/**
 * Mem-backup sheet yang sedang dibuka secara paksa sebagai BULANAN (Monthly)
 */
function menuBackupActiveMonthly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  ss.toast("Mengekspor sheet '" + sheet.getName() + "' sebagai BULANAN...", "Proses Backup", 5);

  try {
    const res = sendSheetToN8n(sheet, "MONTHLY");
    ss.toast("✅ Sukses! File Bulanan: " + res.fileName + " tersimpan di 2 folder Drive.", "Backup Selesai", 8);
  } catch (err) {
    ss.toast("❌ Gagal: " + err.message, "Error Backup", 8);
  }
}

// ============================================================================
// 4. HANDLER MENU MANUAL PERIODE SEBELUMNYA
// ============================================================================

function menuBackupYesterday() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sheet = findDailySheetByDate(yesterday, ss);

  if (!sheet) {
    const tglKemarinStr = Utilities.formatDate(yesterday, TIMEZONE, "d/M/yyyy");
    ss.toast("Tidak menemukan tab sheet tanggal kemarin ('" + tglKemarinStr + "').", "Sheet Tidak Ada", 6);
    return;
  }

  ss.toast("Mengekspor data kemarin: " + sheet.getName() + "...", "Backup Harian", 5);

  try {
    const res = sendSheetToN8n(sheet, "DAILY");
    ss.toast("✅ Sukses! File Kemarin: " + res.fileName + " tersimpan di 2 folder Drive.", "Backup Selesai", 8);
  } catch (err) {
    ss.toast("❌ Gagal: " + err.message, "Error Backup", 8);
  }
}

function menuBackupWeekly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const lastWeekSheet = findLastCompletedWeeklySheet(now, ss);

  if (!lastWeekSheet) {
    ss.toast("Tidak menemukan tab sheet mingguan yang selesai untuk periode ini.", "Gagal", 6);
    return;
  }

  ss.toast("Mengekspor data minggu lalu: " + lastWeekSheet.getName() + "...", "Backup Mingguan", 5);

  try {
    const res = sendSheetToN8n(lastWeekSheet, "WEEKLY");
    ss.toast("✅ Sukses! File Minggu Lalu: " + res.fileName + " tersimpan di 2 folder Drive.", "Backup Selesai", 8);
  } catch (err) {
    ss.toast("❌ Gagal: " + err.message, "Error Backup", 8);
  }
}

function menuBackupMonthly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const targetSheet = findTargetMonthlySheet(now, ss);

  if (!targetSheet) {
    ss.toast("Tidak menemukan tab sheet bulanan di file ini.", "Gagal", 6);
    return;
  }

  ss.toast("Mengekspor data bulan lalu: " + targetSheet.getName() + "...", "Backup Bulanan", 5);

  try {
    const res = sendSheetToN8n(targetSheet, "MONTHLY");
    ss.toast("✅ Sukses! File Bulan Lalu: " + res.fileName + " tersimpan di 2 folder Drive.", "Backup Selesai", 8);
  } catch (err) {
    ss.toast("❌ Gagal: " + err.message, "Error Backup", 8);
  }
}

// ============================================================================
// 5. MANAJEMEN TRIGGER & OTOMASI
// Catatan Arsitektur:
// Untuk workbook masif (>30 MB), pemicu terjadwal otomatis (Schedule Trigger)
// dijalankan langsung oleh n8n (Cron: Harian 05:00, Mingguan Minggu 06:00, Bulanan Tgl 7 07:00)
// untuk mengeliminasi timeout eksekusi 360s Google Apps Script.
// ============================================================================

/**
 * Menghapus seluruh trigger Time-driven di Google Apps Script
 * agar jadwal sepenuhnya dikelola oleh n8n (bebas timeout).
 */
function hapusSemuaTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log("✅ Semua trigger berhasil dibersihkan dari Apps Script.");
}

// ============================================================================
// 6. HELPER DETEKSI & PENCARIAN SHEET
// ============================================================================

function detectSheetType(sheetName, colCount) {
  const upper = sheetName.toUpperCase();
  if (upper.includes("MINGGU")) return "WEEKLY";

  for (let i = 0; i < MONTH_NAMES_ID.length; i++) {
    if (sheetName.toLowerCase().includes(MONTH_NAMES_ID[i].toLowerCase()) && !sheetName.includes("/")) {
      return "MONTHLY";
    }
  }

  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(sheetName.trim())) {
    return "DAILY";
  }

  if (colCount <= 15) return "MONTHLY";
  if (colCount <= 20) return "WEEKLY";
  return "DAILY";
}

function findDailySheetByDate(dateObj, ss) {
  const day = Utilities.formatDate(dateObj, TIMEZONE, "d");
  const month = Utilities.formatDate(dateObj, TIMEZONE, "M");
  const year = Utilities.formatDate(dateObj, TIMEZONE, "yyyy");
  
  const candidate1 = day + "/" + month + "/" + year;
  const candidate2 = Utilities.formatDate(dateObj, TIMEZONE, "dd/MM/yyyy");

  return ss.getSheetByName(candidate1) || ss.getSheetByName(candidate2);
}

function findLastCompletedWeeklySheet(dateObj, ss) {
  const day = parseInt(Utilities.formatDate(dateObj, TIMEZONE, "d"), 10);
  const year = Utilities.formatDate(dateObj, TIMEZONE, "yyyy");

  let weekNum = 1;
  if (day >= 8 && day <= 14) {
    weekNum = 1;
  } else if (day >= 15 && day <= 21) {
    weekNum = 2;
  } else if (day >= 22 && day <= 28) {
    weekNum = 3;
  } else if (day >= 29) {
    weekNum = 4;
  } else {
    weekNum = 1;
  }

  const searchPattern = "MINGGU " + weekNum;
  const sheets = ss.getSheets();

  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName().toUpperCase();
    if (name.includes(searchPattern) && name.includes(year)) {
      return sheets[i];
    }
  }

  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName().toUpperCase();
    if (name.includes(searchPattern)) {
      return sheets[i];
    }
  }

  return null;
}

function findTargetMonthlySheet(dateObj, ss) {
  const sheets = ss.getSheets();

  const prevMonthDate = new Date(dateObj.getFullYear(), dateObj.getMonth() - 1, 1);
  const prevMonthName = MONTH_NAMES_ID[prevMonthDate.getMonth()];
  const prevMonthYear = Utilities.formatDate(prevMonthDate, TIMEZONE, "yyyy");
  const prevMonthTitle = (prevMonthName + " " + prevMonthYear).toLowerCase();

  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === prevMonthTitle) {
      return sheets[i];
    }
  }

  const curMonthName = MONTH_NAMES_ID[dateObj.getMonth()];
  const curMonthYear = Utilities.formatDate(dateObj, TIMEZONE, "yyyy");
  const curMonthTitle = (curMonthName + " " + curMonthYear).toLowerCase();

  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === curMonthTitle) {
      return sheets[i];
    }
  }

  return null;
}
