// ==============================================================================
// KONFIGURASI GLOBAL SPREADSHEET & SHEET
// ==============================================================================
var SHEET_NAME = "MASTER-RESPONSE-MET";
var SOURCE_ID  = "YOUR_MASTER_SPREADSHEET_ID"; // Spreadsheet Master
var TARGET_ID  = "YOUR_BACKUP_SPREADSHEET_ID"; // Spreadsheet Backup


/**
 * MENU OTOMATIS GOOGLE SHEETS
 * Menampilkan seluruh fitur tombol dalam satu menu khusus.
 */
function onOpen() {
  const ui = getSafeUi();
  if (!ui) return;

  ui.createMenu('ðŸ” Deteksi & Backup')
    .addItem('Pindai Anomali Angka (Abaikan Teks)', 'detectNumericAnomaliesOnly')
    .addSeparator()
    .addItem('Backup Otomatis (2 Bulan Lalu Full)', 'backupOtomatis2BulanLalu')
    .addItem('Backup Manual (Berdasarkan Tanggal)', 'backupManualSesuaiTanggal')
    .addItem('Backup Manual (Berdasarkan Bulan)', 'backupManualSesuaiBulan')
    .addSeparator()
    .addItem('âš¡ Backup LENGKAP (Semua Data Master)', 'backupLengkapSemuaData')
    .addToUi();
}


// ==============================================================================
// BAGIAN 1: PEMINDAIAN DAN DETEKSI ANOMALI ANGKA (HIGH PERFORMANCE O(N))
// ==============================================================================
function detectNumericAnomaliesOnly() {
  const ui = getSafeUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // ================= PENGATURAN =================
  const HEADER_ROW = 1;            // Baris header
  const START_ROW = 2;             // Baris awal data
  const WINDOW_SIZE = 3;           // Acuan: 3 baris di atas & 3 baris di bawah
  const THRESHOLD_MULTIPLIER = 2.5; // Batas penyimpangan Z-Score (ekstrem)
  
  // BATAS TOLERANSI RENTANG ANGKA
  const MIN_ABSOLUTE_DIFF = 2.0;   // Minimal selisih angka mutlak
  const MIN_PERCENT_CHANGE = 0.10; // Minimal beda 10% dari rata-rata sekitar
  
  const COLOR_ANOMALY = "#FF4D4D"; // Warna merah terang untuk anomali / sel kosong
  // ==============================================

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < START_ROW || lastCol < 1) {
    if (ui) ui.alert("Data tidak ditemukan atau sheet kosong.");
    return;
  }

  // Ambil nama header di baris pertama
  const headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];

  // Cari posisi kolom Timestamp / Waktu
  let timestampColIdx = -1;
  for (let c = 0; c < lastCol; c++) {
    const hName = String(headers[c]).toLowerCase();
    if (hName.includes("time") || hName.includes("jam") || 
        hName.includes("date") || hName.includes("tanggal") || hName.includes("stempel")) {
      timestampColIdx = c;
      break;
    }
  }

  const numRows = lastRow - START_ROW + 1;
  const range = sheet.getRange(START_ROW, 1, numRows, lastCol);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();

  let totalAnomaliesFound = 0;
  let totalEmptyFound = 0;

  // PROSES PER KOLOM
  for (let colIdx = 0; colIdx < lastCol; colIdx++) {
    const headerName = String(headers[colIdx]).toLowerCase();

    // 1. ABAIKAN KOLOM TIMESTAMP / WAKTU
    if (headerName.includes("time") || headerName.includes("jam") || 
        headerName.includes("date") || headerName.includes("tanggal") || headerName.includes("stempel")) {
      continue;
    }

    const colValues = values.map(row => row[colIdx]);

    // 2. CEK APAKAH KOLOM INI ADALAH KOLOM KATA-KATA / TEKS
    let textCount = 0;
    let numberCount = 0;
    
    for (let r = 0; r < numRows; r++) {
      const val = colValues[r];
      if (val !== '' && val !== null) {
        if (typeof val === 'number' && !isNaN(val)) {
          numberCount++;
        } else if (typeof val === 'string' && isNaN(Number(val))) {
          textCount++;
        }
      }
    }

    // Jika kolom dominan berisi teks, ABAIKAN TOTAL & bersihkan warna merah lama
    if (textCount > numberCount) {
      for (let r = 0; r < numRows; r++) {
        if (backgrounds[r][colIdx] === COLOR_ANOMALY || backgrounds[r][colIdx] === "#ff4d4d") {
          backgrounds[r][colIdx] = null;
        }
      }
      continue;
    }

    // 3. IDENTIFIKASI BARIS VALID DENGAN NILAI NUMERIK
    const validRowIndices = [];
    for (let r = 0; r < numRows; r++) {
      const val = colValues[r];
      if (typeof val === 'number' && !isNaN(val) && val !== '' && !(val instanceof Date)) {
        validRowIndices.push(r);
      }
    }

    // A. DETEKSI SEL ANGKA KOSONG PADA BARIS BER-TIMESTAMP
    for (let r = 0; r < numRows; r++) {
      const currentVal = colValues[r];
      const hasTimestamp = timestampColIdx !== -1 && 
                           values[r][timestampColIdx] !== '' && 
                           values[r][timestampColIdx] !== null;

      if ((currentVal === '' || currentVal === null || isNaN(currentVal)) && hasTimestamp) {
        backgrounds[r][colIdx] = COLOR_ANOMALY;
        totalEmptyFound++;
      } else if (typeof currentVal !== 'number' || isNaN(currentVal) || currentVal === '') {
        if (backgrounds[r][colIdx] === COLOR_ANOMALY || backgrounds[r][colIdx] === "#ff4d4d") {
          backgrounds[r][colIdx] = null;
        }
      }
    }

    // B. DETEKSI ANOMALI NUMERIK (Looping langsung O(N) tanpa indexOf)
    const totalValid = validRowIndices.length;
    if (totalValid >= 5) {
      for (let i = 0; i < totalValid; i++) {
        const r = validRowIndices[i];
        const currentVal = colValues[r];

        const startNeighborIdx = Math.max(0, i - WINDOW_SIZE);
        const endNeighborIdx = Math.min(totalValid - 1, i + WINDOW_SIZE);

        let sum = 0;
        let count = 0;
        for (let j = startNeighborIdx; j <= endNeighborIdx; j++) {
          if (j !== i) {
            sum += colValues[validRowIndices[j]];
            count++;
          }
        }

        if (count >= 2) {
          const mean = sum / count;

          let sumSquaredDiff = 0;
          for (let j = startNeighborIdx; j <= endNeighborIdx; j++) {
            if (j !== i) {
              sumSquaredDiff += Math.pow(colValues[validRowIndices[j]] - mean, 2);
            }
          }
          const variance = sumSquaredDiff / (count - 1);
          const stdDev = Math.sqrt(variance);

          const absDiff = Math.abs(currentVal - mean);
          const percentDiff = mean !== 0 ? absDiff / Math.abs(mean) : 0;

          let isAnomaly = false;

          if (stdDev > 0) {
            const zScore = absDiff / stdDev;
            if (zScore >= THRESHOLD_MULTIPLIER) {
              isAnomaly = true;
            }
          } else {
            if (absDiff > 0.001) {
              isAnomaly = true;
            }
          }

          if (isAnomaly && absDiff >= MIN_ABSOLUTE_DIFF && percentDiff >= MIN_PERCENT_CHANGE) {
            backgrounds[r][colIdx] = COLOR_ANOMALY;
            totalAnomaliesFound++;
          } else {
            backgrounds[r][colIdx] = null; // Reset ke transparan/default tema
          }
        } else {
          backgrounds[r][colIdx] = null;
        }
      }
    }
  }

  // Terapkan latar belakang ke sheet
  range.setBackgrounds(backgrounds);

  if (ui) {
    ui.alert(
      `Pemindaian Angka Selesai!\n\n` +
      `- Kolom Kata-Kata/Teks: DIBYPASS (Tidak di-scan)\n` +
      `- Sel Angka Kosong (Ada Timestamp): ${totalEmptyFound} ditandai merah\n` +
      `- Anomali Angka Tidak Wajar: ${totalAnomaliesFound} ditandai merah`
    );
  }
}


// ==============================================================================
// BAGIAN 2: SISTEM BACKUP DATA
// ==============================================================================

/**
 * FUNGSI: Backup Lengkap (Semua Data Master)
 */
function backupLengkapSemuaData() {
  const ui = getSafeUi();
  if (!ui) return;

  const response = ui.alert(
    'Konfirmasi Backup Lengkap',
    'Apakah Anda yakin ingin memindahkan SELURUH data dari Sheet Master ke baris baru di Sheet Backup?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    processBackupEngine(function(rowDate) {
      return true;
    }, "BACKUP LENGKAP (Semua Data)");
  }
}

/**
 * FUNGSI OTOMATIS: Backup Data Full 2 Bulan Sebelum
 */
function backupOtomatis2BulanLalu() {
  var now = new Date();
  
  var targetDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  var targetMonth = targetDate.getMonth() + 1; // 1 - 12
  var targetYear = targetDate.getFullYear();

  processBackupEngine(function(rowDate) {
    var m = rowDate.getMonth() + 1;
    var y = rowDate.getFullYear();
    return (m === targetMonth) && (y === targetYear);
  }, "OTOMATIS (Bulan " + targetMonth + "/" + targetYear + " - 2 Bulan Lalu)");
}

/**
 * FUNGSI MANUAL: Backup Berdasarkan Tanggal Spesifik (Dengan Input Prompt)
 */
function backupManualSesuaiTanggal() {
  const ui = getSafeUi();
  if (!ui) return;

  const resTgl = ui.prompt('Backup Berdasarkan Tanggal', 'Masukkan Tanggal (1-31):', ui.ButtonSet.OK_CANCEL);
  if (resTgl.getSelectedButton() !== ui.Button.OK) return;

  const resBln = ui.prompt('Backup Berdasarkan Tanggal', 'Masukkan Bulan (1-12):', ui.ButtonSet.OK_CANCEL);
  if (resBln.getSelectedButton() !== ui.Button.OK) return;

  const resThn = ui.prompt('Backup Berdasarkan Tanggal', 'Masukkan Tahun (contoh: 2026):', ui.ButtonSet.OK_CANCEL);
  if (resThn.getSelectedButton() !== ui.Button.OK) return;

  const tanggalPilihan = parseInt(resTgl.getResponseText().trim(), 10);
  const bulanPilihan   = parseInt(resBln.getResponseText().trim(), 10);
  const tahunPilihan   = parseInt(resThn.getResponseText().trim(), 10);

  if (isNaN(tanggalPilihan) || isNaN(bulanPilihan) || isNaN(tahunPilihan)) {
    ui.alert('Error: Input tanggal, bulan, atau tahun tidak valid!');
    return;
  }

  processBackupEngine(function(rowDate) {
    var d = rowDate.getDate();
    var m = rowDate.getMonth() + 1;
    var y = rowDate.getFullYear();
    return (d === tanggalPilihan) && (m === bulanPilihan) && (y === tahunPilihan);
  }, "MANUAL (Tanggal " + tanggalPilihan + "/" + bulanPilihan + "/" + tahunPilihan + ")");
}

/**
 * FUNGSI MANUAL: Backup Berdasarkan Bulan & Tahun (Dengan Input Prompt)
 */
function backupManualSesuaiBulan() {
  const ui = getSafeUi();
  if (!ui) return;

  const resBln = ui.prompt('Backup Berdasarkan Bulan', 'Masukkan Bulan (1-12):', ui.ButtonSet.OK_CANCEL);
  if (resBln.getSelectedButton() !== ui.Button.OK) return;

  const resThn = ui.prompt('Backup Berdasarkan Bulan', 'Masukkan Tahun (contoh: 2026):', ui.ButtonSet.OK_CANCEL);
  if (resThn.getSelectedButton() !== ui.Button.OK) return;

  const bulanPilihan = parseInt(resBln.getResponseText().trim(), 10);
  const tahunPilihan = parseInt(resThn.getResponseText().trim(), 10);

  if (isNaN(bulanPilihan) || isNaN(tahunPilihan)) {
    ui.alert('Error: Input bulan atau tahun tidak valid!');
    return;
  }

  processBackupEngine(function(rowDate) {
    var m = rowDate.getMonth() + 1;
    var y = rowDate.getFullYear();
    return (m === bulanPilihan) && (y === tahunPilihan);
  }, "MANUAL (Bulan " + bulanPilihan + "/" + tahunPilihan + ")");
}


// ==============================================================================
// CORE ENGINE: PEMINDAH & PENGHAPUS DATA MASTER (HIGH PERFORMANCE & SAFE APPEND)
// ==============================================================================
function processBackupEngine(filterCondition, logLabel) {
  var ui = getSafeUi();
  var sourceSpreadsheet = SpreadsheetApp.openById(SOURCE_ID);
  var targetSpreadsheet = SpreadsheetApp.openById(TARGET_ID);

  var sourceSheet = sourceSpreadsheet.getSheetByName(SHEET_NAME);
  var targetSheet = targetSpreadsheet.getSheetByName(SHEET_NAME);

  if (!sourceSheet || !targetSheet) {
    var errMsg = "ERROR: Sheet '" + SHEET_NAME + "' tidak ditemukan pada salah satu Spreadsheet.";
    Logger.log(errMsg);
    if (ui) ui.alert(errMsg);
    return;
  }

  var data = sourceSheet.getDataRange().getValues();
  if (data.length <= 1) {
    var noDataMsg = "INFO [" + logLabel + "]: Tidak ada baris data di Sheet Master.";
    Logger.log(noDataMsg);
    if (ui) ui.alert(noDataMsg);
    return;
  }

  var rowsToBackup = [];
  var rowsToKeep   = [data[0]]; // Simpan baris header

  for (var i = 1; i < data.length; i++) {
    var timestampValue = data[i][0]; // Kolom A: Timestamp
    var rowDate = parseTanggal(timestampValue);

    var matchCondition = false;
    if (logLabel.includes("BACKUP LENGKAP")) {
      matchCondition = filterCondition(rowDate);
    } else if (rowDate && !isNaN(rowDate.getTime())) {
      matchCondition = filterCondition(rowDate);
    }

    if (matchCondition) {
      rowsToBackup.push(data[i]);
    } else {
      rowsToKeep.push(data[i]);
    }
  }

  if (rowsToBackup.length > 0) {
    // 1. CARI BARIS TERAKHIR DI TARGET SHEET
    var lastRowTarget = targetSheet.getLastRow();
    
    // Jika sheet target kosong, salin header terlebih dahulu
    if (lastRowTarget === 0) {
      targetSheet.getRange(1, 1, 1, data[0].length).setValues([data[0]]);
      lastRowTarget = 1;
    }

    var nextStartRow = lastRowTarget + 1;

    // 2. TAMBAHKAN DATA TEPAT DI BARIS TERBAWAH TARGET SHEET
    targetSheet.getRange(nextStartRow, 1, rowsToBackup.length, rowsToBackup[0].length).setValues(rowsToBackup);

    // 3. OPTIMASI SUPER CEPAT (Bebas Timeout deleteRow per baris):
    // Tulis ulang baris tersisa di Master Sheet dan pangkas sisanya sekaligus
    sourceSheet.clearContents();
    sourceSheet.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);

    var currentMaxRows = sourceSheet.getMaxRows();
    if (currentMaxRows > rowsToKeep.length && rowsToBackup.length > 0) {
      var numRowsToDelete = Math.min(rowsToBackup.length, currentMaxRows - rowsToKeep.length);
      if (numRowsToDelete > 0) {
        sourceSheet.deleteRows(rowsToKeep.length + 1, numRowsToDelete);
      }
    }

    var successMsg = "BERHASIL [" + logLabel + "]: Memindahkan " + rowsToBackup.length + " baris data ke Sheet Backup.";
    Logger.log(successMsg);
    if (ui) ui.alert(successMsg);
  } else {
    var emptyMsg = "INFO [" + logLabel + "]: Data belum ada / tidak ditemukan untuk kriteria ini.";
    Logger.log(emptyMsg);
    if (ui) ui.alert(emptyMsg);
  }
}


// ==============================================================================
// HELPER FUNCTIONS (PARSER FORMAT TANGGAL INDONESIA & SAFE UI)
// ==============================================================================

function getSafeUi() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

// Parser Tanggal Presisi: Memastikan DD/MM/YYYY tidak tertukar menjadi MM/DD/YYYY
function parseTanggal(val) {
  if (!val) return null;
  if (val instanceof Date) return val;

  if (typeof val === 'string') {
    var str = val.trim();
    var parts = str.split(' ');
    var datePart = parts[0];

    var separator = datePart.indexOf('/') !== -1 ? '/' : (datePart.indexOf('-') !== -1 ? '-' : null);
    if (separator) {
      var dParts = datePart.split(separator);
      if (dParts.length === 3) {
        var p1 = parseInt(dParts[0], 10);
        var p2 = parseInt(dParts[1], 10);
        var p3 = parseInt(dParts[2], 10);

        // Jika diawali 4 digit tahun: YYYY-MM-DD atau YYYY/MM/DD
        if (p1 > 1000) {
          return new Date(p1, p2 - 1, p3);
        }

        // Standar Indonesia: DD/MM/YYYY (p1 = Tanggal, p2 = Bulan, p3 = Tahun)
        var y = p3 < 100 ? 2000 + p3 : p3;
        var d = p1;
        var m = p2;
        return new Date(y, m - 1, d);
      }
    }

    var parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}
