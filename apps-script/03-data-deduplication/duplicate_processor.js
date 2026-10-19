/**
 * ==============================================================================
 * OTOMATISASI: WARNAI DAN HAPUS DATA DUPLIKAT (HIGH PERFORMANCE & ANTI-LAG)
 * Kriteria Duplikat: Tanggal (Kolom A) + Jam (Kolom B) + Teknisi (Kolom C) SAMA
 * ==============================================================================
 */

// Nama Sheet target. Kosongkan ("") jika ingin berlaku untuk sheet yang sedang aktif.
const TARGET_SHEET_NAME = ""; // Contoh: "Master Metering" atau biarkan ""


// Helper 1: Normalisasi Tanggal ke YYYY-MM-DD (Kebal perbedaan format teks/angka)
function normalizeDateText(val) {
  if (!val) return "";
  const str = String(val).trim().split(' ')[0];
  const separator = str.indexOf('/') !== -1 ? '/' : (str.indexOf('-') !== -1 ? '-' : null);
  
  if (separator) {
    const parts = str.split(separator);
    if (parts.length === 3) {
      const p1 = parseInt(parts[0], 10);
      const p2 = parseInt(parts[1], 10);
      const p3 = parseInt(parts[2], 10);

      // YYYY-MM-DD
      if (p1 > 1000) {
        return `${p1}-${String(p2).padStart(2, '0')}-${String(p3).padStart(2, '0')}`;
      }
      // DD/MM/YYYY
      const y = p3 < 100 ? 2000 + p3 : p3;
      return `${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
    }
  }
  return str;
}

// Helper 2: Normalisasi Jam (Menyamakan '3:00', '03:00', '03.00' menjadi '03:00')
function normalizeJamText(val) {
  if (!val) return "";
  const str = String(val).trim().replace('.', ':');
  const parts = str.split(':');
  if (parts.length >= 2) {
    const jam = parseInt(parts[0], 10);
    const menit = parseInt(parts[1], 10);
    if (!isNaN(jam) && !isNaN(menit)) {
      return `${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')}`;
    }
  }
  return str.toLowerCase();
}

// Helper 3: Mengubah data baris menjadi kunci unik yang seragam
function getRowKey(displayRow) {
  const tsText = normalizeDateText(displayRow[0]);                      // Kolom A: Tanggal
  const jamText = normalizeJamText(displayRow[1]);                      // Kolom B: Jam
  const teknisiText = String(displayRow[2] || "").trim().toLowerCase().replace(/\s+/g, ' '); // Kolom C: Teknisi

  return `${tsText} | ${jamText} | ${teknisiText}`;
}


/**
 * FUNGSI UTAMA: PEMROSESAN DUPLIKAT
 * autoDelete = true  -> Hapus data duplikat secara instan (Batch)
 * autoDelete = false -> Warnai kuning baris duplikat, dan bersihkan baris yang sudah unik
 */
function autoProcessDuplicates(autoDelete = false, targetSheet = null) {
  const sheet = targetSheet || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  if (TARGET_SHEET_NAME && sheet.getName() !== TARGET_SHEET_NAME) return 0;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2 || lastCol < 3) return 0;

  const displayRange = sheet.getRange(1, 1, lastRow, lastCol);
  const displayValues = displayRange.getDisplayValues();
  const valuesData = autoDelete ? displayRange.getValues() : null;

  const seenKeys = new Set();
  const duplicateRowIndices = []; // 0-based index
  const rowsToKeep = autoDelete ? [valuesData[0]] : null;

  for (let i = 1; i < displayValues.length; i++) {
    if (!displayValues[i][0] && !displayValues[i][1] && !displayValues[i][2]) {
      if (autoDelete) rowsToKeep.push(valuesData[i]);
      continue;
    }

    const key = getRowKey(displayValues[i]);
    if (seenKeys.has(key)) {
      duplicateRowIndices.push(i);
    } else {
      seenKeys.add(key);
      if (autoDelete) rowsToKeep.push(valuesData[i]);
    }
  }

  // A. MODE HAPUS OTOMATIS (SUPER KILAT TANPA LOOP DELETEROW)
  if (autoDelete) {
    if (duplicateRowIndices.length === 0) return 0;

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
    return duplicateRowIndices.length;
  }

  // B. MODE WARNAI KUNING (BATCH UPDATE: WARNAI DUPLIKAT & RESET DATA YANG SUDAH UNIK)
  const backgrounds = displayRange.getBackgrounds();

  for (let i = 1; i < displayValues.length; i++) {
    const isDup = duplicateRowIndices.includes(i);
    for (let c = 0; c < lastCol; c++) {
      if (isDup) {
        backgrounds[i][c] = "#FFF2CC"; // Kuning lembut
      } else if (backgrounds[i][c] === "#FFF2CC" || backgrounds[i][c] === "#fff2cc") {
        backgrounds[i][c] = null; // Kembalikan ke warna normal jika data sudah unik
      }
    }
  }

  displayRange.setBackgrounds(backgrounds);
  return duplicateRowIndices.length;
}


/**
 * TRIGGER OTOMATIS 1: onEdit (DENGAN PENYARING AGAR TIDAK FREEZE / LAG)
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  
  if (TARGET_SHEET_NAME && sheet.getName() !== TARGET_SHEET_NAME) return;

  // Optimasi Krusial: Hanya scan jika yang diedit adalah Kolom A (1), B (2), atau C (3)
  const colStart = e.range.getColumn();
  if (colStart > 3 && e.range.getNumColumns() === 1) return;

  // Jalankan penandaan warna kuning secara instan
  autoProcessDuplicates(false, sheet);
}


/**
 * TRIGGER OTOMATIS 2: onFormSubmit
 */
function onFormSubmit(e) {
  const sheet = (e && e.range) ? e.range.getSheet() : SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  autoProcessDuplicates(false, sheet);
}


/**
 * TOMBOL MANUAL NAVBAR
 */
function highlightDuplicates() {
  const count = autoProcessDuplicates(false);
  const ui = SpreadsheetApp.getUi();
  if (count > 0) {
    ui.alert(`Ditemukan ${count} baris data duplikat (ditandai warna kuning).`);
  } else {
    ui.alert("Bagus! Tidak ada data duplikat.");
  }
}

function removeDuplicates() {
  const ui = SpreadsheetApp.getUi();
  const konfirmasi = ui.alert(
    "Konfirmasi Hapus Duplikat",
    "Apakah Anda yakin ingin menghapus seluruh baris data duplikat? Tindakan ini tidak dapat dibatalkan.",
    ui.ButtonSet.YES_NO
  );
  if (konfirmasi !== ui.Button.YES) return;

  const count = autoProcessDuplicates(true);
  if (count > 0) {
    ui.alert(`Berhasil menghapus ${count} baris data duplikat.`);
  } else {
    ui.alert("Tidak ada data duplikat untuk dihapus.");
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ðŸ§¹ Kelola Duplikat')
    .addItem('ðŸŽ¨ Warnai Data Duplikat', 'highlightDuplicates')
    .addItem('ðŸ—‘ï¸ Hapus Data Duplikat', 'removeDuplicates')
    .addToUi();
}
