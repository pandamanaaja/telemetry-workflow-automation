/**
 * ==============================================================================
 * POINTER-BASED INCREMENTAL PDF REPORT GENERATOR (GENSET & GUESTBOOK)
 * ==============================================================================
 * Automatically monitors newly submitted or logged rows in a raw data sheet
 * using a persistent pointer stored in ScriptProperties (LAST_PROCESSED_ROW).
 * Extracts tabular metrics, applies layout styling, exports the rendered sheet
 * to PDF via Drive Export API, and archives the file into site-specific folders.
 *
 * Supported Output Format:
 * Laporan Buku Tamu (Nama Site) (Tanggal) (Jam).pdf
 * Example: Laporan Buku Tamu (Bekasi) (07-11-2026) (08.25).pdf
 * Atau opsi format standar tanpa kurung:
 * Example: Laporan Buku Tamu Bekasi 07-11-2026 08.25.pdf
 * ==============================================================================
 */

const PDF_CONFIG = {
  TIMEZONE: "Asia/Jakarta",
  DATA_SHEET_NAME: "Data_Mentah",
  LOCK_TIMEOUT_MS: 30000,
  PROPERTY_KEY_LAST_ROW: "LAST_PROCESSED_ROW",

  // Baseline row awal: baris sebelum baseline ini dianggap telah diproses
  DEFAULT_BASELINE_ROW: 51,

  // Profil konfigurasi laporan
  PROFILES: {
    bukuTamu: {
      reportType: "Laporan Buku Tamu",
      siteColumnIndex: 2,       // Kolom B
      tanggalColumnIndex: 11,   // Kolom K
      jamColumnIndex: null      // Kolom jam terpisah jika ada (null = otomatis ekstrak dari kolom tanggal / waktu proses)
    },
    genset: {
      reportType: "Laporan Genset",
      siteColumnIndex: 2,       // Kolom B
      tanggalColumnIndex: 51,   // Kolom AY
      jamColumnIndex: null
    }
  },

  ACTIVE_PROFILE: "bukuTamu", // 'bukuTamu' atau 'genset'

  // Gaya penamaan file:
  // "PARENTHESES" -> Laporan Buku Tamu (Bekasi) (07-11-2026) (08.25).pdf
  // "CLEAN"       -> Laporan Buku Tamu Bekasi 07-11-2026 08.25.pdf
  FILENAME_STYLE: "PARENTHESES",

  // Konfigurasi Site & Destinasi Folder Google Drive
  // CATATAN KEAMANAN: Kredensial / ID Folder disensor dengan placeholder
  SITES: {
    bekasi: {
      keyword: ["bekasi"],
      label: "Bekasi",
      reportSheetName: "Bekasi",
      folderId: "YOUR_BEKASI_FOLDER_ID"
    },
    hambalang: {
      keyword: ["hambalang"],
      label: "Hambalang",
      reportSheetName: "Hambalang",
      folderId: "YOUR_HAMBALANG_FOLDER_ID"
    },
    kebon_jeruk: {
      keyword: ["kebon jeruk", "kebonjeruk", "kb jeruk", "kb. jeruk"],
      label: "Kebon Jeruk",
      reportSheetName: "Kebon Jeruk",
      folderId: "YOUR_KEBON_JERUK_FOLDER_ID"
    }
  }
};

/**
 * Fungsi polling utama: Mengecek dan membuat PDF untuk baris-baris baru
 */
function cekDanBuatPDF() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(PDF_CONFIG.LOCK_TIMEOUT_MS)) {
    Logger.log("Proses lain sedang berjalan. Eksekusi dibatalkan.");
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dataSheet = ss.getSheetByName(PDF_CONFIG.DATA_SHEET_NAME);

    if (!dataSheet) {
      throw new Error("Sheet data tidak ditemukan: " + PDF_CONFIG.DATA_SHEET_NAME);
    }

    const lastRow = dataSheet.getLastRow();
    if (lastRow <= 1) {
      Logger.log("Belum ada data.");
      return;
    }

    const props = PropertiesService.getScriptProperties();
    let savedLastRow = props.getProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW);

    let lastProcessedRow;
    if (!savedLastRow) {
      props.setProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW, String(PDF_CONFIG.DEFAULT_BASELINE_ROW));
      lastProcessedRow = PDF_CONFIG.DEFAULT_BASELINE_ROW;
      Logger.log("Baseline awal diinisialisasi ke row " + lastProcessedRow);
    } else {
      lastProcessedRow = parseInt(savedLastRow, 10);
    }

    Logger.log(`Status -> Sheet Last Row: ${lastRow} | Last Processed: ${lastProcessedRow}`);

    if (lastRow <= lastProcessedRow) {
      Logger.log("Belum ada baris baru.");
      return;
    }

    // =========================================================================
    // OPTIMASI: BATCH READ (Ambil seluruh baris baru sekaligus dalam 1 request)
    // =========================================================================
    const profile = PDF_CONFIG.PROFILES[PDF_CONFIG.ACTIVE_PROFILE] || PDF_CONFIG.PROFILES.genset;
    const numNewRows = lastRow - lastProcessedRow;
    const startRow = lastProcessedRow + 1;
    const maxColumn = Math.max(
      profile.siteColumnIndex, 
      profile.tanggalColumnIndex, 
      profile.jamColumnIndex || 0
    );

    const rowsData = dataSheet.getRange(startRow, 1, numNewRows, maxColumn).getValues();
    const siteList = Object.values(PDF_CONFIG.SITES);

    for (let i = 0; i < rowsData.length; i++) {
      const currentRow = startRow + i;
      const rowData = rowsData[i];

      const siteRaw = rowData[profile.siteColumnIndex - 1];
      const tanggalValue = rowData[profile.tanggalColumnIndex - 1];
      const jamValue = profile.jamColumnIndex ? rowData[profile.jamColumnIndex - 1] : null;
      const siteValue = String(siteRaw || "").trim().toLowerCase();

      Logger.log(`Memproses Row ${currentRow} | Site: ${siteRaw} | Tanggal: ${tanggalValue}`);

      // 1. Cek baris kosong total (Site & Tanggal kosong) -> Lewati dan majukan pointer agar tidak macet permanen
      if (!siteValue && (!tanggalValue || String(tanggalValue).trim() === "")) {
        Logger.log(`Row ${currentRow}: Baris kosong terdeteksi. Skip & majukan pointer.`);
        props.setProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW, String(currentRow));
        continue;
      }

      // 2. Cek kelengkapan tanggal jika site terisi -> Menunggu operator melengkapi input pada trigger berikutnya
      if (!tanggalValue || String(tanggalValue).trim() === "") {
        Logger.log(`Row ${currentRow}: Site terisi (${siteRaw}), namun Tanggal masih kosong. Menunggu pengisian lengkap.`);
        break;
      }

      // 3. Cek kelengkapan site
      if (!siteValue) {
        Logger.log(`Row ${currentRow}: Site kosong. Skip.`);
        props.setProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW, String(currentRow));
        continue;
      }

      // 4. Cocokkan konfigurasi site (Mendukung Multi-Keyword)
      const siteConfig = siteList.find(s => {
        if (Array.isArray(s.keyword)) {
          return s.keyword.some(k => siteValue.includes(k.toLowerCase()));
        }
        return siteValue.includes(String(s.keyword).toLowerCase());
      });

      if (!siteConfig) {
        Logger.log(`Row ${currentRow}: Site tidak dikenali (${siteRaw}). Skip.`);
        props.setProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW, String(currentRow));
        continue;
      }

      // 5. Ekstraksi Tanggal & Jam terformat
      const { strTanggal, strJam } = formatTanggalDanJam_(tanggalValue, jamValue);

      // 6. Ekspor PDF dengan identifier tanggal dan jam
      try {
        buatPDFDariSheet_(ss, siteConfig, currentRow, profile.reportType, strTanggal, strJam);
        // Simpan checkpoint progress jika ekspor berhasil
        props.setProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW, String(currentRow));
      } catch (errRow) {
        Logger.log(`[ERROR] Gagal export PDF di Row ${currentRow} (${siteConfig.label}): ${errRow.message}`);
        break; // Hentikan agar baris yang gagal tidak terlewat dan dapat diinvestigasi
      }
    }

    Logger.log("Pemrosesan baris baru selesai.");

  } catch (error) {
    Logger.log("ERROR: " + error.message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper: Ekstraksi dan formatting Tanggal serta Jam dari cell data
 */
function formatTanggalDanJam_(tanggalVal, jamVal) {
  const tz = PDF_CONFIG.TIMEZONE;
  let strTanggal = "";
  let strJam = "";

  // Olah Tanggal
  if (tanggalVal instanceof Date) {
    strTanggal = Utilities.formatDate(tanggalVal, tz, "dd-MM-yyyy");
    if (!jamVal && (tanggalVal.getHours() !== 0 || tanggalVal.getMinutes() !== 0)) {
      strJam = Utilities.formatDate(tanggalVal, tz, "HH.mm");
    }
  } else if (tanggalVal) {
    const parsed = new Date(tanggalVal);
    if (!isNaN(parsed.getTime())) {
      strTanggal = Utilities.formatDate(parsed, tz, "dd-MM-yyyy");
      if (!jamVal && (parsed.getHours() !== 0 || parsed.getMinutes() !== 0)) {
        strJam = Utilities.formatDate(parsed, tz, "HH.mm");
      }
    } else {
      strTanggal = String(tanggalVal).trim().replace(/[/\\:]/g, "-");
    }
  }

  // Olah Jam
  if (jamVal) {
    if (jamVal instanceof Date) {
      strJam = Utilities.formatDate(jamVal, tz, "HH.mm");
    } else {
      strJam = String(jamVal).trim().replace(/:/g, ".");
    }
  }

  // Fallback ke waktu eksekusi jika komponen kosong
  const now = new Date();
  if (!strTanggal) strTanggal = Utilities.formatDate(now, tz, "dd-MM-yyyy");
  if (!strJam) strJam = Utilities.formatDate(now, tz, "HH.mm");

  return { strTanggal, strJam };
}

/**
 * Helper: Merender sheet ke PDF via Google Sheets Export endpoint
 */
function buatPDFDariSheet_(ss, siteConfig, rowNumber, reportType, strTanggal, strJam) {
  const reportSheet = ss.getSheetByName(siteConfig.reportSheetName);
  if (!reportSheet) {
    throw new Error("Sheet laporan tidak ditemukan: " + siteConfig.reportSheetName);
  }

  if (!siteConfig.folderId || siteConfig.folderId.startsWith("YOUR_")) {
    throw new Error(`Folder ID untuk site "${siteConfig.label}" belum dikonfigurasi (masih placeholder).`);
  }

  // Paksa flushing kalkulasi formula sheet sebelum PDF di-generate
  SpreadsheetApp.flush();

  const folder = DriveApp.getFolderById(siteConfig.folderId);
  const token = ScriptApp.getOAuthToken();

  // Format Penamaan File:
  // Mendukung: "Laporan Buku Tamu (Bekasi) (07-11-2026) (08.25).pdf" atau tanpa tanda kurung
  // Titik dua (:) diganti dengan titik (.) agar aman di filesystem Windows/Mac/Linux
  const fileName = PDF_CONFIG.FILENAME_STYLE === "PARENTHESES"
    ? `${reportType} (${siteConfig.label}) (${strTanggal}) (${strJam}).pdf`
    : `${reportType} ${siteConfig.label} ${strTanggal} ${strJam}.pdf`;

  const exportUrl =
    "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export" +
    "?format=pdf" +
    "&gid=" + reportSheet.getSheetId() +
    "&size=A4" +
    "&portrait=true" +
    "&fitw=true" +
    "&sheetnames=false" +
    "&printtitle=false" +
    "&pagenumbers=false" +
    "&gridlines=false" +
    "&fzr=false" +
    "&top_margin=0.30" +
    "&bottom_margin=0.30" +
    "&left_margin=0.30" +
    "&right_margin=0.30";

  const response = UrlFetchApp.fetch(exportUrl, {
    headers: {
      Authorization: "Bearer " + token
    },
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  if (responseCode !== 200) {
    throw new Error(
      "Gagal export PDF untuk sheet '" + reportSheet.getName() +
      "'. HTTP " + responseCode +
      ". Body: " + response.getContentText()
    );
  }

  const file = folder.createFile(response.getBlob().setName(fileName));
  Logger.log(`[SUKSES] PDF berhasil dibuat: ${file.getName()}`);
}

// ==========================================
// PENGATURAN BASELINE (MANUAL & UTILITY)
// ==========================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Otomasi PDF')
    .addItem('▶️ Jalankan Cek Data Sekarang', 'testPDFManual')
    .addSeparator()
    .addItem('🎯 Set Baseline Baris (Dialog)', 'setBaselineManualUI')
    .addItem('🔄 Reset Baseline (Default)', 'resetLastProcessedRow')
    .addItem('📊 Cek Status Baseline', 'cekStatusBaseline')
    .addToUi();
}

function setBaselineManualUI() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Set Baseline Baris Terakhir', 
    'Masukkan nomor baris terakhir yang ingin dijadikan acuan (baseline):', 
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() == ui.Button.OK) {
    const inputRow = parseInt(response.getResponseText().trim(), 10);
    
    if (isNaN(inputRow) || inputRow < 1) {
      ui.alert('Error', 'Nomor baris tidak valid. Harap masukkan angka yang benar.', ui.ButtonSet.OK);
      return;
    }

    PropertiesService.getScriptProperties().setProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW, String(inputRow));
    ui.alert('Sukses', 'Baseline berhasil diset ke row ' + inputRow + '.', ui.ButtonSet.OK);
    Logger.log("Baseline diset manual ke row " + inputRow);
  }
}

function setBaselineKeBarisTertentu(nomorBaris) {
  const targetRow = nomorBaris || PDF_CONFIG.DEFAULT_BASELINE_ROW;
  PropertiesService.getScriptProperties().setProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW, String(targetRow));
  Logger.log("Baseline berhasil diset manual ke row " + targetRow);
}

function resetLastProcessedRow() {
  PropertiesService.getScriptProperties().deleteProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW);
  Logger.log("Baseline berhasil di-reset. Eksekusi berikutnya akan mengacu ke nilai default.");
}

function cekStatusBaseline() {
  const props = PropertiesService.getScriptProperties();
  const savedLastRow = props.getProperty(PDF_CONFIG.PROPERTY_KEY_LAST_ROW);
  Logger.log(savedLastRow ? `Baseline saat ini: Row ${savedLastRow}` : `Baseline belum diset (default: ${PDF_CONFIG.DEFAULT_BASELINE_ROW})`);
}

function testPDFManual() {
  cekDanBuatPDF();
}
