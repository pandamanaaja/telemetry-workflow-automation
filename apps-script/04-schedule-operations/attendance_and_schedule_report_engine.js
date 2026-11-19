/**
 * ============================================================================
 * ATTENDANCE & WORK SCHEDULE DUAL-REPORT AUTOMATION ENGINE
 * ============================================================================
 * Generates automated bi-monthly employee attendance reports and standalone work
 * schedule spreadsheets for transmission stations and telemetry operations.
 *
 * KEY CAPABILITIES:
 * 1. Dual-Tab Isolation via Official GID:
 *    - Period 1 (1 - 15)  -> GID: 1811891430 (Keeps Period 1, isolates from Period 2)
 *    - Period 2 (16 - 31) -> GID: 89720944   (Keeps Period 2, isolates from Period 1)
 *    - Work Schedule      -> GID: 1975171563 (Creates standalone work schedule file)
 * 2. Realtime Master Synchronization (Auto-Sync):
 *    - Automatically detects the active month and year currently displayed in
 *      the Master Template Spreadsheet ('Rumus Warna' or 'Draft Jadwal').
 *    - When n8n triggers, it seamlessly processes whichever month is active.
 * 3. Idempotent & Test-Safe:
 *    - Prevents accidental duplicates in production while supporting on-demand
 *      recreation during manual test runs.
 *
 * SCRIPT PROPERTIES REQUIRED:
 * - ABSENSI_API_TOKEN: Shared secret token for webhook verification (>= 32 chars).
 * - IVM_V5_TEMPLATE_ID: Google Sheets template ID.
 * - IVM_V5_TEMPLATE_APPROVED: Set to 'YES' after template review.
 * - IVM_V5_MODE: 'TEST' or 'PRODUCTION'.
 * - IVM_V5_TEST_FOLDER_ID: Google Drive folder ID for test output.
 * - IVM_V5_PRODUCTION_APPROVED: Set to 'YES' for production mode.
 */

const IVM_V5_CFG = Object.freeze({
  LEGACY_TEMPLATE_ID: 'YOUR_TEMPLATE_SPREADSHEET_ID',
  PRODUCTION_OUTPUT_FOLDER_ID: 'YOUR_PRODUCTION_OUTPUT_FOLDER_ID',
  TIME_ZONE: 'Asia/Jakarta',
  FIRST_DATA_ROW: 5,
  REPORT_LABEL: 'STATION ATTENDANCE',
  GID_PERIODE_1: 1811891430, // Official Template Tab 1 - 15
  GID_PERIODE_2: 89720944,   // Official Template Tab 16 - 28/29/30/31
  GID_JADWAL_KERJA: 1975171563 // Official Template Tab Work Schedule
});

const IVM_V5_MONTHS = Object.freeze([
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
]);

function ivmV5Props_() { return PropertiesService.getScriptProperties(); }

/**
 * ============================================================================
 * 1. TAB LOCATOR BY GID & SHEET ISOLATION
 * ============================================================================
 */
function ivmV5FindPeriodTab_(book, period) {
  const targetGid = (period === 'FIRST') ? IVM_V5_CFG.GID_PERIODE_1 : IVM_V5_CFG.GID_PERIODE_2;
  const sheet = book.getSheets().find(s => s.getSheetId() === targetGid);
  if (!sheet) {
    throw Error('Tab dengan GID ' + targetGid + ' untuk ' + period + ' tidak ditemukan pada template.');
  }
  return sheet;
}

function ivmSheetIsReferenced_(targetSheet, otherSheetName) {
  const lastRow = targetSheet.getLastRow();
  const lastCol = targetSheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return false;
  const formulas = targetSheet.getRange(1, 1, lastRow, lastCol).getFormulas();
  const pattern = new RegExp("['\"]?" + otherSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['\"]?!", 'i');
  for (let r = 0; r < formulas.length; r++) {
    for (let c = 0; c < formulas[r].length; c++) {
      if (typeof formulas[r][c] === 'string' && pattern.test(formulas[r][c])) {
        return true;
      }
    }
  }
  return false;
}

function ivmV5IsolatePeriodTab_(book, activeSheet, period) {
  const otherGid = (period === 'FIRST') ? IVM_V5_CFG.GID_PERIODE_2 : IVM_V5_CFG.GID_PERIODE_1;
  const allSheets = [...book.getSheets()];
  
  for (const s of allSheets) {
    if (s.getSheetId() === activeSheet.getSheetId()) continue;
    
    if (s.getSheetId() === otherGid) {
      try { book.deleteSheet(s); } catch (e) { console.warn('Hapus tab lawan:', e); }
    } else {
      if (ivmSheetIsReferenced_(activeSheet, s.getName())) {
        s.hideSheet();
      } else {
        try { book.deleteSheet(s); } catch (e) { s.hideSheet(); }
      }
    }
  }
  book.setActiveSheet(activeSheet);
}

/**
 * ============================================================================
 * 2. PREFLIGHT DIAGNOSTICS & TEST RUNNERS
 * ============================================================================
 */
function cekKonfigurasiV5() {
  const props = ivmV5Props_();
  const templateId = ivmV5GetApprovedTemplateId_();
  const folder = ivmV52OutputFolder_();
  const book = SpreadsheetApp.openById(templateId);
  
  if (book.getSpreadsheetTimeZone() !== IVM_V5_CFG.TIME_ZONE) {
    book.setSpreadsheetTimeZone(IVM_V5_CFG.TIME_ZONE);
    SpreadsheetApp.flush();
    console.log('Timezone template salinan otomatis disetel ke Asia/Jakarta.');
  }

  const sheetP1 = ivmV5FindPeriodTab_(book, 'FIRST');
  const sheetP2 = ivmV5FindPeriodTab_(book, 'SECOND');
  const sheetJadwal = book.getSheets().find(s => s.getSheetId() === IVM_V5_CFG.GID_JADWAL_KERJA);
  const employeesP1 = ivmV5ReadBlocks_(sheetP1);
  const employeesP2 = ivmV5ReadBlocks_(sheetP2);
  
  const now = ivmV5Now_();
  const result = {
    ok: true,
    execution_mode: ivmV52Mode_(),
    template_id: templateId,
    template_name: book.getName(),
    output_folder_name: folder.getName(),
    tab_periode_1: `${sheetP1.getName()} (GID: ${sheetP1.getSheetId()}, ${employeesP1.length} pegawai, ${employeesP1[0].count} baris/pegawai)`,
    tab_periode_2: `${sheetP2.getName()} (GID: ${sheetP2.getSheetId()}, ${employeesP2.length} pegawai, ${employeesP2[0].count} baris/pegawai)`,
    tab_jadwal_kerja: sheetJadwal ? `${sheetJadwal.getName()} (GID: ${sheetJadwal.getSheetId()})` : 'TIDAK DITEMUKAN',
    example_first: ivmV5Period_(now.year, now.month, 'FIRST').title,
    example_second: ivmV5Period_(now.year, now.month, 'SECOND').title,
    example_jadwal: `Template Jadwal Kerja ${IVM_V5_MONTHS[now.month - 1]} ${now.year}`,
    token_configured: String(props.getProperty('ABSENSI_API_TOKEN') || '').length >= 32,
    fitur: 'Tab otomatis: Laporan Periode 1 (GID 1811891430), Periode 2 (GID 89720944), dan Jadwal Kerja (GID 1975171563).'
  };
  console.log(JSON.stringify(result));
  return result;
}

function testBuatAbsensiPeriode1() {
  const now = ivmV5Now_();
  return ivmV5Create_(now.year, now.month, 'FIRST', true);
}

function testBuatAbsensiPeriode2() {
  const now = ivmV5Now_();
  return ivmV5Create_(now.year, now.month, 'SECOND', true);
}

/**
 * ============================================================================
 * 3. WEBHOOK ENDPOINT FOR N8N (doPost)
 * ============================================================================
 */
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 2000) throw Error('Request tidak valid.');
    const body = JSON.parse(raw);
    const expectedToken = ivmV5Props_().getProperty('ABSENSI_API_TOKEN');
    if (!expectedToken || expectedToken.length < 32 ||
        typeof body.token !== 'string' || !ivmV52SafeEqual_(body.token, expectedToken)) {
      throw Error('Akses ditolak.');
    }
    if (body.action !== 'create_absensi_file') throw Error('Action tidak valid.');

    const now = ivmV5Now_();
    const mode = ivmV52Mode_();
    const isManualTest = (body.mode === 'MANUAL_TEST' || body.mode === 'MANUAL_PILIHAN');

    // ============================================================================
    // REALTIME AUTO-SYNC DENGAN BULAN AKTIF DI MASTER SPREADSHEET
    // ============================================================================
    const detected = ivmV5DetectMonthFromTemplate_();
    let yearToRun, monthToRun;

    if (body.force_explicit_date === true && body.month && body.year) {
      yearToRun = Number(body.year);
      monthToRun = Number(body.month);
    } else if (detected) {
      yearToRun = detected.year;
      monthToRun = detected.month;
      console.log(`[SYNC MASTER] Mengikuti bulan aktif: ${IVM_V5_MONTHS[monthToRun - 1]} ${yearToRun} (sumber: ${detected.source})`);
    } else {
      yearToRun = (Number(body.year) >= 2000 && Number(body.year) <= 2100) ? Number(body.year) : now.year;
      monthToRun = (Number(body.month) >= 1 && Number(body.month) <= 12) ? Number(body.month) : now.month;
    }

    if (mode === 'PRODUCTION' && !isManualTest) {
      const isSecondPeriodDay = (now.day === 28) || (now.day === Math.min(30, ivmV5DaysInMonth_(yearToRun, monthToRun)));
      if (now.day !== 16 && !isSecondPeriodDay) {
        return ivmV5Json_({ok: true, status: 'skipped', note: 'Bukan tanggal pembuatan laporan WIB.'});
      }
    }

    const periodToRun = (body.period === 'SECOND') ? 'SECOND' : 'FIRST';
    const forceRecreate = (isManualTest && body.force_recreate === true);

    // 1. Buat Laporan Absensi Utama
    const absensiResult = ivmV5Create_(yearToRun, monthToRun, periodToRun, forceRecreate);

    // 2. Buat File Template Jadwal Kerja (Tab GID 1975171563)
    let jadwalResult = null;
    try {
      jadwalResult = ivmV5CreateJadwalKerja_(yearToRun, monthToRun, forceRecreate);
    } catch (jadwalErr) {
      console.warn('Pembuatan file jadwal kerja gagal:', jadwalErr);
      jadwalResult = { ok: false, error: String(jadwalErr.message || jadwalErr) };
    }

    absensiResult.jadwal_kerja = jadwalResult;
    absensiResult.master_sync = {
      detected_from: detected ? detected.source : 'Fallback System Clock',
      month_name: IVM_V5_MONTHS[monthToRun - 1],
      year: yearToRun
    };
    return ivmV5Json_(absensiResult);
  } catch (err) {
    console.error('Absensi Engine error:', String(err && err.message || err));
    return ivmV5Json_({ok: false, status: 'error', error: String(err && err.message || err)});
  }
}

/**
 * ============================================================================
 * 4. CONFIGURATION GETTERS & UTILITIES
 * ============================================================================
 */
function ivmV52Mode_() {
  const p = ivmV5Props_();
  const m = String(p.getProperty('IVM_V52_MODE') || p.getProperty('IVM_V5_MODE') || 'TEST').toUpperCase();
  if (!['TEST', 'PRODUCTION'].includes(m)) throw Error('IVM_V52_MODE wajib TEST atau PRODUCTION.');
  return m;
}

function ivmV52OutputFolder_() {
  const p = ivmV5Props_();
  const mode = ivmV52Mode_();
  let id;
  if (mode === 'PRODUCTION') {
    const prodApproved = (p.getProperty('IVM_V52_PRODUCTION_APPROVED') === 'YES') || 
                         (p.getProperty('IVM_V5_PRODUCTION_APPROVED') === 'YES');
    if (!prodApproved)
      throw Error('NO-GO: PRODUCTION belum disetujui, gunakan folder TEST.');
    id = IVM_V5_CFG.PRODUCTION_OUTPUT_FOLDER_ID;
  } else {
    id = String(p.getProperty('IVM_V52_TEST_FOLDER_ID') || p.getProperty('IVM_V5_TEST_FOLDER_ID') || '').trim();
    if (!/^[A-Za-z0-9_-]{20,}$/.test(id))
      throw Error('NO-GO: isi IVM_V52_TEST_FOLDER_ID dengan folder pengujian yang valid.');
    if (id === IVM_V5_CFG.PRODUCTION_OUTPUT_FOLDER_ID)
      throw Error('NO-GO: folder TEST tidak boleh sama dengan folder PRODUKSI.');
  }
  return DriveApp.getFolderById(id);
}

function ivmV52SafeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let mismatch = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

function ivmV5GetApprovedTemplateId_() {
  const p = ivmV5Props_();
  const id = String(p.getProperty('IVM_V5_TEMPLATE_ID') || p.getProperty('IVM_V52_TEMPLATE_ID') || '').trim();
  const approved = (p.getProperty('IVM_V5_TEMPLATE_APPROVED') === 'YES') || 
                   (p.getProperty('IVM_V52_TEMPLATE_APPROVED') === 'YES');
  if (!approved || !id || id === IVM_V5_CFG.LEGACY_TEMPLATE_ID || !/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw Error('NO-GO: butuh salinan template yang sudah diaudit, lalu set APPROVED=YES.');
  }
  return id;
}

/**
 * Mendeteksi secara cerdas bulan & tahun yang aktif di Master Spreadsheet.
 * Prioritas 1: Baca tab 'Rumus Warna' sel B1 (Contoh: "Februari 2026")
 * Prioritas 2: Baca tab 'Draft Jadwal' sel C2 (Bulan) & C3 (Tahun)
 * Prioritas 3: Baca tab 'Copy of 1 - 15' sel C1 (Contoh: ": 1 s/d 15 Februari")
 */
function ivmV5DetectMonthFromTemplate_() {
  try {
    const templateId = ivmV5GetApprovedTemplateId_();
    const book = SpreadsheetApp.openById(templateId);

    // Prioritas 1: Tab 'Rumus Warna' (Paling utama tempat jadwal ditarik)
    const rumusSheet = book.getSheetByName("Rumus Warna");
    if (rumusSheet) {
      const rawB1 = String(rumusSheet.getRange("B1").getValue() || "").trim();
      const parts = rawB1.split(/\s+/).filter(Boolean);
      if (parts.length >= 1) {
        const mIdx = IVM_V5_MONTHS.findIndex(m => m.toLowerCase() === parts[0].toLowerCase());
        const yVal = parts.length > 1 ? parseInt(parts[1], 10) : new Date().getFullYear();
        if (mIdx !== -1) {
          return {
            month: mIdx + 1,
            year: (!isNaN(yVal) && yVal >= 2000 && yVal <= 2100) ? yVal : new Date().getFullYear(),
            source: 'Rumus Warna (B1)'
          };
        }
      }
      const rawC2 = String(rumusSheet.getRange("C2").getValue() || "").trim().toLowerCase();
      const mIdxC2 = IVM_V5_MONTHS.findIndex(m => m.toLowerCase() === rawC2);
      if (mIdxC2 !== -1) {
        const yVal = parseInt(rumusSheet.getRange("D3").getValue(), 10) || new Date().getFullYear();
        return {
          month: mIdxC2 + 1,
          year: (!isNaN(yVal) && yVal >= 2000 && yVal <= 2100) ? yVal : new Date().getFullYear(),
          source: 'Rumus Warna (C2:D3)'
        };
      }
    }

    // Prioritas 2: Tab 'Draft Jadwal' (C2 = Bulan, C3 = Tahun)
    const draftSheet = book.getSheetByName("Draft Jadwal");
    if (draftSheet) {
      const bNama = String(draftSheet.getRange("C2").getValue() || "").trim().toLowerCase();
      const tVal = parseInt(draftSheet.getRange("C3").getValue(), 10);
      const mIdx = IVM_V5_MONTHS.findIndex(m => m.toLowerCase() === bNama);
      if (mIdx !== -1) {
        return {
          month: mIdx + 1,
          year: (!isNaN(tVal) && tVal >= 2000 && tVal <= 2100) ? tVal : new Date().getFullYear(),
          source: 'Draft Jadwal (C2:C3)'
        };
      }
    }

    // Prioritas 3: Tab 'Copy of 1 - 15'
    const sheetP1 = book.getSheets().find(s => s.getSheetId() === IVM_V5_CFG.GID_PERIODE_1 || s.getName().includes("1 - 15"));
    if (sheetP1) {
      const rawC1 = String(sheetP1.getRange("C1").getValue() || "").trim().toLowerCase();
      const rawC2 = String(sheetP1.getRange("C2").getValue() || "").trim();
      const yVal = parseInt(rawC2.replace(/[^0-9]/g, ''), 10) || new Date().getFullYear();
      for (let i = 0; i < IVM_V5_MONTHS.length; i++) {
        if (rawC1.includes(IVM_V5_MONTHS[i].toLowerCase())) {
          return {
            month: i + 1,
            year: (!isNaN(yVal) && yVal >= 2000 && yVal <= 2100) ? yVal : new Date().getFullYear(),
            source: `${sheetP1.getName()} (C1:C2)`
          };
        }
      }
    }
  } catch (e) {
    console.warn("Gagal deteksi otomatis bulan template:", e);
  }
  return null;
}

function ivmV5DaysInMonth_(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ivmV5Period_(year, month, period) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !['FIRST','SECOND'].includes(period)) throw Error('Periode tidak valid.');
  const first = period === 'FIRST' ? 1 : 16;
  const last = period === 'FIRST' ? 15 : ivmV5DaysInMonth_(year, month);
  const monthName = IVM_V5_MONTHS[month - 1];
  return {
    year, month, period, start: first, end: last, days: last - first + 1,
    monthName,
    title: `Absensi (${first} - ${last}) ${monthName} ${year} ${IVM_V5_CFG.REPORT_LABEL}`
  };
}

function ivmV5Now_() {
  const [year, month, day] = Utilities.formatDate(new Date(), IVM_V5_CFG.TIME_ZONE, 'yyyy-MM-dd')
    .split('-').map(Number);
  return { year, month, day };
}

function ivmV5Date_(year, month, day) {
  const dateText = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')} 12:00:00`;
  return Utilities.parseDate(dateText, IVM_V5_CFG.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
}

function ivmV5Json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function ivmV5ReadBlocks_(sheet) {
  const start = IVM_V5_CFG.FIRST_DATA_ROW;
  const n = sheet.getLastRow() - start + 1;
  if (n < 5) throw Error('Template tidak memuat data pegawai.');
  const vals = sheet.getRange(start, 1, n, 3).getDisplayValues();
  const blocks = [];
  let i = 0;
  const registered = new Set();
  if (!ivmV5IsEmployeeRow_(vals[0])) throw Error('Data pegawai pertama harus dimulai di baris 5.');
  while (i < vals.length && ivmV5IsEmployeeRow_(vals[i])) {
    const row = vals[i];
    const nik = String(row[1]).trim();
    const name = String(row[2]).trim();
    const key = nik + '|' + name;
    if (registered.has(key)) throw Error('Pegawai muncul dalam blok terpisah: ' + name);
    registered.add(key);
    const blockStart = i;
    const sequences = [];
    while (i < vals.length && ivmV5IsEmployeeRow_(vals[i]) &&
           String(vals[i][1]).trim() === nik && String(vals[i][2]).trim() === name) {
      sequences.push(Number(String(vals[i][0]).trim()));
      i++;
    }
    if (sequences.length !== 15 && sequences.length !== 16) {
      throw Error('NO-GO: ' + name + ' (' + nik + ') memiliki ' + sequences.length +
        ' baris. Tab absensi harus memuat tepat 15 atau 16 baris tetap per pegawai.');
    }
    for (let k = 1; k < sequences.length; k++) {
      if (sequences[k] !== sequences[k - 1] + 1) {
        throw Error('Nomor urut dalam blok ' + name + ' tidak berurutan pada baris ' + (start + blockStart + k));
      }
    }
    blocks.push({ startRow: start + blockStart, nik, name, count: sequences.length });
  }
  if (!blocks.length) throw Error('Tidak ditemukan blok pegawai.');
  return blocks;
}

function ivmV5IsEmployeeRow_(r) {
  if (!r) return false;
  const num = Number(String(r[0] || '').trim());
  return Number.isInteger(num) && num > 0 &&
    String(r[1] || '').trim().length > 0 && String(r[2] || '').trim().length > 0;
}

function ivmV52FindErrors_(sheet, blocks, activeDays) {
  if (!Number.isInteger(activeDays) || activeDays < 1 || activeDays > 16)
    throw Error('Jumlah hari aktif tidak valid untuk pemeriksaan rumus.');
  const errors = [];
  const errorRE = /^(#REF!|#N\/A|#VALUE!|#DIV\/0!|#ERROR!|#NAME\?|#NUM!|#NULL!|#SPILL!)(?:\s|$)/i;
  for (const b of blocks) {
    const daysToCheck = Math.min(activeDays, b.count);
    const values = sheet.getRange(b.startRow, 1, daysToCheck, 12).getDisplayValues();
    for (let r = 0; r < values.length; r++) for (let c = 0; c < 12; c++) {
      if (c === 3) continue;
      const value = String(values[r][c] == null ? '' : values[r][c]).trim();
      if (errorRE.test(value)) {
        errors.push({ employee: b.name, row: b.startRow + r, column: String.fromCharCode(65 + c), error: value });
      }
    }
  }
  return { count: errors.length, examples: errors.slice(0, 12) };
}

function ivmV52ValidateActiveFormulas_(sheet, blocks, p) {
  const found = ivmV52FindErrors_(sheet, blocks, p.days);
  if (found.count) {
    const cells = found.examples.map(e => `${e.column}${e.row} (${e.employee}: ${e.error})`).join(', ');
    throw Error('NO-GO: ' + found.count + ' sel formula pada baris AKTIF masih error sesudah tanggal diisi. ' + cells);
  }
  return found;
}

function ivmV5Snapshot_(sheet, blocks) {
  return blocks.map(b => {
    const a = sheet.getRange(b.startRow, 1, b.count, 3);
    const other = sheet.getRange(b.startRow, 5, b.count, 8);
    return {
      formulas: [...a.getFormulas().map(r => r.slice()), ...other.getFormulas().map(r => r.slice())],
      staticA: a.getDisplayValues(), staticOther: other.getDisplayValues(),
      formulasA: a.getFormulas(), formulasOther: other.getFormulas()
    };
  });
}

function ivmV5VerifySnapshot_(sheet, blocks, before) {
  for (let bIndex = 0; bIndex < blocks.length; bIndex++) {
    const b = blocks[bIndex];
    const saved = before[bIndex];
    const checks = [
      { col: 1, width: 3, formulas: saved.formulasA, vals: saved.staticA },
      { col: 5, width: 8, formulas: saved.formulasOther, vals: saved.staticOther }
    ];
    for (const item of checks) {
      const range = sheet.getRange(b.startRow, item.col, b.count, item.width);
      const f = range.getFormulas(), v = range.getDisplayValues();
      for (let r = 0; r < b.count; r++) for (let c = 0; c < item.width; c++) {
        if (f[r][c] !== item.formulas[r][c])
          throw Error('Rumus non-target berubah pada ' + b.name + ' row ' + (b.startRow + r) + ' col ' + (item.col + c));
        if (!item.formulas[r][c] && v[r][c] !== item.vals[r][c])
          throw Error('Nilai statis non-target berubah pada ' + b.name + ' row ' + (b.startRow + r) + ' col ' + (item.col + c));
      }
    }
  }
}

function ivmV5Apply_(sheet, blocks, p) {
  sheet.getRange('C1').setValue(`: ${p.start} s/d ${p.end} ${p.monthName}`);
  sheet.getRange('C2').setValue(`: ${p.year}`);
  for (const b of blocks) {
    const totalSlots = b.count;
    const dateValues = [];
    for (let slot = 0; slot < totalSlots; slot++) {
      dateValues.push([slot < p.days ? ivmV5Date_(p.year, p.month, p.start + slot) : '']);
    }
    const r = sheet.getRange(b.startRow, 4, totalSlots, 1);
    r.setValues(dateValues).setNumberFormat('dd/MM/yyyy');
    
    sheet.showRows(b.startRow, Math.min(p.days, totalSlots));
    if (totalSlots > p.days) {
      sheet.hideRows(b.startRow + p.days, totalSlots - p.days);
    }
  }
}

function ivmV5VerifyDates_(sheet, blocks, p) {
  if (sheet.getRange('C1').getDisplayValue() !== `: ${p.start} s/d ${p.end} ${p.monthName}` ||
      sheet.getRange('C2').getDisplayValue() !== `: ${p.year}`)
    throw Error('Validasi C1/C2 gagal.');
  for (const b of blocks) {
    const vals = sheet.getRange(b.startRow, 4, b.count, 1).getValues();
    const activeLimit = Math.min(p.days, b.count);
    for (let slot = 0; slot < b.count; slot++) {
      const v = vals[slot][0];
      if (slot < activeLimit) {
        const expected = `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.start + slot).padStart(2,'0')}`;
        if (!(v instanceof Date) || Utilities.formatDate(v, IVM_V5_CFG.TIME_ZONE, 'yyyy-MM-dd') !== expected)
          throw Error('Tanggal D salah: ' + b.name + ', slot ' + (slot + 1));
      } else if (v !== '') {
        throw Error('Tanggal D pada baris nonaktif harus kosong: ' + b.name + ', slot ' + (slot + 1));
      }
    }
  }
}

/**
 * ============================================================================
 * 5. ATTENDANCE REPORT GENERATOR
 * ============================================================================
 */
function ivmV5Create_(year, month, period, forceRecreate) {
  const p = ivmV5Period_(year, month, period);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let copy = null;
  try {
    const templateId = ivmV5GetApprovedTemplateId_();
    const folder = ivmV52OutputFolder_();
    const matches = folder.getFilesByName(p.title);
    let existing = null;
    while (matches.hasNext()) {
      const f = matches.next();
      if (!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_SHEETS) {
        if (existing) throw Error('Ada lebih dari satu file aktif berjudul sama; periksa manual.');
        existing = f;
      }
    }
    if (existing) {
      if (forceRecreate) {
        try { existing.setTrashed(true); } catch (e) { console.warn('Hapus existing gagal:', e); }
      } else {
        const exBook = SpreadsheetApp.openById(existing.getId());
        const s = ivmV5FindPeriodTab_(exBook, period);
        SpreadsheetApp.flush();
        const blocks = ivmV5ReadBlocks_(s);
        ivmV5VerifyDates_(s, blocks, p);
        ivmV52ValidateActiveFormulas_(s, blocks, p);
        return {
          ok: true, status: 'already_exists', file_name: p.title,
          file_id: existing.getId(), file_url: existing.getUrl(), sheet_url: existing.getUrl() + '#gid=' + s.getSheetId(),
          note: 'File aktif sudah ada dan tanggal lolos verifikasi; tidak dimodifikasi.'
        };
      }
    }

    const original = SpreadsheetApp.openById(templateId);
    if (original.getSpreadsheetTimeZone() !== IVM_V5_CFG.TIME_ZONE) {
      original.setSpreadsheetTimeZone(IVM_V5_CFG.TIME_ZONE);
      SpreadsheetApp.flush();
    }
    const sourceTab = ivmV5FindPeriodTab_(original, period);
    const sourceBlocks = ivmV5ReadBlocks_(sourceTab);

    const temporaryName = `__BUILDING_V5__ ${p.title}`;
    copy = DriveApp.getFileById(templateId).makeCopy(temporaryName, folder);
    const book = SpreadsheetApp.openById(copy.getId());
    book.setSpreadsheetTimeZone(IVM_V5_CFG.TIME_ZONE);

    const sheet = ivmV5FindPeriodTab_(book, period);
    const blocks = ivmV5ReadBlocks_(sheet);
    if (blocks.length !== sourceBlocks.length) throw Error('Jumlah pegawai berubah saat copy.');

    const before = ivmV5Snapshot_(sheet, blocks);
    ivmV5Apply_(sheet, blocks, p);
    SpreadsheetApp.flush();
    ivmV5VerifyDates_(sheet, blocks, p);
    ivmV5VerifySnapshot_(sheet, blocks, before);
    ivmV52ValidateActiveFormulas_(sheet, blocks, p);

    ivmV5IsolatePeriodTab_(book, sheet, period);
    SpreadsheetApp.flush();

    copy.setName(p.title);
    return {
      ok: true, status: 'created', file_name: p.title, file_id: copy.getId(), file_url: copy.getUrl(),
      sheet_url: copy.getUrl() + '#gid=' + sheet.getSheetId(),
      tab_laporan: sheet.getName(),
      tab_gid: sheet.getSheetId(),
      periode: `${p.start} s/d ${p.end} ${p.monthName} ${p.year}`,
      employees_processed: blocks.length, rows_processed: blocks.length * p.days,
      note: 'File laporan absensi berhasil dibuat dengan isolasi tab tunggal.'
    };
  } catch (err) {
    if (copy) {
      try { copy.setTrashed(true); } catch (cleanupErr) {
        console.error('Pembersihan file BUILDING gagal:', String(cleanupErr));
      }
    }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * 6. WORK SCHEDULE REPORT GENERATOR
 * ============================================================================
 */
function ivmV5CreateJadwalKerja_(year, month, forceRecreate) {
  const monthName = IVM_V5_MONTHS[month - 1];
  const title = `Template Jadwal Kerja ${monthName} ${year}`;
  const targetGid = IVM_V5_CFG.GID_JADWAL_KERJA;
  const folder = ivmV52OutputFolder_();

  const matches = folder.getFilesByName(title);
  let existing = null;
  while (matches.hasNext()) {
    const f = matches.next();
    if (!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      if (existing) throw Error('Ada lebih dari satu file jadwal kerja aktif berjudul sama; periksa manual.');
      existing = f;
    }
  }
  if (existing) {
    if (forceRecreate) {
      try { existing.setTrashed(true); } catch (e) { console.warn('Hapus jadwal existing gagal:', e); }
    } else {
      return {
        ok: true, status: 'already_exists', file_name: title,
        file_id: existing.getId(), file_url: existing.getUrl(),
        sheet_url: existing.getUrl() + '#gid=' + targetGid,
        note: 'File jadwal kerja sudah ada; tidak dimodifikasi.'
      };
    }
  }

  let copy = null;
  try {
    const templateId = ivmV5GetApprovedTemplateId_();
    const temporaryName = `__BUILDING_JADWAL__ ${title}`;
    copy = DriveApp.getFileById(templateId).makeCopy(temporaryName, folder);
    const book = SpreadsheetApp.openById(copy.getId());
    book.setSpreadsheetTimeZone(IVM_V5_CFG.TIME_ZONE);

    const allSheets = book.getSheets();
    const jadwalSheet = allSheets.find(s => s.getSheetId() === targetGid);
    if (!jadwalSheet) {
      throw Error('Tab Jadwal Kerja (GID ' + targetGid + ') tidak ditemukan pada template.');
    }

    jadwalSheet.getRange('C2').setValue(monthName);
    jadwalSheet.getRange('C3').setValue(year);

    for (const s of allSheets) {
      if (s.getSheetId() !== targetGid) {
        try { s.hideSheet(); } catch (err) {}
      }
    }
    book.setActiveSheet(jadwalSheet);
    SpreadsheetApp.flush();

    copy.setName(title);
    return {
      ok: true, status: 'created', file_name: title,
      file_id: copy.getId(), file_url: copy.getUrl(),
      sheet_url: copy.getUrl() + '#gid=' + targetGid,
      tab_laporan: jadwalSheet.getName(),
      tab_gid: targetGid,
      note: 'File Template Jadwal Kerja berhasil dibuat mandiri.'
    };
  } catch (err) {
    if (copy) {
      try { copy.setTrashed(true); } catch (cleanupErr) {}
    }
    throw err;
  }
}
