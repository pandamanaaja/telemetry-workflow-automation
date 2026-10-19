/**
 * =========================================================================
 * PENGATURAN ID SPREADSHEET & SHEET
 * =========================================================================
 */
const SOURCE_SPREADSHEET_ID = "YOUR_SOURCE_SPREADSHEET_ID"; // Spreadsheet Asal
const TARGET_SPREADSHEET_ID = "YOUR_TARGET_SPREADSHEET_ID"; // Spreadsheet Tujuan
const SHEET_NAME = "Master Metering"; // Nama Sheet yang diproses


/**
 * =========================================================================
 * FUNGSI BACKUP MANUAL BERDASARKAN VARIABEL (DENGAN SAFE PARSER)
 * =========================================================================
 */

function runManualBackupByCustomDate() {
  const ui = getSafeUi();

  // === ISI TANGGAL DI SINI ===
  const TANGGAL_MULAI = "2026-08-01"; // Format: YYYY-MM-DD
  const TANGGAL_AKHIR = "2026-08-01"; // Format: YYYY-MM-DD (samakan jika hanya 1 hari)
  // ===========================

  const startDate = parseTanggalPresisi(TANGGAL_MULAI);
  const endDate = parseTanggalPresisi(TANGGAL_AKHIR);

  if (!startDate || !endDate) {
    if (ui) ui.alert("Format tanggal tidak valid! Gunakan YYYY-MM-DD.");
    return;
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  processBackupData((rowDate) => {
    return rowDate >= startDate && rowDate <= endDate;
  }, `Backup & Hapus Manual Tanggal ${TANGGAL_MULAI}${TANGGAL_MULAI !== TANGGAL_AKHIR ? ' s/d ' + TANGGAL_AKHIR : ''}`);
}

function runManualBackupByCustomMonth() {
  const BULAN = 8;    // Angka bulan (1 - 12) -> contoh: 8 untuk Agustus
  const TAHUN = 2026; // Masukkan tahun YYYY

  const monthIndex = BULAN - 1;

  processBackupData((rowDate) => {
    return rowDate.getMonth() === monthIndex && rowDate.getFullYear() === TAHUN;
  }, `Backup & Hapus Manual Bulan ${BULAN}/${TAHUN}`);
}


/**
 * =========================================================================
 * PEMINDAIAN ANOMALI MASTER METERING (HIGH PERFORMANCE O(N))
 * =========================================================================
 */
function detectNumericAnomaliesMasterMetering() {
  const ui = getSafeUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  const HEADER_ROW = 1;            
  const START_ROW = 2;             
  const WINDOW_SIZE = 3;           
  const THRESHOLD_MULTIPLIER = 2.5; 
  
  const MIN_ABSOLUTE_DIFF = 2.0;   
  const MIN_PERCENT_CHANGE = 0.10; 
  
  const COLOR_ANOMALY = "#FF4D4D"; 

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < START_ROW || lastCol < 1) {
    if (ui) ui.alert("Data tidak ditemukan atau sheet kosong.");
    return;
  }

  const headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];

  let timestampColIdx = -1;
  for (let c = 0; c < lastCol; c++) {
    const hName = String(headers[c]).toLowerCase();
    if (hName.includes("timestamp") || hName.includes("stempel") || hName.includes("waktu metering")) {
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
  let totalCleaned = 0;

  for (let colIdx = 0; colIdx < lastCol; colIdx++) {
    const headerName = String(headers[colIdx]).toLowerCase();

    if (headerName.includes("timestamp") || headerName.includes("waktu metering") || 
        headerName.includes("stempel") || headerName.includes("jam")) {
      continue;
    }

    const colValues = values.map(row => row[colIdx]);

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

    if (textCount > numberCount) {
      for (let r = 0; r < numRows; r++) {
        if (backgrounds[r][colIdx] === COLOR_ANOMALY || backgrounds[r][colIdx] === "#ff4d4d") {
          backgrounds[r][colIdx] = null;
          totalCleaned++;
        }
      }
      continue;
    }

    const validRowIndices = [];
    for (let r = 0; r < numRows; r++) {
      const val = colValues[r];
      if (typeof val === 'number' && !isNaN(val) && val !== '' && !(val instanceof Date)) {
        validRowIndices.push(r);
      }
    }

    // A. Deteksi sel kosong pada baris yang memiliki timestamp
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
          totalCleaned++;
        }
      }
    }

    // B. Deteksi anomali numerik (Loop O(N) langsung pada validRowIndices)
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
            if (zScore >= THRESHOLD_MULTIPLIER) isAnomaly = true;
          } else {
            if (absDiff > 0.001) isAnomaly = true;
          }

          if (isAnomaly && absDiff >= MIN_ABSOLUTE_DIFF && percentDiff >= MIN_PERCENT_CHANGE) {
            backgrounds[r][colIdx] = COLOR_ANOMALY;
            totalAnomaliesFound++;
          } else {
            if (backgrounds[r][colIdx] === COLOR_ANOMALY || backgrounds[r][colIdx] === "#ff4d4d") {
              totalCleaned++;
            }
            backgrounds[r][colIdx] = null;
          }
        } else {
          backgrounds[r][colIdx] = null;
        }
      }
    }
  }

  range.setBackgrounds(backgrounds);

  if (ui) {
    ui.alert(
      `Pemindaian Master Metering Selesai!\n\n` +
      `- Kolom Kata-Kata/Teks & Timestamp: DIBYPASS\n` +
      `- Sel Angka Kosong (Ada Timestamp): ${totalEmptyFound} ditandai merah\n` +
      `- Anomali Angka Tidak Wajar: ${totalAnomaliesFound} ditandai merah\n` +
      `- Sel Sesuai / Diisi Kembali: ${totalCleaned} warna merahnya dibersihkan`
    );
  }
}


/**
 * =========================================================================
 * ENGINE BACKUP DATA KILAT (ARRAY FILTERING + SAFE BATCH WRITE)
 * =========================================================================
 */

function backupManualChooser() {
  const ui = getSafeUi();
  if (!ui) return;

  const response = ui.alert(
    "Pilih Metode Backup Manual",
    "Pilih kriteria backup yang ingin Anda gunakan:\n\n" +
    "[ YES ] = Pilih berdasarkan BULAN & TAHUN\n" +
    "[ NO ]  = Pilih berdasarkan TANGGAL / RENTANG TANGGAL (YYYY-MM-DD)",
    ui.ButtonSet.YES_NO_CANCEL
  );

  if (response === ui.Button.YES) {
    backupByMonthManual();
  } else if (response === ui.Button.NO) {
    backupByDateRangeManual();
  }
}

function backupTwoMonthsPriorData() {
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const targetMonth = targetDate.getMonth(); 
  const targetYear = targetDate.getFullYear();

  processBackupData(
    (rowDate) => {
      return rowDate.getMonth() === targetMonth && rowDate.getFullYear() === targetYear;
    }, 
    `Backup Data 2 Bulan Lalu (${targetDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' })})`,
    true
  );
}

function backupByMonthManual() {
  const ui = getSafeUi();
  if (!ui) return;

  const inputMonth = ui.prompt("Backup Manual per Bulan", "Masukkan angka Bulan (1-12):", ui.ButtonSet.OK_CANCEL);
  if (inputMonth.getSelectedButton() !== ui.Button.OK) return;

  const inputYear = ui.prompt("Backup Manual per Bulan", "Masukkan Tahun (contoh: 2026):", ui.ButtonSet.OK_CANCEL);
  if (inputYear.getSelectedButton() !== ui.Button.OK) return;

  const month = parseInt(inputMonth.getResponseText().trim(), 10) - 1;
  const year = parseInt(inputYear.getResponseText().trim(), 10);

  if (isNaN(month) || month < 0 || month > 11 || isNaN(year)) {
    ui.alert("Format Bulan atau Tahun tidak valid.");
    return;
  }

  processBackupData((rowDate) => {
    return rowDate.getMonth() === month && rowDate.getFullYear() === year;
  }, `Backup Manual Bulan ${month + 1}/${year}`);
}

function backupByDateRangeManual() {
  const ui = getSafeUi();
  if (!ui) return;
  
  const startDateInput = ui.prompt(
    "Backup Manual per Tanggal", 
    "Masukkan Tanggal Mulai (Format: YYYY-MM-DD, contoh: 2026-08-19):", 
    ui.ButtonSet.OK_CANCEL
  );
  if (startDateInput.getSelectedButton() !== ui.Button.OK) return;

  const endDateInput = ui.prompt(
    "Backup Manual per Tanggal", 
    "Masukkan Tanggal Akhir (Format: YYYY-MM-DD, atau samakan dengan tanggal mulai jika hanya 1 hari):", 
    ui.ButtonSet.OK_CANCEL
  );
  if (endDateInput.getSelectedButton() !== ui.Button.OK) return;

  const startStr = startDateInput.getResponseText().trim();
  const endStr = endDateInput.getResponseText().trim();

  const startDate = parseTanggalPresisi(startStr);
  const endDate = parseTanggalPresisi(endStr);

  if (!startDate || !endDate) {
    ui.alert("Format Tanggal tidak valid! Harap gunakan format YYYY-MM-DD.");
    return;
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  processBackupData((rowDate) => {
    return rowDate >= startDate && rowDate <= endDate;
  }, `Backup Manual Tanggal ${startStr}${startStr !== endStr ? ' s/d ' + endStr : ''}`);
}

function processBackupData(filterCriteria, titleInfo, isStrict = false) {
  const ui = getSafeUi();

  try {
    const srcSpreadsheet = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
    const srcSheet = srcSpreadsheet.getSheetByName(SHEET_NAME);

    const tgtSpreadsheet = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    let tgtSheet = tgtSpreadsheet.getSheetByName(SHEET_NAME);

    if (!srcSheet) {
      if (ui) ui.alert(`Sheet "${SHEET_NAME}" tidak ditemukan pada Spreadsheet Sumber.`);
      return;
    }

    if (!tgtSheet) {
      tgtSheet = tgtSpreadsheet.insertSheet(SHEET_NAME);
    }

    const lastRow = srcSheet.getLastRow();
    const lastCol = srcSheet.getLastColumn();

    if (lastRow < 2) {
      if (ui) ui.alert("Gagal: Tidak ada data pada Sheet Sumber.");
      return;
    }

    const headers = srcSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    let timestampColIdx = -1;
    for (let c = 0; c < lastCol; c++) {
      const hName = String(headers[c]).toLowerCase();
      if (hName.includes("timestamp") || hName.includes("stempel") || hName.includes("waktu metering")) {
        timestampColIdx = c;
        break;
      }
    }

    if (timestampColIdx === -1) {
      if (ui) ui.alert("Kolom Timestamp/Waktu Metering tidak ditemukan pada Sheet Sumber.");
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
      const rowDate = parseTanggalPresisi(rawDate);
      
      let isMatch = false;
      if (rowDate && filterCriteria(rowDate)) {
        isMatch = true;
      }

      if (isMatch) {
        rowsToBackup.push(row);
      } else {
        rowsToKeep.push(row);
      }
    }

    if (rowsToBackup.length === 0) {
      const msg = isStrict 
        ? `âš ï¸ DATA BELUM TERSEDIA!\n\nData untuk kriteria: "${titleInfo}" tidak ditemukan pada Sheet Master Metering.\n\nProses backup DIBATALKAN.`
        : `${titleInfo}\n\nSelesai: Tidak ada baris data yang cocok dengan kriteria filter.`;
      Logger.log(msg);
      if (ui) ui.alert(msg);
      return;
    }

    // 1. TULIS KE SPREADSHEET TUJUAN (APPEND)
    const tgtStartRow = tgtSheet.getLastRow() + 1;
    tgtSheet.getRange(tgtStartRow, 1, rowsToBackup.length, lastCol).setValues(rowsToBackup);

    // 2. TIMPA BARIS DI SPREADSHEET ASAL DENGAN DATA SISA
    srcSheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    
    if (rowsToKeep.length > 0) {
      srcSheet.getRange(2, 1, rowsToKeep.length, lastCol).setValues(rowsToKeep);
    }

    // Pangkas baris kosong yang berlebih di sheet sumber agar tidak menumpuk ribuan baris kosong
    const currentMaxRows = srcSheet.getMaxRows();
    const neededRows = rowsToKeep.length + 1;
    if (currentMaxRows > neededRows && rowsToBackup.length > 0) {
      const numToDelete = Math.min(rowsToBackup.length, currentMaxRows - neededRows);
      if (numToDelete > 0) {
        srcSheet.deleteRows(neededRows + 1, numToDelete);
      }
    }

    const successMsg = `${titleInfo} Berhasil!\n\n` +
      `- Jumlah baris dipindahkan: ${rowsToBackup.length} baris\n` +
      `- Data disalin ke Spreadsheet Tujuan mulai baris ke: ${tgtStartRow}\n` +
      `- Sisa baris bertahan di Sheet Sumber: ${rowsToKeep.length} baris.`;
    
    Logger.log(successMsg);
    if (ui) ui.alert(successMsg);

  } catch (e) {
    Logger.log("Error backup: " + e.message);
    if (ui) ui.alert("Terjadi kesalahan saat memproses backup: " + e.message);
  }
}


/**
 * =========================================================================
 * FUNGSI DEDUP AUTO & MANUAL (SUPER KILAT - BATCH MODE)
 * =========================================================================
 */

function getRowKey(displayRow) {
  const rawDate = String(displayRow[0] || "").trim();
  const tsText = normalizeDateText(rawDate.split(" ")[0]);
  
  const rawJam = String(displayRow[1] || "").trim().replace('.', ':');
  let jamClean = rawJam;
  if (rawJam.includes(":")) {
    const parts = rawJam.split(":");
    jamClean = `${parseInt(parts[0], 10)}:${parts[1]}`;
  }

  const teknisiText = String(displayRow[2] || "").trim().toLowerCase().replace(/\s+/g, ' ');
  return `${tsText} | ${jamClean} | ${teknisiText}`;
}

function autoProcessDuplicates(autoDelete = true) {
  const ui = getSafeUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2) return;

  const displayValues = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const valuesData = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  const seenKeys = new Set();
  const duplicateRowIndices = [];
  const rowsToKeep = [valuesData[0]]; // Simpan header asli

  for (let i = 1; i < displayValues.length; i++) {
    if (!displayValues[i][0]) {
      rowsToKeep.push(valuesData[i]);
      continue;
    }

    const key = getRowKey(displayValues[i]);
    if (seenKeys.has(key)) {
      duplicateRowIndices.push(i); // Index 0-based
    } else {
      seenKeys.add(key);
      rowsToKeep.push(valuesData[i]);
    }
  }

  if (duplicateRowIndices.length === 0) {
    if (ui) ui.alert("INFO: Tidak ditemukan data duplikat.");
    return;
  }

  if (autoDelete) {
    // OPTIMASI: Hapus duplikat instan tanpa deleteRow di loop
    sheet.clearContents();
    sheet.getRange(1, 1, rowsToKeep.length, lastCol).setValues(rowsToKeep);

    const currentMaxRows = sheet.getMaxRows();
    if (currentMaxRows > rowsToKeep.length) {
      const numToDelete = Math.min(duplicateRowIndices.length, currentMaxRows - rowsToKeep.length);
      if (numToDelete > 0) {
        sheet.deleteRows(rowsToKeep.length + 1, numToDelete);
      }
    }
    sheet.getDataRange().setBackground(null);
    if (ui) ui.alert(`BERHASIL: ${duplicateRowIndices.length} baris data duplikat telah dihapus.`);
  } else {
    // OPTIMASI: Tandai warna kuning sekaligus (Single API Call)
    const dataRange = sheet.getRange(1, 1, lastRow, lastCol);
    const backgrounds = dataRange.getBackgrounds();

    duplicateRowIndices.forEach(r => {
      for (let c = 0; c < lastCol; c++) {
        backgrounds[r][c] = "#FFF2CC";
      }
    });

    dataRange.setBackgrounds(backgrounds);
    if (ui) ui.alert(`DITEMUKAN: ${duplicateRowIndices.length} baris data duplikat (ditandai warna kuning).`);
  }
}

function highlightDuplicates() {
  autoProcessDuplicates(false);
}

function removeDuplicates() {
  const ui = getSafeUi();
  if (ui) {
    const konfirmasi = ui.alert(
      "Konfirmasi Hapus Duplikat",
      "Apakah Anda yakin ingin menghapus seluruh baris data duplikat? Tindakan ini tidak dapat dibatalkan.",
      ui.ButtonSet.YES_NO
    );
    if (konfirmasi !== ui.Button.YES) return;
  }
  autoProcessDuplicates(true);
}


/**
 * =========================================================================
 * HELPER FUNCTIONS (PARSER PRESISI & SAFE UI)
 * =========================================================================
 */

function getSafeUi() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

// Parser Tanggal Presisi: Menjamin DD/MM/YYYY tidak terbalik menjadi MM/DD/YYYY
function parseTanggalPresisi(val) {
  if (!val) return null;
  if (val instanceof Date) return val;

  if (typeof val === 'string') {
    const str = val.trim();
    const datePart = str.split(' ')[0];
    const separator = datePart.indexOf('/') !== -1 ? '/' : (datePart.indexOf('-') !== -1 ? '-' : null);

    if (separator) {
      const parts = datePart.split(separator);
      if (parts.length === 3) {
        const p1 = parseInt(parts[0], 10);
        const p2 = parseInt(parts[1], 10);
        const p3 = parseInt(parts[2], 10);

        if (p1 > 1000) {
          return new Date(p1, p2 - 1, p3);
        }

        const y = p3 < 100 ? 2000 + p3 : p3;
        return new Date(y, p2 - 1, p1);
      }
    }

    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function normalizeDateText(str) {
  if (!str) return "";
  const separator = str.indexOf('/') !== -1 ? '/' : (str.indexOf('-') !== -1 ? '-' : null);
  if (separator) {
    const p = str.split(separator);
    if (p.length === 3) {
      const p1 = parseInt(p[0], 10);
      const p2 = parseInt(p[1], 10);
      const p3 = parseInt(p[2], 10);
      if (p1 > 1000) {
        return `${p1}-${String(p2).padStart(2, '0')}-${String(p3).padStart(2, '0')}`;
      }
      const y = p3 < 100 ? 2000 + p3 : p3;
      return `${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
    }
  }
  return str;
}


/**
 * =========================================================================
 * TOOLBAR MENU
 * =========================================================================
 */
function onOpen() {
  const ui = getSafeUi();
  if (!ui) return;

  ui.createMenu('ðŸ” Deteksi & Backup Master')
    .addItem('Pindai Master Metering (Atas ke Bawah)', 'detectNumericAnomaliesMasterMetering')
    .addSeparator()
    .addItem('âš™ï¸ Backup Manual (Dialog UI)', 'backupManualChooser')
    .addItem('ðŸ“¦ Backup Otomatis 2 Bulan Lalu', 'backupTwoMonthsPriorData')
    .addSeparator()
    .addItem('âœï¸ Run Backup Manual (By Variable Date)', 'runManualBackupByCustomDate')
    .addItem('âœï¸ Run Backup Manual (By Variable Month)', 'runManualBackupByCustomMonth')
    .addSeparator()
    .addItem('ðŸŽ¨ Warnai Data Duplikat', 'highlightDuplicates')
    .addItem('ðŸ—‘ï¸ Hapus Data Duplikat', 'removeDuplicates')
    .addToUi();
}
