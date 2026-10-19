/**
 * ==============================================================================
 * ENGINE OTOMATISASI LAPORAN TAGIHAN LISTRIK PLN
 * ==============================================================================
 * Alur Kerja:
 * 1. PDF struk tagihan diunggah (Form / Drive Dropzone).
 * 2. n8n mengekstrak data via Gemini Vision AI dan menulis ke sheet Master (Master_PLN).
 * 3. Script ini secara OTOMATIS membaca data Master, mengolah metrik KPI,
 *    dan menyusun Laporan Eksekutif yang rapi di tab "Laporan_PLN".
 *
 * Fitur Utama:
 * - Ringkasan KPI Eksekutif (Total Biaya, Total kWh, Rata-rata Biaya/kWh, Status Pelunasan).
 * - Format otomatis Rupiah (Rp), desimal kWh, dan indikator warna status Lunas.
 * - Auto-Trigger: Terpicu otomatis setiap kali n8n menambahkan baris data baru.
 * - Menu Interaktif: Tersedia tombol manual untuk refresh & filter bulanan.
 * ==============================================================================
 */

// ==============================================================================
// KONFIGURASI NAMA SHEET & FORMAT
// ==============================================================================
const PLN_CONFIG = {
  MASTER_SHEET_CANDIDATES: ["Master_PLN", "Tagihan PLN", "Master", "Sheet1"],
  REPORT_SHEET_NAME: "Laporan_PLN",
  TIMEZONE: "Asia/Jakarta",
  HEADER_COLOR_PRIMARY: "#1e3a8a",    // Deep Navy Blue
  HEADER_COLOR_SECONDARY: "#2563eb",  // Bright Blue
  BG_ZEBRA_ODD: "#ffffff",
  BG_ZEBRA_EVEN: "#f8fafc",
  COLOR_LUNAS_BG: "#dcfce7",          // Hijau Lembut
  COLOR_LUNAS_TEXT: "#15803d",
  COLOR_TAGIHAN_BG: "#fee2e2",        // Merah Lembut
  COLOR_TAGIHAN_TEXT: "#b91c1c"
};

/**
 * Otomatis menambahkan menu interaktif di atas Spreadsheet
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚡ Laporan PLN")
    .addItem("🔄 Perbarui Laporan Sekarang (Semua Periode)", "menuRefreshAllReports")
    .addItem("📅 Filter Laporan Berdasarkan Bulan...", "menuFilterByMonth")
    .addSeparator()
    .addItem("⚙️ Pasang Otomatisasi (Auto-Update saat n8n input)", "menuSetupAutoTrigger")
    .addToUi();
}

/**
 * Mencari tab Master data secara cerdas
 */
function getMasterSheet(ss) {
  for (let name of PLN_CONFIG.MASTER_SHEET_CANDIDATES) {
    let sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }
  // Jika tidak ditemukan, gunakan sheet pertama
  return ss.getSheets()[0];
}

/**
 * Mencari atau membuat tab Laporan jika belum ada
 */
function getOrCreateReportSheet(ss) {
  let reportSheet = ss.getSheetByName(PLN_CONFIG.REPORT_SHEET_NAME);
  if (!reportSheet) {
    reportSheet = ss.insertSheet(PLN_CONFIG.REPORT_SHEET_NAME);
  }
  return reportSheet;
}

/**
 * FUNGSI UTAMA: Membangun Laporan Tagihan PLN Rapi & Terstruktur
 * @param {string} filterBulan Opsional: Nama bulan untuk filter (contoh: "Oktober 2026")
 */
function generatePlnReport(filterBulan) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = getMasterSheet(ss);
  if (!masterSheet) {
    SpreadsheetApp.getUi().alert("Sheet Master tidak ditemukan!");
    return;
  }

  const reportSheet = getOrCreateReportSheet(ss);
  const dataRange = masterSheet.getDataRange();
  const masterValues = dataRange.getValues();

  // Jika master kosong / hanya ada header
  if (masterValues.length <= 1) {
    reportSheet.clear();
    reportSheet.getRange("A1").setValue("Belum ada data tagihan di Sheet Master.");
    return;
  }

  // Identifikasi letak indeks kolom dari master (A:R)
  // [0: Timestamp, 1: Channel, 2: IDPEL, 3: No Meter, 4: Nama, 5: Tarif, 6: Periode,
  //  7: Stand Awal, 8: Stand Akhir, 9: kWh, 10: Tagihan, 11: Admin, 12: Total,
  //  13: Status, 14: Tgl Bayar, 15: No Ref, 16: Metode, 17: Link]
  const rows = [];
  let totalKwh = 0;
  let totalRupiahTagihan = 0;
  let totalAdmin = 0;
  let totalBayarSemua = 0;
  let countLunas = 0;
  let countBelumLunas = 0;
  const uniqueSites = new Set();

  for (let i = 1; i < masterValues.length; i++) {
    const r = masterValues[i];
    const idpel = String(r[2] || "").trim();
    const namaPelanggan = String(r[4] || "").trim();
    const periode = String(r[6] || "").trim();

    // Lewati baris kosong
    if (!idpel && !namaPelanggan) continue;

    // Filter berdasarkan bulan jika parameter diberikan
    if (filterBulan && periode && !periode.toLowerCase().includes(filterBulan.toLowerCase())) {
      continue;
    }

    const kwh = parseFloat(String(r[9] || 0).replace(/[^0-9.]/g, "")) || 0;
    const tagihan = parseFloat(String(r[10] || 0).replace(/[^0-9.]/g, "")) || 0;
    const admin = parseFloat(String(r[11] || 0).replace(/[^0-9.]/g, "")) || 0;
    const total = parseFloat(String(r[12] || 0).replace(/[^0-9.]/g, "")) || (tagihan + admin);
    const status = String(r[13] || "LUNAS").toUpperCase().trim();
    const driveUrl = String(r[17] || "").trim();

    totalKwh += kwh;
    totalRupiahTagihan += tagihan;
    totalAdmin += admin;
    totalBayarSemua += total;

    if (status.includes("LUNAS")) {
      countLunas++;
    } else {
      countBelumLunas++;
    }

    if (idpel) uniqueSites.add(idpel);

    rows.push({
      idpel: idpel,
      noMeter: String(r[3] || "-"),
      nama: namaPelanggan || "-",
      tarif: String(r[5] || "-"),
      periode: periode || "-",
      standAwal: r[7] !== "" ? Number(r[7]) : "-",
      standAkhir: r[8] !== "" ? Number(r[8]) : "-",
      kwh: kwh,
      tagihan: tagihan,
      admin: admin,
      total: total,
      status: status,
      tglBayar: r[14] ? formatDateSafe(r[14]) : "-",
      driveUrl: driveUrl
    });
  }

  // Hitung rata-rata biaya per kWh
  const avgCostPerKwh = totalKwh > 0 ? (totalBayarSemua / totalKwh) : 0;

  // Bersihkan sheet laporan sebelum menulis ulang
  reportSheet.clear();
  reportSheet.clearFormats();
  reportSheet.setHiddenGridlines(false);

  // 1. HEADER UTAMA LAPORAN
  reportSheet.getRange("B1:N1").merge()
    .setValue("⚡ LAPORAN REKAPITULASI BIAYA & KONSUMSI LISTRIK PLN")
    .setFontSize(14)
    .setFontWeight("bold")
    .setFontColor("#1e293b")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  const subtitle = filterBulan 
    ? `Periode: ${filterBulan} | Diperbarui: ${Utilities.formatDate(new Date(), PLN_CONFIG.TIMEZONE, "dd MMM yyyy, HH:mm")} WIB`
    : `Semua Periode Tercatat | Diperbarui: ${Utilities.formatDate(new Date(), PLN_CONFIG.TIMEZONE, "dd MMM yyyy, HH:mm")} WIB`;

  reportSheet.getRange("B2:N2").merge()
    .setValue(subtitle)
    .setFontSize(10)
    .setFontColor("#64748b")
    .setFontStyle("italic")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // 2. KARTU RINGKASAN KPI (EXECUTIVE SUMMARY CARDS)
  // Card 1: TOTAL PENGELUARAN (B4:D5)
  createKpiCard(reportSheet, "B4:D4", "B5:D5", "TOTAL PENGELUARAN", formatRupiahText(totalBayarSemua), "#1e3a8a", "#eff6ff");

  // Card 2: TOTAL KONSUMSI ENERGI (E4:G5)
  createKpiCard(reportSheet, "E4:G4", "E5:G5", "TOTAL KONSUMSI LISTRIK", `${totalKwh.toLocaleString("id-ID", {minimumFractionDigits: 1, maximumFractionDigits: 1})} kWh`, "#0d9488", "#f0fdfa");

  // Card 3: RATA-RATA TARIF / KWH (H4:J5)
  createKpiCard(reportSheet, "H4:J4", "H5:J5", "RATA-RATA BIAYA / KWH", `${formatRupiahText(Math.round(avgCostPerKwh))} / kWh`, "#7c3aed", "#faf5ff");

  // Card 4: STATUS TAGIHAN & SITE (K4:N5)
  const statusSummary = `${uniqueSites.size} Site (${countLunas} Lunas, ${countBelumLunas} Pending)`;
  createKpiCard(reportSheet, "K4:N4", "K5:N5", "JUMLAH SITE & STATUS", statusSummary, countBelumLunas > 0 ? "#b91c1c" : "#15803d", "#f8fafc");

  // 3. HEADER TABEL RINCIAN (Baris 7)
  const tableHeaders = [
    "No",
    "ID Pelanggan (IDPEL)",
    "Nomor Meter",
    "Nama Pelanggan / Site",
    "Tarif / Daya",
    "Periode Tagihan",
    "Stand Awal",
    "Stand Akhir",
    "Konsumsi (kWh)",
    "Tagihan PLN (Rp)",
    "Admin (Rp)",
    "Total Bayar (Rp)",
    "Status",
    "Tanggal Bayar",
    "Struk / Dokumen"
  ];

  const startTableRow = 7;
  const headerRange = reportSheet.getRange(startTableRow, 1, 1, tableHeaders.length);
  headerRange.setValues([tableHeaders])
    .setBackground(PLN_CONFIG.HEADER_COLOR_PRIMARY)
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  reportSheet.setRowHeight(startTableRow, 32);

  // Jika tidak ada data yang lolos filter
  if (rows.length === 0) {
    reportSheet.getRange(startTableRow + 1, 1, 1, tableHeaders.length).merge()
      .setValue("Tidak ada catatan tagihan untuk kriteria ini.")
      .setHorizontalAlignment("center")
      .setFontStyle("italic");
    return;
  }

  // 4. SUSUN BARIS DATA TABEL (Baris 8 dan seterusnya)
  const tableData = [];
  const bgColors = [];
  const fontColors = [];
  const alignments = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const item = rows[idx];
    const isEven = (idx % 2 === 1);
    const defaultBg = isEven ? PLN_CONFIG.BG_ZEBRA_EVEN : PLN_CONFIG.BG_ZEBRA_ODD;

    const strukDisplay = item.driveUrl ? "Lihat PDF ↗" : "-";

    tableData.push([
      idx + 1,
      item.idpel,
      item.noMeter,
      item.nama,
      item.tarif,
      item.periode,
      item.standAwal,
      item.standAkhir,
      item.kwh,
      item.tagihan,
      item.admin,
      item.total,
      item.status,
      item.tglBayar,
      strukDisplay
    ]);

    // Pewarnaan baris
    const isLunas = item.status.includes("LUNAS");
    const statusBg = isLunas ? PLN_CONFIG.COLOR_LUNAS_BG : PLN_CONFIG.COLOR_TAGIHAN_BG;
    const statusText = isLunas ? PLN_CONFIG.COLOR_LUNAS_TEXT : PLN_CONFIG.COLOR_TAGIHAN_TEXT;

    const rowBg = new Array(tableHeaders.length).fill(defaultBg);
    rowBg[12] = statusBg; // Kolom Status

    const rowFontColor = new Array(tableHeaders.length).fill("#1e293b");
    rowFontColor[12] = statusText;
    if (item.driveUrl) rowFontColor[14] = "#2563eb"; // Link PDF

    bgColors.push(rowBg);
    fontColors.push(rowFontColor);
  }

  const dataRangeTarget = reportSheet.getRange(startTableRow + 1, 1, tableData.length, tableHeaders.length);
  dataRangeTarget.setValues(tableData)
    .setBackgrounds(bgColors)
    .setFontColors(fontColors)
    .setVerticalAlignment("middle");

  // Format Angka & Penjajaran
  // Kolom No, IDPEL, No Meter, Periode, Stand, Status, Tgl, Dokumen -> Center
  reportSheet.getRange(startTableRow + 1, 1, tableData.length, 1).setHorizontalAlignment("center");
  reportSheet.getRange(startTableRow + 1, 2, tableData.length, 2).setHorizontalAlignment("center");
  reportSheet.getRange(startTableRow + 1, 4, tableData.length, 1).setHorizontalAlignment("left"); // Nama
  reportSheet.getRange(startTableRow + 1, 5, tableData.length, 2).setHorizontalAlignment("center");
  reportSheet.getRange(startTableRow + 1, 7, tableData.length, 2).setHorizontalAlignment("right").setNumberFormat("#,##0.00");
  reportSheet.getRange(startTableRow + 1, 9, tableData.length, 1).setHorizontalAlignment("right").setNumberFormat("#,##0.00");
  reportSheet.getRange(startTableRow + 1, 10, tableData.length, 3).setHorizontalAlignment("right").setNumberFormat('"Rp "#,##0');
  reportSheet.getRange(startTableRow + 1, 13, tableData.length, 1).setHorizontalAlignment("center").setFontWeight("bold");
  reportSheet.getRange(startTableRow + 1, 14, tableData.length, 1).setHorizontalAlignment("center");
  reportSheet.getRange(startTableRow + 1, 15, tableData.length, 1).setHorizontalAlignment("center").setFontWeight("bold");

  // Tambahkan Hyperlink ke Dokumen Drive
  for (let idx = 0; idx < rows.length; idx++) {
    if (rows[idx].driveUrl) {
      reportSheet.getRange(startTableRow + 1 + idx, 15).setFormula(`=HYPERLINK("${rows[idx].driveUrl}", "Lihat PDF ↗")`);
    }
  }

  // 5. BARIS TOTAL / GRAND SUMMARY DI PALING BAWAH
  const totalRowIdx = startTableRow + 1 + tableData.length;
  reportSheet.getRange(totalRowIdx, 1, 1, 8).merge()
    .setValue("TOTAL KESELURUHAN")
    .setFontWeight("bold")
    .setHorizontalAlignment("right")
    .setVerticalAlignment("middle");

  reportSheet.getRange(totalRowIdx, 9).setValue(totalKwh).setNumberFormat("#,##0.00").setFontWeight("bold");
  reportSheet.getRange(totalRowIdx, 10).setValue(totalRupiahTagihan).setNumberFormat('"Rp "#,##0').setFontWeight("bold");
  reportSheet.getRange(totalRowIdx, 11).setValue(totalAdmin).setNumberFormat('"Rp "#,##0').setFontWeight("bold");
  reportSheet.getRange(totalRowIdx, 12).setValue(totalBayarSemua).setNumberFormat('"Rp "#,##0').setFontWeight("bold");
  reportSheet.getRange(totalRowIdx, 13, 1, 3).merge().setValue(`${countLunas} Lunas, ${countBelumLunas} Pending`).setHorizontalAlignment("center").setFontWeight("bold");

  reportSheet.getRange(totalRowIdx, 1, 1, tableHeaders.length)
    .setBackground("#dbeafe")
    .setFontColor("#1e3a8a")
    .setBorder(true, true, true, true, false, false, "#93c5fd", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Berikan border rapi pada seluruh tabel data
  dataRangeTarget.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  headerRange.setBorder(true, true, true, true, true, true, "#1e3a8a", SpreadsheetApp.BorderStyle.SOLID);

  // Sesuaikan lebar kolom agar nyaman dilihat
  const colWidths = [45, 135, 115, 180, 110, 110, 95, 95, 110, 120, 90, 125, 95, 115, 110];
  for (let c = 0; c < colWidths.length; c++) {
    reportSheet.setColumnWidth(c + 1, colWidths[c]);
  }
}

/**
 * Helper untuk membuat kartu ringkasan KPI
 */
function createKpiCard(sheet, labelMerge, valMerge, label, value, textColor, bgColor) {
  sheet.getRange(labelMerge).merge()
    .setValue(label)
    .setFontSize(9)
    .setFontColor("#64748b")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBackground(bgColor);

  sheet.getRange(valMerge).merge()
    .setValue(value)
    .setFontSize(13)
    .setFontColor(textColor)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBackground(bgColor);

  // Border kartu
  sheet.getRange(labelMerge.split(":")[0] + ":" + valMerge.split(":")[1])
    .setBorder(true, true, true, true, false, false, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Format string Rupiah
 */
function formatRupiahText(num) {
  return "Rp " + Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Format tanggal aman
 */
function formatDateSafe(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, PLN_CONFIG.TIMEZONE, "dd/MM/yyyy");
  }
  return String(val).split(" ")[0];
}

// ==============================================================================
// MENU HANDLER INTERAKTIF
// ==============================================================================
function menuRefreshAllReports() {
  generatePlnReport(null);
  SpreadsheetApp.getActiveSpreadsheet().toast("Laporan PLN berhasil diperbarui!", "⚡ Sukses", 3);
}

function menuFilterByMonth() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Filter Laporan PLN Berdasarkan Bulan",
    "Masukkan nama bulan & tahun (contoh: 'Oktober 2026' atau 'Oktober'):",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const input = response.getResponseText().trim();
    if (input) {
      generatePlnReport(input);
      SpreadsheetApp.getActiveSpreadsheet().toast(`Laporan untuk periode '${input}' berhasil dibuat!`, "⚡ Sukses", 4);
    }
  }
}

/**
 * TRIGGER OTOMATIS SAAT N8N MEMASUKKAN BARIS BARU (onChange)
 */
function onMasterChange(e) {
  try {
    // Jalankan pembaruan laporan secara hening di latar belakang
    generatePlnReport(null);
  } catch (err) {
    console.error("Gagal update laporan otomatis: " + err.message);
  }
}

/**
 * Pasang Trigger onChange secara otomatis lewat menu (1-klik untuk pengguna awam)
 */
function menuSetupAutoTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getProjectTriggers();
  
  // Periksa apakah trigger sudah pernah dibuat
  for (let t of triggers) {
    if (t.getHandlerFunction() === "onMasterChange") {
      SpreadsheetApp.getUi().alert("Otomatisasi sudah aktif sebelumnya! Setiap data baru dari n8n akan otomatis memperbarui tab Laporan.");
      return;
    }
  }

  // Buat installable trigger onChange
  ScriptApp.newTrigger("onMasterChange")
    .forSpreadsheet(ss)
    .onChange()
    .create();

  SpreadsheetApp.getUi().alert("✅ Otomatisasi Berhasil Diaktifkan!\n\nSetiap kali alur kerja n8n selesai memproses PDF dan menambahkan baris ke sheet Master, tab 'Laporan_PLN' akan diperbarui otomatis.");
}
