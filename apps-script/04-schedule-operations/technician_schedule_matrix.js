/**
 * =========================================================================
 * TECHNICIAN ROSTER MATRIX & SHIFT CODE NORMALIZER (AUTOMATION ENGINE)
 * =========================================================================
 * Ingests monthly rosters from central scheduling spreadsheet, converts
 * color-coded shift blocks into standardized shift codes (e.g. C15, C31,
 * C47, C01, OFF, CUTI), updates attendance period headers, and generates
 * a transposed daily deployment table with vertical row positioning.
 *
 * FITUR UTAMA:
 * - Kunci Tab Target: Penulisan jadwal & tabel konversi 100% aman hanya di tab 'Rumus Warna'.
 *   Tab 'Draft Jadwal' dan tab lainnya tidak akan pernah tertimpa.
 * - Transpose Vertikal: Tabel transpose harian diformat vertikal (Hari x Teknisi).
 * - Fitur Pemulihan: Fungsi pulihkanDraftJadwal() untuk mengembalikan tab master.
 * - Headless Safe: Kompatibel dengan pemicu berbasis waktu (Time-Driven Trigger).
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
  BORDER_COLOR: "#d0d0d0",
  TIMEZONE: "Asia/Jakarta"
};

const NAMA_BULAN_INDO = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

/**
 * Helper UI yang aman saat dijalankan dari Time-Driven Trigger (Headless Context)
 */
function getUiSafely_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

function kirimNotifikasi_(ui, judul, pesan) {
  if (ui) {
    try {
      ui.alert(judul, pesan, ui.ButtonSet.OK);
      return;
    } catch (e) {}
  }
  console.log(`[${judul}] ${pesan}`);
}

/**
 * MENU CUSTOM GOOGLE SHEETS
 */
function onOpen() {
  const ui = getUiSafely_();
  if (!ui) return;
  ui.createMenu('📅 Manajemen Jadwal & Shift')
    .addItem('1. Tarik Jadwal (Pilih dari B1 / Input)', 'jadwalIVMB1')
    .addItem('2. Tarik Jadwal (Bulan Ini - Auto)', 'jadwalIVMBulanIni')
    .addSeparator()
    .addItem('🛠️ Pulihkan / Reset Tab Draft Jadwal', 'pulihkanDraftJadwal')
    .addToUi();
}

/**
 * Helper pembacaan bulan & tahun dari sel referensi
 */
function ambilPilihanBulanTahun_(targetSS) {
  if (!targetSS) return "";
  const activeSheet = targetSS.getActiveSheet();
  const rumusSheet  = targetSS.getSheetByName("Rumus Warna");
  const draftSheet  = targetSS.getSheetByName("Draft Jadwal");

  const candidates = [
    rumusSheet ? rumusSheet.getRange("B1").getValue() : null,
    activeSheet ? activeSheet.getRange("B1").getValue() : null,
    (draftSheet && draftSheet.getRange("C2").getValue()) 
      ? `${draftSheet.getRange("C2").getValue()} ${draftSheet.getRange("C3").getValue()}` : null,
    (activeSheet && activeSheet.getRange("C2").getValue()) 
      ? `${activeSheet.getRange("C2").getValue()} ${activeSheet.getRange("C3").getValue()}` : null,
    targetSS.getActiveCell() ? targetSS.getActiveCell().getValue() : null
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    let text = "";
    if (raw instanceof Date) {
      text = `${NAMA_BULAN_INDO[raw.getMonth()]} ${raw.getFullYear()}`;
    } else {
      text = String(raw).trim();
    }
    const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 1) {
      const idx = NAMA_BULAN_INDO.findIndex(b => b.toLowerCase() === parts[0]);
      if (idx !== -1) {
        const year = parts.length > 1 && parseInt(parts[1], 10) >= 2000 
          ? parseInt(parts[1], 10) 
          : new Date().getFullYear();
        return `${NAMA_BULAN_INDO[idx]} ${year}`;
      }
    }
  }
  return "";
}

/**
 * FUNGSI 1: Menarik jadwal berdasarkan pilihan bulan/tahun di sel B1 atau input prompt
 */
function jadwalIVMB1() {
  const ui = getUiSafely_();
  const targetSS = SpreadsheetApp.getActiveSpreadsheet();
  if (!targetSS) return;

  let pilihan = ambilPilihanBulanTahun_(targetSS);

  if (!pilihan && ui) {
    const resp = ui.prompt(
      "Pilih Bulan & Tahun",
      "Ketik Bulan dan Tahun yang ingin ditarik:\n(Contoh: Februari 2026)",
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() === ui.Button.OK) {
      pilihan = resp.getResponseText().trim();
    }
  }

  if (!pilihan) {
    kirimNotifikasi_(ui, "Batal", "Penarikan jadwal dibatalkan atau pilihan bulan kosong.");
    return;
  }

  prosesTarikJadwal(pilihan);
}

/**
 * FUNGSI 2: Menarik jadwal otomatis untuk bulan & tahun berjalan saat ini
 */
function jadwalIVMBulanIni() {
  const now = new Date();
  const monthIdx = Number(Utilities.formatDate(now, JADWAL_CONFIG.TIMEZONE, "M")) - 1;
  const yearNum = Number(Utilities.formatDate(now, JADWAL_CONFIG.TIMEZONE, "yyyy"));
  const pilihanAuto = `${NAMA_BULAN_INDO[monthIdx]} ${yearNum}`;

  prosesTarikJadwal(pilihanAuto);
}

/**
 * Helper pencarian tab sumber yang fleksibel
 */
function cariSheetSumberCerdas_(allSheets, kataBulan, kataTahun) {
  for (let i = 0; i < allSheets.length; i++) {
    const sName = allSheets[i].getName().toLowerCase().trim();
    if (sName.includes(kataBulan) && (!kataTahun || sName.includes(kataTahun))) {
      return allSheets[i];
    }
  }
  for (let i = 0; i < allSheets.length; i++) {
    const sName = allSheets[i].getName().toLowerCase().trim();
    if (sName.includes(kataBulan)) {
      return allSheets[i];
    }
  }
  return null;
}

/**
 * FUNGSI UTAMA: PROSES TARIK DATA JADWAL
 */
function prosesTarikJadwal(pilihanBulanTahun) {
  const ui = getUiSafely_();
  const targetSS = SpreadsheetApp.getActiveSpreadsheet();
  if (!targetSS) {
    console.error("Spreadsheet target tidak ditemukan.");
    return;
  }

  // TAB TARGET PENULISAN JADWAL & KONVERSI KODE DIKUNCI KE 'Rumus Warna'
  const rumusWarnaSheet = targetSS.getSheetByName("Rumus Warna") || targetSS.getSheets()[0];
  if (!rumusWarnaSheet) {
    kirimNotifikasi_(ui, "Error", "Tab 'Rumus Warna' tidak ditemukan.");
    return;
  }

  // 1. Buka file sumber
  let sourceSS;
  try {
    sourceSS = SpreadsheetApp.openById(JADWAL_CONFIG.SOURCE_SPREADSHEET_ID);
  } catch (err) {
    kirimNotifikasi_(ui, "Error Koneksi", "Gagal membuka file sumber jadwal. Pastikan ID valid dan memiliki akses.");
    return;
  }

  // 2. Cari tab sheet sumber
  const bagian = pilihanBulanTahun.toLowerCase().split(/\s+/).filter(Boolean);
  const kataBulan = bagian[0] || "";
  const kataTahun = bagian.length > 1 ? bagian[1] : "";
  
  const monthIndex = NAMA_BULAN_INDO.findIndex(b => b.toLowerCase() === kataBulan);
  const yearVal = parseInt(kataTahun, 10) || new Date().getFullYear();

  const allSheets = sourceSS.getSheets();
  const sourceSheet = cariSheetSumberCerdas_(allSheets, kataBulan, kataTahun);

  if (!sourceSheet) {
    const daftarNamaTab = allSheets.map(s => `"${s.getName()}"`).join(", ");
    kirimNotifikasi_(
      ui,
      "Sheet Tidak Ditemukan",
      `Tab untuk '${pilihanBulanTahun}' tidak ditemukan di file sumber!\n\nTab yang tersedia saat ini:\n${daftarNamaTab}`
    );
    return;
  }

  // 3. Update Metadata Setiap Tab Sesuai Fungsinya
  if (monthIndex !== -1) {
    const namaBulanKapital = kataBulan.charAt(0).toUpperCase() + kataBulan.slice(1);
    const maxDaysInMonth = new Date(yearVal, monthIndex + 1, 0).getDate();
    const sheetsInTarget = targetSS.getSheets();

    for (let s = 0; s < sheetsInTarget.length; s++) {
      const sh = sheetsInTarget[s];
      const sName = sh.getName().toLowerCase();

      // Tab Absensi Periode 1 (1 - 15)
      if (sName.includes("1 - 15") || sName.includes("1-15") || (sName.includes("15") && !sName.includes("16"))) {
        sh.getRange("C1:C2").setValues([[`: 1 s/d 15 ${namaBulanKapital}`], [`: ${yearVal}`]]);
      }
      // Tab Absensi Periode 2 (16 - 31)
      else if (sName.includes("16 - 31") || sName.includes("16-31") || sName.includes("16")) {
        sh.getRange("C1:C2").setValues([[`: 16 s/d ${maxDaysInMonth} ${namaBulanKapital}`], [`: ${yearVal}`]]);
      }
      // Tab Draft Jadwal: HANYA ubah C2 (Bulan) & C3 (Tahun) — TABEL MASTER TIDAK DISENTUH!
      else if (sName.includes("draft jadwal") || sName.includes("jadwal kerja")) {
        sh.getRange("C2").setValue(namaBulanKapital);
        sh.getRange("C3").setValue(yearVal);
        try {
          sh.getRange("B1:C1").clearContent();
        } catch (e) {}
      }
      // Tab Rumus Warna: Simpan pilihan di B1 dan bersihkan C1
      else if (sName.includes("rumus warna") || sName.includes("rumus")) {
        sh.getRange("B1").setValue(`${namaBulanKapital} ${yearVal}`);
        try {
          sh.getRange("C1").clearContent();
          sh.getRange("C2").setValue(namaBulanKapital);
          sh.getRange("D3").setValue(yearVal);
        } catch (e) {}
      }
    }
  }

  // 4. Ambil data sumber
  const sourceDataRange = sourceSheet.getDataRange();
  const sourceValues    = sourceDataRange.getValues();
  const sourceBg        = sourceDataRange.getBackgrounds();
  const sourceFC        = sourceDataRange.getFontColors();
  const sourceFW        = sourceDataRange.getFontWeights();

  if (sourceValues.length < 2) {
    kirimNotifikasi_(ui, "Data Kosong", `Sheet sumber '${sourceSheet.getName()}' tidak memiliki baris data yang cukup.`);
    return;
  }

  // 5. Deteksi Baris Header & Kolom Tanggal
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

  function parseDayNumber(cellVal) {
    if (cellVal instanceof Date) return cellVal.getDate();
    if (typeof cellVal === "number") return (cellVal >= 1 && cellVal <= 31) ? Math.floor(cellVal) : NaN;
    if (!cellVal) return NaN;
    const num = parseInt(String(cellVal).trim(), 10);
    return (!isNaN(num) && num >= 1 && num <= 31) ? num : NaN;
  }

  let dateRowIdx = headerRowCandidate + 1;
  let dayRowIdx  = headerRowCandidate;

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

  let lastDateCol = nameColIdx;
  for (let c = nameColIdx + 1; c < sourceValues[dateRowIdx].length; c++) {
    if (!isNaN(parseDayNumber(sourceValues[dateRowIdx][c]))) {
      lastDateCol = c;
    }
  }

  const totalColsNeeded = (lastDateCol - nameColIdx) + 1;
  if (totalColsNeeded < 2) {
    kirimNotifikasi_(ui, "Format Tidak Sesuai", `Gagal mendeteksi kolom tanggal pada sheet sumber '${sourceSheet.getName()}'.`);
    return;
  }

  // 6. Mapping Nama
  const rowMap = {};
  for (let r = 0; r < sourceValues.length; r++) {
    const raw = String(sourceValues[r][nameColIdx] || "").trim().toLowerCase().replace(/\s+/g, ' ');
    if (raw) rowMap[raw] = r;
  }

  // 7. Bersihkan Area Kerja HANYA di 'Rumus Warna'
  const clearRows = Math.max(rumusWarnaSheet.getLastRow() - 4, 70);
  const clearCols = Math.max(rumusWarnaSheet.getLastColumn(), totalColsNeeded);
  rumusWarnaSheet.getRange(5, 1, clearRows, clearCols)
                 .clearContent()
                 .clearFormat()
                 .setBorder(false, false, false, false, false, false);

  // 8. Tulis Header Harian di 'Rumus Warna'
  const dayRowData = sourceValues[dayRowIdx].slice(nameColIdx + 1, lastDateCol + 1);
  const dateRowData = sourceValues[dateRowIdx].slice(nameColIdx + 1, lastDateCol + 1);

  for (let d = 0; d < dateRowData.length; d++) {
    const dayNum = parseDayNumber(dateRowData[d]);
    if (!isNaN(dayNum)) dateRowData[d] = dayNum;
  }

  dayRowData.unshift("Teknisi");
  dateRowData.unshift("");

  const headerRange = rumusWarnaSheet.getRange(5, 1, 2, totalColsNeeded);
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

  // 9. Tulis Jadwal Teknisi Target di 'Rumus Warna'
  const targetNames = JADWAL_CONFIG.TARGET_NAMES;
  const newValues = [];
  const newBg     = [];
  const newFC     = [];
  const newFW     = [];

  for (let k = 0; k < targetNames.length; k++) {
    const foundRow = cariBarisTeknisi_(targetNames[k], rowMap, sourceValues, nameColIdx);

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

  const startRowJadwal = 7;
  const targetRange = rumusWarnaSheet.getRange(startRowJadwal, 1, newValues.length, totalColsNeeded);
  targetRange.setValues(newValues)
             .setBackgrounds(newBg)
             .setFontColors(newFC)
             .setFontWeights(newFW)
             .setVerticalAlignment("middle")
             .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  rumusWarnaSheet.getRange(startRowJadwal, 1, newValues.length, 1).setHorizontalAlignment("left").setFontWeight("bold");
  rumusWarnaSheet.getRange(startRowJadwal, 2, newValues.length, totalColsNeeded - 1).setHorizontalAlignment("center");
  rumusWarnaSheet.setColumnWidth(1, 140);

  // 10. Tulis TABEL KONVERSI KODE di 'Rumus Warna'
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

  rumusWarnaSheet.getRange(headerRowConverted, 1)
                 .setValue("TABEL KONVERSI KODE")
                 .setFontWeight("bold")
                 .setFontSize(11);

  const convertedRange = rumusWarnaSheet.getRange(startRowConverted, 1, convertedValues.length, totalColsNeeded);
  convertedRange.setValues(convertedValues)
                .setHorizontalAlignment("center")
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  rumusWarnaSheet.getRange(startRowConverted, 1, convertedValues.length, 1)
                 .setHorizontalAlignment("left")
                 .setFontWeight("bold");

  // 11. TABEL TRANSPOSE HARIAN (VERTIKAL: Hari x Teknisi)
  const startRowTranspose = startRowConverted + convertedValues.length + 1;
  rumusWarnaSheet.getRange(startRowTranspose, 1)
                 .setValue("TABEL TRANSPOSE HARIAN")
                 .setFontWeight("bold")
                 .setFontSize(11);

  const numDays = totalColsNeeded - 1;
  const numTechs = convertedValues.length;
  const transposedData = [];

  for (let d = 1; d <= numDays; d++) {
    const dayRow = [];
    for (let t = 0; t < numTechs; t++) {
      dayRow.push(convertedValues[t][d] || "");
    }
    transposedData.push(dayRow);
  }

  if (transposedData.length > 0 && transposedData[0].length > 0) {
    rumusWarnaSheet.getRange(startRowTranspose + 1, 1, 40, Math.max(numTechs, 15))
                   .clearContent()
                   .clearFormat()
                   .setBorder(false, false, false, false, false, false);

    const transposeRange = rumusWarnaSheet.getRange(startRowTranspose + 1, 1, transposedData.length, numTechs);
    transposeRange.setValues(transposedData)
                  .setHorizontalAlignment("center")
                  .setVerticalAlignment("middle")
                  .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  }

  SpreadsheetApp.flush();

  const successMsg = `Berhasil menarik jadwal '${sourceSheet.getName()}'!\n` +
                     `- Target Data: Tab 'Rumus Warna'\n` +
                     `- Transpose Harian: ${transposedData.length} Hari x ${numTechs} Teknisi\n` +
                     `- Tab Absensi & Draft Jadwal terupdate otomatis.`;
  kirimNotifikasi_(ui, "Tarik Jadwal Sukses", successMsg);
}

/**
 * Helper pencocokan nama teknisi dengan normalisasi fleksibel
 */
function cariBarisTeknisi_(targetName, rowMap, sourceValues, nameColIdx) {
  const targetClean = targetName.toLowerCase().trim().replace(/\s+/g, ' ');
  if (rowMap[targetClean] !== undefined) return rowMap[targetClean];

  for (const nameKey in rowMap) {
    if (nameKey.startsWith(targetClean) || targetClean.startsWith(nameKey)) {
      return rowMap[nameKey];
    }
  }

  const targetParts = targetClean.split(' ');
  for (const nameKey in rowMap) {
    const keyParts = nameKey.split(' ');
    if (targetParts[0] === keyParts[0]) {
      if (targetParts.length > 1 && keyParts.length > 1) {
        if (targetParts[1].charAt(0) === keyParts[1].charAt(0)) {
          return rowMap[nameKey];
        }
      }
    }
  }

  for (let r = 0; r < sourceValues.length; r++) {
    const cellVal = String(sourceValues[r][nameColIdx] || "").toLowerCase().trim();
    if (cellVal.includes(targetClean) || targetClean.includes(cellVal)) {
      if (cellVal.length >= 3) return r;
    }
  }

  return -1;
}

/**
 * LOGIKA KONVERSI KODE SHIFT BERDASARKAN TEKS & WARNA
 */
function konversiKodeWarna(val, bgHex) {
  val = String(val || "").trim();
  const hex = String(bgHex || "").toLowerCase();

  const isYellow = (
    hex === "#ffff00" || hex === "#fff2cc" || hex === "#ffe599" ||
    hex === "#ffd966" || hex === "#f1c232" || hex === "#ffeb3b" ||
    hex.startsWith("#fff") || hex.startsWith("#ffe") || hex.startsWith("#ffd")
  );

  const isGreen = (
    hex === "#00ff00" || hex === "#d9ead3" || hex === "#b6d7a8" ||
    hex === "#93c47d" || hex === "#6aa84f" || hex === "#4caf50" ||
    hex.startsWith("#b6d") || hex.startsWith("#93c") || hex.startsWith("#d9e")
  );

  const isCyan = (
    hex === "#00ffff" || hex === "#c9daf8" || hex === "#a4c2f4" ||
    hex === "#6d9eeb" || hex === "#4a86e8" || hex === "#00bcd4" ||
    hex.startsWith("#00f") || hex.startsWith("#c9d") || hex.startsWith("#a4c")
  );

  const isRed = (
    hex === "#ff0000" || hex === "#f4cccc" || hex === "#ea9999" ||
    hex === "#e06666" || hex === "#cc0000" || hex === "#f44336" ||
    hex.startsWith("#ff0") || hex.startsWith("#f4c") || hex.startsWith("#ea9")
  );

  const isGrey = (
    hex === "#cccccc" || hex === "#d9d9d9" || hex === "#b7b7b7" ||
    hex === "#9e9e9e" || hex === "#eeeeee" || hex.startsWith("#ccc") ||
    hex.startsWith("#d9d")
  );

  const cleanVal = val.toLowerCase();

  if (isYellow) {
    if (val === "1" || val.includes("1")) return "D50";
    if (val === "2" || val.includes("2")) return "D54";
    if (val === "3" || val.includes("3")) return "D53";
    return "D49";
  }

  if (isGreen) {
    if (val === "1" || val.includes("1")) return "C17";
    if (val === "2" || val.includes("2")) return "C01";
    if (val === "3" || val.includes("3")) return "C33";
    return "C15";
  }

  if (cleanVal.includes("cuti") || isRed) return "CUTI";
  if (cleanVal === "off" || isGrey) return "OFF";
  if (cleanVal.includes("tl") || isCyan) return "TL";
  if (cleanVal.includes("fs")) return "FS";
  if (cleanVal.includes("sakit") || cleanVal === "s") return "SAKIT";
  if (cleanVal.includes("ijin") || cleanVal === "i") return "IJIN";
  if (cleanVal.includes("dt")) return "DT";
  if (cleanVal.includes("oh")) return "OH";
  if (cleanVal.includes("ln")) return "LN";

  return val;
}

/**
 * FUNGSI PEMULIHAN / RESET TAB DRAFT JADWAL
 * Mengembalikan struktur master 15 teknisi dengan rumus dinamis ke 'Rumus Warna'.
 */
function pulihkanDraftJadwal() {
  const ui = getUiSafely_();
  const targetSS = SpreadsheetApp.getActiveSpreadsheet();
  if (!targetSS) return;

  const draftSheet = targetSS.getSheetByName("Draft Jadwal");
  if (!draftSheet) {
    kirimNotifikasi_(ui, "Error", "Tab 'Draft Jadwal' tidak ditemukan.");
    return;
  }

  const lastRow = Math.max(draftSheet.getLastRow(), 65);
  const lastCol = Math.max(draftSheet.getLastColumn(), 36);
  draftSheet.getRange(4, 1, lastRow - 3, lastCol)
            .clearContent()
            .clearFormat()
            .setBorder(false, false, false, false, false, false);

  draftSheet.getRange("B1:C1").clearContent();

  draftSheet.getRange("A1").setValue("JADWAL TEKNISI STASIUN TRANSMISI")
            .setFontWeight("bold")
            .setFontSize(12);

  draftSheet.getRange("A2").setValue("Bulan").setFontWeight("bold");
  draftSheet.getRange("A3").setValue("Tahun").setFontWeight("bold");

  let bulanAktif = "Februari";
  let tahunAktif = 2026;
  const rumusSheet = targetSS.getSheetByName("Rumus Warna");
  if (rumusSheet) {
    const valB1 = String(rumusSheet.getRange("B1").getValue() || "").trim();
    const parts = valB1.split(/\s+/).filter(Boolean);
    if (parts.length >= 1) bulanAktif = parts[0];
    if (parts.length >= 2) tahunAktif = parseInt(parts[1], 10) || 2026;
  }

  draftSheet.getRange("C2").setValue(bulanAktif).setFontWeight("bold");
  draftSheet.getRange("C3").setValue(tahunAktif).setFontWeight("bold");

  const headerCols = ["NO", "NIK", "NAMA", "COMPANY"];
  for (let d = 1; d <= 31; d++) {
    headerCols.push(d);
  }
  const headerRange = draftSheet.getRange(4, 1, 1, headerCols.length);
  headerRange.setValues([headerCols])
             .setFontWeight("bold")
             .setHorizontalAlignment("center")
             .setVerticalAlignment("middle")
             .setBackground("#ffffff")
             .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  const masterTeknisi = [
    [1, "010001", "Teknisi Tetap 1", "2026-12-31"],
    [2, "010002", "Teknisi Tetap 2", "2026-12-31"],
    [3, "010003", "Teknisi Tetap 3", "2026-12-31"],
    [4, "010004", "Teknisi Tetap 4", "2026-12-31"],
    [5, "010005", "Teknisi Tetap 5", "2026-12-31"],
    [6, "010006", "Teknisi Tetap 6", "2026-12-31"],
    [7, "010007", "Teknisi Tetap 7", "2026-12-31"],
    [8, "020001", "Teknisi Mitra 1", "2026-12-31"],
    [9, "020002", "Teknisi Mitra 2", "2026-12-31"],
    [10, "020003", "Teknisi Mitra 3", "2026-12-31"],
    [11, "020004", "Teknisi Mitra 4", "2026-12-31"],
    [12, "020005", "Teknisi Mitra 5", "2026-12-31"],
    [13, "020006", "Teknisi Mitra 6", "2026-12-31"],
    [14, "020007", "Teknisi Mitra 7", "2026-12-31"],
    [15, "020008", "Teknisi Mitra 8", "2026-12-31"]
  ];

  const dataRows = [];
  for (let i = 0; i < masterTeknisi.length; i++) {
    const row = [...masterTeknisi[i]];
    for (let d = 1; d <= 31; d++) row.push("");
    dataRows.push(row);
  }

  const dataRange = draftSheet.getRange(5, 1, dataRows.length, headerCols.length);
  dataRange.setValues(dataRows)
           .setVerticalAlignment("middle")
           .setBorder(true, true, true, true, true, true, JADWAL_CONFIG.BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  draftSheet.getRange(5, 1, dataRows.length, 1).setHorizontalAlignment("center");
  draftSheet.getRange(5, 2, dataRows.length, 1).setHorizontalAlignment("center").setNumberFormat("@");
  draftSheet.getRange(5, 3, dataRows.length, 1).setHorizontalAlignment("left");
  draftSheet.getRange(5, 4, dataRows.length, 1).setHorizontalAlignment("center");
  draftSheet.getRange(5, 5, dataRows.length, 31).setHorizontalAlignment("center");

  // Pasang Rumus Referensi Dinamis ke 'Rumus Warna' pada Baris 12 s/d 19
  const outsourcingFormulas = [];
  for (let techIdx = 0; techIdx < 8; techIdx++) {
    const sourceRow = 18 + techIdx;
    const rowFormula = [];
    for (let day = 1; day <= 31; day++) {
      const colLetter = toColLetter_(day + 1);
      rowFormula.push(`='Rumus Warna'!${colLetter}${sourceRow}`);
    }
    outsourcingFormulas.push(rowFormula);
  }

  draftSheet.getRange(12, 5, outsourcingFormulas.length, 31).setFormulas(outsourcingFormulas);

  SpreadsheetApp.flush();
  kirimNotifikasi_(ui, "Sukses Pemulihan", "Tab 'Draft Jadwal' berhasil dipulihkan ke format master 15 teknisi dengan rumus terhubung ke 'Rumus Warna'!");
}

function toColLetter_(colNum) {
  let temp = "";
  let letter = "";
  while (colNum > 0) {
    temp = (colNum - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colNum = (colNum - temp - 1) / 26;
  }
  return letter;
}
