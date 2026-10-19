/**
 * =========================================================================
 * TECHNICIAN ROSTER MATRIX & SHIFT CODE NORMALIZER (IVM ENGINE)
 * =========================================================================
 * Ingests monthly rosters from central scheduling spreadsheet, converts
 * color-coded shift blocks into standardized shift codes (e.g. C15, C31,
 * C47, C01, OFF, CUTI), updates attendance period headers, and generates
 * a transposed daily deployment table with dynamic row positioning.
 */

const JADWAL_CONFIG = {
  SOURCE_SPREADSHEET_ID: "YOUR_SOURCE_SCHEDULE_SPREADSHEET_ID",
  TARGET_NAMES: [
    "Teknisi 1",
    "Teknisi 2",
    "Teknisi 3",
    "Teknisi 4",
    "Teknisi 5",
    "Teknisi 6",
    "Teknisi 7",
    "Teknisi 8",
    "Teknisi 9"
  ],
  BORDER_COLOR: "#d0d0d0"
};

const NAMA_BULAN_INDO = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

/**
 * MENU CUSTOM GOOGLE SHEETS
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Jadwal IVM')
    .addItem('1. Tarik Jadwal (Pilih dari B1)', 'jadwalIVMB1')
    .addItem('2. Tarik Jadwal (Bulan Ini)', 'jadwalIVMBulanIni')
    .addToUi();
}

/**
 * FUNGSI 1: Menarik jadwal berdasarkan pilihan bulan/tahun di sel B1
 */
function jadwalIVMB1() {
  const ui = SpreadsheetApp.getUi();
  const targetSheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const valB1 = targetSheet.getRange("B1").getValue();
  let pilihan = "";

  if (valB1 instanceof Date) {
    pilihan = `${NAMA_BULAN_INDO[valB1.getMonth()]} ${valB1.getFullYear()}`;
  } else {
    pilihan = String(valB1 || "").trim();
  }

  if (!pilihan) {
    ui.alert("Perhatian", "Pilih atau isi bulan dan tahun di sel B1 terlebih dahulu! (Contoh: Agustus 2026)", ui.ButtonSet.OK);
    return;
  }

  prosesTarikJadwal(pilihan);
}

/**
 * FUNGSI 2: Menarik jadwal otomatis untuk bulan & tahun berjalan saat ini
 */
function jadwalIVMBulanIni() {
  const hariIni = new Date();
  const pilihanAuto = `${NAMA_BULAN_INDO[hariIni.getMonth()]} ${hariIni.getFullYear()}`;
  
  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getRange("B1").setValue(pilihanAuto);
  prosesTarikJadwal(pilihanAuto);
}

/**
 * FUNGSI UTAMA: PROSES TARIK DATA JADWAL
 */
function prosesTarikJadwal(pilihanBulanTahun) {
  const ui = SpreadsheetApp.getUi();
  const targetSS = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = targetSS.getActiveSheet();

  // 1. Validasi & Buka file sumber
  let sourceSS;
  try {
    sourceSS = SpreadsheetApp.openById(JADWAL_CONFIG.SOURCE_SPREADSHEET_ID);
  } catch (err) {
    ui.alert("Error Koneksi", "Gagal membuka file sumber jadwal. Pastikan ID valid dan memiliki akses.", ui.ButtonSet.OK);
    return;
  }

  // 2. Cari tab sheet sumber berdasarkan bulan & tahun
  const bagian = pilihanBulanTahun.toLowerCase().split(" ").filter(Boolean);
  const kataBulan = bagian[0] || "";
  const kataTahun = bagian.length > 1 ? bagian[1] : "";
  
  const monthIndex = NAMA_BULAN_INDO.findIndex(b => b.toLowerCase() === kataBulan);
  const yearVal = parseInt(kataTahun, 10) || new Date().getFullYear();

  const allSheets = sourceSS.getSheets();
  let sourceSheet = null;

  for (let i = 0; i < allSheets.length; i++) {
    const namaSheet = allSheets[i].getName().toLowerCase().trim();
    if (namaSheet.includes(kataBulan) && (!kataTahun || namaSheet.includes(kataTahun))) {
      sourceSheet = allSheets[i];
      break;
    }
  }

  if (!sourceSheet) {
    ui.alert("Sheet Tidak Ditemukan", `Tab untuk '${pilihanBulanTahun}' tidak ditemukan di file sumber!`, ui.ButtonSet.OK);
    return;
  }

  // 3. Update Periode Kehadiran C1:C2 (Hanya pada sheet yang relevan)
  if (monthIndex !== -1) {
    const namaBulanKapital = kataBulan.charAt(0).toUpperCase() + kataBulan.slice(1);
    const maxDaysInMonth = new Date(yearVal, monthIndex + 1, 0).getDate();
    const sheetsInTarget = targetSS.getSheets();

    for (let s = 0; s < sheetsInTarget.length; s++) {
      const sh = sheetsInTarget[s];
      const sName = sh.getName().toLowerCase();
      // Hanya update sheet aktif atau sheet yang mengandung kata periode/kehadiran/16
      if (sh.getSheetId() === targetSheet.getSheetId() || sName.includes("16") || sName.includes("kehadiran") || sName.includes("jadwal")) {
        if (sName.includes("16")) {
          sh.getRange("C1:C2").setValues([[`: 16 s/d ${maxDaysInMonth} ${namaBulanKapital}`], [`: ${yearVal}`]]);
        } else {
          sh.getRange("C1:C2").setValues([[`: 1 s/d 15 ${namaBulanKapital}`], [`: ${yearVal}`]]);
        }
      }
    }
  }

  // 4. Ambil data sumber sekaligus (1x Call)
  const sourceDataRange = sourceSheet.getDataRange();
  const sourceValues    = sourceDataRange.getValues();
  const sourceBg        = sourceDataRange.getBackgrounds();
  const sourceFC        = sourceDataRange.getFontColors();
  const sourceFW        = sourceDataRange.getFontWeights();

  if (sourceValues.length < 2) {
    ui.alert("Data Kosong", "Sheet sumber tidak memiliki baris data yang cukup.", ui.ButtonSet.OK);
    return;
  }

  // 5. Deteksi Baris Header & Kolom Tanggal (Anti-Fail)
  let nameColIdx = -1;
  let headerRowCandidate = -1;

  for (let r = 0; r < Math.min(10, sourceValues.length); r++) {
    for (let c = 0; c < Math.min(6, sourceValues[r].length); c++) {
      const val = String(sourceValues[r][c] || "").trim().toLowerCase();
      if (val === "teknisi" || val === "nama" || val === "nama teknisi") {
        nameColIdx = c;
        headerRowCandidate = r;
        break;
      }
    }
    if (nameColIdx !== -1) break;
  }

  if (nameColIdx === -1) {
    nameColIdx = 0;
    headerRowCandidate = 3;
  }

  let dateRowIdx = headerRowCandidate + 1;
  let dayRowIdx  = headerRowCandidate;

  // Helper membaca angka hari (menangani tipe Date, Number, dan String)
  function parseDayNumber(cellVal) {
    if (cellVal instanceof Date) return cellVal.getDate();
    if (typeof cellVal === "number") return (cellVal >= 1 && cellVal <= 31) ? Math.floor(cellVal) : NaN;
    if (!cellVal) return NaN;
    const num = parseInt(String(cellVal).trim(), 10);
    return (!isNaN(num) && num >= 1 && num <= 31) ? num : NaN;
  }

  // Verifikasi baris mana yang benar-benar memuat tanggal 1-31
  let dateNumbersCount1 = 0;
  let dateNumbersCount2 = 0;
  if (sourceValues[dateRowIdx]) {
    for (let c = nameColIdx + 1; c < sourceValues[dateRowIdx].length; c++) {
      if (!isNaN(parseDayNumber(sourceValues[dateRowIdx][c]))) dateNumbersCount1++;
    }
  }
  if (sourceValues[dayRowIdx]) {
    for (let c = nameColIdx + 1; c < sourceValues[dayRowIdx].length; c++) {
      if (!isNaN(parseDayNumber(sourceValues[dayRowIdx][c]))) dateNumbersCount2++;
    }
  }

  if (dateNumbersCount2 > dateNumbersCount1) {
    dateRowIdx = headerRowCandidate;
    dayRowIdx = headerRowCandidate + 1;
  }

  // Hitung batas kolom tanggal
  let lastDateCol = nameColIdx;
  for (let c = nameColIdx + 1; c < sourceValues[dateRowIdx].length; c++) {
    if (!isNaN(parseDayNumber(sourceValues[dateRowIdx][c]))) {
      lastDateCol = c;
    }
  }

  const totalColsNeeded = (lastDateCol - nameColIdx) + 1;
  if (totalColsNeeded < 2) {
    ui.alert("Format Tidak Sesuai", "Gagal mendeteksi kolom tanggal (1 - 31) pada sheet sumber.", ui.ButtonSet.OK);
    return;
  }

  // 6. Mapping Nama di Sheet Sumber (Dengan Normalisasi Fleksibel)
  const rowMap = {};
  for (let r = 0; r < sourceValues.length; r++) {
    const raw = String(sourceValues[r][nameColIdx] || "").trim().toLowerCase().replace(/\s+/g, ' ');
    if (raw) rowMap[raw] = r;
  }

  // 7. Bersihkan Area Target Secara Dinamis (Anti pembengkakan sheet)
  const clearRows = Math.max(targetSheet.getLastRow() - 4, 60);
  const clearCols = Math.max(targetSheet.getLastColumn(), totalColsNeeded);
  targetSheet.getRange(5, 1, clearRows, clearCols)
             .clearContent()
             .clearFormat()
             .setBorder(false, false, false, false, false, false);

  // 8. Tulis Header Harian
  const dayRowData = sourceValues[dayRowIdx].slice(nameColIdx + 1, lastDateCol + 1);
  const dateRowData = sourceValues[dateRowIdx].slice(nameColIdx + 1, lastDateCol + 1);

  // Konversi jika sel tanggal berupa Date object
  for (let d = 0; d < dateRowData.length; d++) {
    const dayNum = parseDayNumber(dateRowData[d]);
    if (!isNaN(dayNum)) dateRowData[d] = dayNum;
  }

  dayRowData.unshift("Teknisi");
  dateRowData.unshift("");

  const headerRange = targetSheet.getRange(5, 1, 2, totalColsNeeded);
  headerRange.setValues([dayRowData, dateRowData]);

  const bgHeader1 = new Array(totalColsNeeded).fill("#ffffff");
  const bgHeader2 = new Array(totalColsNeeded).fill("#c9daf8");
  const fcHeader1 = new Array(totalColsNeeded).fill("#000000");
  const fcHeader2 = new Array(totalColsNeeded).fill("#1155cc");

  headerRange.setBackgrounds([bgHeader1, bgHeader2])
             .setFontColors([fcHeader1, fcHeader2])
             .setFontWeight("bold")
             .setHorizontalAlignment("center")
             .setVerticalAlignment("middle")
             .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  // 9. Filter & Urutkan Jadwal Teknisi
  const targetNames = JADWAL_CONFIG.TARGET_NAMES;
  const newValues = [];
  const newBg     = [];
  const newFC     = [];
  const newFW     = [];

  for (let k = 0; k < targetNames.length; k++) {
    const targetClean = targetNames[k].toLowerCase().trim().replace(/\s+/g, ' ');
    let foundRow = -1;

    if (rowMap[targetClean] !== undefined) {
      foundRow = rowMap[targetClean];
    } else {
      for (const nameKey in rowMap) {
        if (nameKey.startsWith(targetClean) || targetClean.startsWith(nameKey)) {
          foundRow = rowMap[nameKey];
          break;
        }
      }
    }

    if (foundRow !== -1) {
      const scheduleOnly = sourceValues[foundRow].slice(nameColIdx + 1, lastDateCol + 1);
      const bgOnly       = sourceBg[foundRow].slice(nameColIdx + 1, lastDateCol + 1);
      const fcOnly       = sourceFC[foundRow].slice(nameColIdx + 1, lastDateCol + 1);
      const fwOnly       = sourceFW[foundRow].slice(nameColIdx + 1, lastDateCol + 1);

      scheduleOnly.unshift(targetNames[k]);
      bgOnly.unshift("#ffffff");
      fcOnly.unshift("#000000");
      fwOnly.unshift("bold");

      newValues.push(scheduleOnly);
      newBg.push(bgOnly);
      newFC.push(fcOnly);
      newFW.push(fwOnly);
    } else {
      const emptyRow = new Array(totalColsNeeded).fill("");
      emptyRow[0] = targetNames[k];
      newValues.push(emptyRow);

      const bgEmpty = new Array(totalColsNeeded).fill("#ffffff");
      const fcEmpty = new Array(totalColsNeeded).fill("#000000");
      const fwEmpty = new Array(totalColsNeeded).fill("normal");
      fwEmpty[0] = "bold";

      newBg.push(bgEmpty);
      newFC.push(fcEmpty);
      newFW.push(fwEmpty);
    }
  }

  // Tulis Jadwal Utama
  const startRowJadwal = 7;
  const targetRange = targetSheet.getRange(startRowJadwal, 1, newValues.length, totalColsNeeded);
  targetRange.setValues(newValues)
             .setBackgrounds(newBg)
             .setFontColors(newFC)
             .setFontWeights(newFW)
             .setVerticalAlignment("middle")
             .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  targetSheet.getRange(startRowJadwal, 1, newValues.length, 1).setHorizontalAlignment("left").setFontWeight("bold");
  targetSheet.getRange(startRowJadwal, 2, newValues.length, totalColsNeeded - 1).setHorizontalAlignment("center");
  targetSheet.setColumnWidth(1, 140);

  // 10. Konversi Kode Warna (Posisi Baris Dinamis)
  const headerRowConverted = startRowJadwal + newValues.length + 1;
  const startRowConverted  = headerRowConverted + 1;
  const convertedValues    = [];

  for (let i = 0; i < newValues.length; i++) {
    const convertedRow = [targetNames[i]];
    for (let j = 1; j < totalColsNeeded; j++) {
      convertedRow.push(konversiKodeWarna(newValues[i][j], newBg[i][j]));
    }
    convertedValues.push(convertedRow);
  }

  targetSheet.getRange(headerRowConverted, 1)
             .setValue("TABEL KONVERSI KODE")
             .setFontWeight("bold")
             .setFontSize(11);

  const convertedRange = targetSheet.getRange(startRowConverted, 1, convertedValues.length, totalColsNeeded);
  convertedRange.setValues(convertedValues)
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  targetSheet.getRange(startRowConverted, 1, convertedValues.length, 1)
             .setHorizontalAlignment("left")
             .setFontWeight("bold")
             .setBackground("#ffffff")
             .setFontColor("#000000");
  targetSheet.getRange(startRowConverted, 2, convertedValues.length, totalColsNeeded - 1)
             .setHorizontalAlignment("center");

  // 11. Transpose Harian (Posisi Baris Dinamis)
  const headerRowTranspose = startRowConverted + convertedValues.length + 1;
  const startRowTranspose  = headerRowTranspose + 1;
  const transposeValues    = [];
  const numDays = totalColsNeeded - 1;

  for (let day = 0; day < numDays; day++) {
    const transposedRow = [];
    for (let tech = 0; tech < convertedValues.length; tech++) {
      transposedRow.push(convertedValues[tech][day + 1]);
    }
    transposeValues.push(transposedRow);
  }

  if (transposeValues.length > 0 && transposeValues[0].length > 0) {
    targetSheet.getRange(headerRowTranspose, 1)
               .setValue("TABEL TRANSPOSE HARIAN")
               .setFontWeight("bold")
               .setFontSize(11);

    const transposeRange = targetSheet.getRange(startRowTranspose, 1, transposeValues.length, transposeValues[0].length);
    transposeRange.setValues(transposeValues)
                  .setHorizontalAlignment("center")
                  .setVerticalAlignment("middle")
                  .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  }

  ui.alert("Berhasil!", `Jadwal '${pilihanBulanTahun}' dan teks periode kehadiran berhasil ditarik dengan rapi.`, ui.ButtonSet.OK);
}

/**
 * HELPER FUNGSI: KONVERSI WARNA & NILAI JADWAL (OPTIMAL & NULL-SAFE)
 */
function konversiKodeWarna(val, bg) {
  const value = String(val == null ? "" : val).trim();
  const backgroundColor = String(bg || "").toLowerCase();

  const YELLOW_SHADES = new Set(["#ffff00", "#fff2cc", "#ffe599", "#ffd966"]);
  const GREEN_SHADES  = new Set(["#92d050", "#38761d", "#6aa84f", "#8fce00", "#d9ead3", "#b6d7a8"]);
  const RED_SHADES    = new Set(["#ff0000", "#f44336", "#e6b8b8", "#fce5cd", "#f4ccd0"]);
  const BLUE_SHADES   = new Set(["#00ffff", "#00b0f0", "#9fc5e8", "#c9daf8", "#4a86e8"]);

  const isYellow = YELLOW_SHADES.has(backgroundColor);
  const isGreen  = GREEN_SHADES.has(backgroundColor);
  const isRed    = RED_SHADES.has(backgroundColor);
  const isBlue   = BLUE_SHADES.has(backgroundColor);

  const valUpper = value.toUpperCase();

  if (valUpper === "DT") return "C47*";
  if (valUpper === "FS") return "C47'";
  if (valUpper === "SAKIT") return "SAKIT";
  if ((isYellow || isGreen) && valUpper === "OFF") return "OFF";
  if (isRed && valUpper === "CUTI") return "CUTI";
  if (isBlue && valUpper === "TL") return "D49*";

  if (isYellow) {
    switch (value) {
      case "1":  return "C15";
      case "2":  return "C31";
      case "3":  return "C47";
      case "1*": return "D49";
      case "3*": return "D50";
      default:   return value;
    }
  } 
  
  if (isGreen) {
    switch (value) {
      case "1":  return "C17";
      case "2":  return "C33";
      case "3":  return "C01";
      case "1*": return "D53";
      case "3*": return "D54";
      default:   return value;
    }
  }

  return value;
}
