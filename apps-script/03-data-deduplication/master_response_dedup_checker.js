// ==============================================================================
// KONFIGURASI SPREADSHEET & SHEET
// ==============================================================================
var SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // ID Spreadsheet
var SHEET_NAME     = "MASTER-RESPONSE-MET";                        // Nama Sheet Tab


// ==============================================================================
// 1. MENU KUSTOM (Muncul di Samping Menu Help / Bantuan)
// ==============================================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  
  ui.createMenu('ðŸ” CEK DATA DOUBLE')
    .addItem('1. Tandai Data Double (Warna Merah)', 'tandaiDataDouble')
    .addItem('2. Hapus Data Double', 'hapusDataDouble')
    .addToUi();
}


// ==============================================================================
// 2. FUNGSI TANDAI DATA DOUBLE (HIGH PERFORMANCE - BATCH SETBACKGROUNDS)
// Memeriksa Timestamp (Col A), Nama Teknisi (Col B), dan Jam Metering (Col C)
// ==============================================================================
function tandaiDataDouble() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getTargetSheet();
  
  if (!sheet) {
    if (ui) ui.alert("Error: Sheet '" + SHEET_NAME + "' tidak ditemukan.");
    return;
  }

  var displayData = sheet.getDataRange().getDisplayValues();
  if (displayData.length <= 1) {
    if (ui) ui.alert("INFO: Tidak ada data untuk diperiksa.");
    return;
  }

  SpreadsheetApp.getActiveSpreadsheet().toast("Sedang memindai data double...", "Memproses", 5);

  var numRows = displayData.length - 1; // Baris data di luar header
  var lastCol = sheet.getLastColumn();
  var dataRange = sheet.getRange(2, 1, numRows, lastCol);
  var backgrounds = dataRange.getBackgrounds();

  var mapKeys = {};
  var duplicateCount = 0;

  // Looping mulai baris ke-2 (melewati header)
  for (var i = 1; i < displayData.length; i++) {
    var r = i - 1; // Index 0-based untuk array backgrounds
    
    var timestampStr   = normalizeTimestamp(displayData[i][0]);
    var namaTeknisiStr = displayData[i][1] ? String(displayData[i][1]).trim().toLowerCase().replace(/\s+/g, ' ') : '';
    var jamMeteringStr = normalizeJamMetering(displayData[i][2]);

    // Jika baris kosong, bersihkan warna dan lewati
    if (!timestampStr && !namaTeknisiStr && !jamMeteringStr) {
      for (var c = 0; c < lastCol; c++) backgrounds[r][c] = null;
      continue;
    }

    var uniqueKey = timestampStr + " | " + namaTeknisiStr + " | " + jamMeteringStr;

    if (mapKeys[uniqueKey]) {
      // Tandai merah muda di memori
      for (var c = 0; c < lastCol; c++) {
        backgrounds[r][c] = "#f8d7da";
      }
      duplicateCount++;
    } else {
      mapKeys[uniqueKey] = true;
      // Bersihkan warna jika data unik
      for (var c = 0; c < lastCol; c++) {
        backgrounds[r][c] = null;
      }
    }
  }

  // Terapkan seluruh warna dalam 1 KALI PANGGILAN (Instan)
  dataRange.setBackgrounds(backgrounds);

  if (duplicateCount > 0) {
    var pesanAda = "DITEMUKAN: " + duplicateCount + " baris data double (ditandai warna merah muda).";
    Logger.log(pesanAda);
    if (ui) ui.alert(pesanAda);
  } else {
    var pesanNihil = "INFO: Tidak ditemukan data double.";
    Logger.log(pesanNihil);
    if (ui) ui.alert(pesanNihil);
  }
}


// ==============================================================================
// 3. FUNGSI HAPUS DATA DOUBLE (HIGH PERFORMANCE - IN MEMORY FILTER & SINGLE DELETE)
// ==============================================================================
function hapusDataDouble() {
  var ui = SpreadsheetApp.getUi();

  // Konfirmasi keamanan untuk mencegah data terhapus tidak sengaja
  var konfirmasi = ui.alert(
    "Konfirmasi Hapus Data Double",
    "Apakah Anda yakin ingin menghapus semua baris data double dari sheet '" + SHEET_NAME + "'? Tindakan ini tidak dapat dibatalkan.",
    ui.ButtonSet.YES_NO
  );
  if (konfirmasi !== ui.Button.YES) return;

  var sheet = getTargetSheet();
  
  if (!sheet) {
    if (ui) ui.alert("Error: Sheet '" + SHEET_NAME + "' tidak ditemukan.");
    return;
  }

  // Gunakan getValues() agar tipe data asli (angka, rumus, tanggal) tetap terjaga saat ditulis ulang
  var valuesData = sheet.getDataRange().getValues();
  var displayData = sheet.getDataRange().getDisplayValues();

  if (valuesData.length <= 1) {
    if (ui) ui.alert("INFO: Tidak ada data untuk diperiksa.");
    return;
  }

  SpreadsheetApp.getActiveSpreadsheet().toast("Sedang menghapus data double...", "Memproses", 5);

  var mapKeys = {};
  var rowsToKeep = [valuesData[0]]; // Simpan header asli
  var duplicateCount = 0;

  for (var i = 1; i < displayData.length; i++) {
    var timestampStr   = normalizeTimestamp(displayData[i][0]);
    var namaTeknisiStr = displayData[i][1] ? String(displayData[i][1]).trim().toLowerCase().replace(/\s+/g, ' ') : '';
    var jamMeteringStr = normalizeJamMetering(displayData[i][2]);

    if (!timestampStr && !namaTeknisiStr && !jamMeteringStr) {
      rowsToKeep.push(valuesData[i]);
      continue;
    }

    var uniqueKey = timestampStr + " | " + namaTeknisiStr + " | " + jamMeteringStr;

    if (mapKeys[uniqueKey]) {
      duplicateCount++;
    } else {
      mapKeys[uniqueKey] = true;
      rowsToKeep.push(valuesData[i]);
    }
  }

  // Jika ditemukan duplikat: timpa dengan data unik dan potong sisa baris berlebih sekaligus
  if (duplicateCount > 0) {
    sheet.clearContents();
    sheet.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);

    var currentMaxRows = sheet.getMaxRows();
    if (currentMaxRows > rowsToKeep.length) {
      var numRowsToDelete = Math.min(duplicateCount, currentMaxRows - rowsToKeep.length);
      if (numRowsToDelete > 0) {
        sheet.deleteRows(rowsToKeep.length + 1, numRowsToDelete);
      }
    }

    // Bersihkan warna latar belakang bekas tanda merah
    sheet.getDataRange().setBackground(null);

    var pesanHapus = "BERHASIL: " + duplicateCount + " baris data double telah dihapus.";
    Logger.log(pesanHapus);
    if (ui) ui.alert(pesanHapus);
  } else {
    var pesanNol = "INFO: Tidak ada data double yang dihapus.";
    Logger.log(pesanNol);
    if (ui) ui.alert(pesanNol);
  }
}


// ==============================================================================
// HELPER FUNCTIONS (KONEKSI, NORMALISASI TANGGAL & JAM)
// ==============================================================================

// Helper koneksi sheet aktif/ID (lebih cepat)
function getTargetSheet() {
  try {
    var activeSS = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSS && activeSS.getId() === SPREADSHEET_ID) {
      return activeSS.getSheetByName(SHEET_NAME);
    }
  } catch (e) {}
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
}

// Normalisasi Tanggal Presisi: Menyeragamkan format tanggal menjadi 'YYYY-MM-DD'
function normalizeTimestamp(val) {
  if (val === null || val === undefined || val === '') return '';
  var str = String(val).trim();
  var datePart = str.split(' ')[0];

  // Cek jika pemisah '/' atau '-'
  var separator = datePart.indexOf('/') !== -1 ? '/' : (datePart.indexOf('-') !== -1 ? '-' : null);
  if (separator) {
    var parts = datePart.split(separator);
    if (parts.length === 3) {
      var p1 = parseInt(parts[0], 10);
      var p2 = parseInt(parts[1], 10);
      var p3 = parseInt(parts[2], 10);

      // Format ISO: YYYY-MM-DD
      if (p1 > 1000) {
        return p1 + '-' + String(p2).padStart(2, '0') + '-' + String(p3).padStart(2, '0');
      }

      // Format Indonesia: DD/MM/YYYY
      var y = p3 < 100 ? 2000 + p3 : p3;
      return y + '-' + String(p2).padStart(2, '0') + '-' + String(p1).padStart(2, '0');
    }
  }

  return datePart;
}

// Normalisasi Jam Metering: Menyamakan 3.00, 3:00, 03:00 menjadi '03:00'
function normalizeJamMetering(val) {
  if (val === null || val === undefined || val === '') return '';

  var str = String(val).trim().replace('.', ':');
  var parts = str.split(':');

  if (parts.length >= 2) {
    var jam = parseInt(parts[0], 10);
    var menit = parseInt(parts[1], 10);

    if (!isNaN(jam) && !isNaN(menit)) {
      var formattedJam = jam < 10 ? '0' + jam : String(jam);
      var formattedMenit = menit < 10 ? '0' + menit : String(menit);
      return formattedJam + ':' + formattedMenit;
    }
  }

  return str.toLowerCase();
}
