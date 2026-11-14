/**
 * ==============================================================================
 * MASTER METERING SUITE (EDISI v17.0 - MULTI-SHEET & PURE STATISTICAL PATTERN)
 * ==============================================================================
 * 100% BEBAS RUMUS FISIKA TEORITIS - MURNI POLA MEDIAN, MIN-MAX, TYPO & AKUMULATOR
 * Menjalankan seluruh fungsi secara menyeluruh di SEMUA SHEET secara otomatis:
 * • MASTER METERING
 * • BACKUP_BULAN_...
 * • BACKUP_HARI_...
 * • Form Responses / Sheet Data lainnya
 *
 * FITUR UTAMA v17.0:
 * 1. Multi-Sheet Automation: Semua menu bekerja di semua tab yang memiliki data.
 * 2. Pemulihan Waktu Metering: Mengembalikan 7:00, 1:00, 23:00 (Bebas 12/30/1899 & Bebas :25).
 * 3. Parameter Minus Alami: PER, GRID VOLTAGE TX A & B dilindungi sebagai nilai negatif.
 * 4. Backup & Cut-Off: Memindahkan baris ke tab backup dan MENGHAPUSNYA dari sheet master.
 * 5. Anti-Cascade KWH & WBP/LWBP: Toleransi pembulatan manusia 1.0 kWh & proteksi idle line.
 * ==============================================================================
 */

var CONFIG = {
  COLORS: {
    ANOMALY: '#FCE8E6',    // Merah muda lembut untuk anomali / typo
    PREDICTED: '#E6F4EA',  // Hijau muda lembut untuk sel yang berhasil diperbaiki
    ANCHOR: '#FFF2CC'      // Kuning pastel penanda
  },
  // Engine v17.0: Bebas rumus fisika kaku. Menggunakan pola statistik adaptif (Median, Min-Max, IQR).
  PATTERN_SETTINGS: {
    TOLERANCE_KWH_ROUNDING: 1.0, // Selisih turun <= 1.0 kWh adalah toleransi pembulatan manusia
    TOLERANCE_IDLE_LINE: 0.5,    // Toleransi variasi desimal pada meteran cadangan / idle (PLN Secondary / Standby)
    SPIKE_RATIO_TYPO: 3.5,       // Rasio lonjakan typo 10x
    DROP_RATIO_TYPO: 0.25        // Rasio drop typo 0.1x
  },
  BACKUP: {
    DEFAULT_SPREADSHEET_ID: 'YOUR_BACKUP_SPREADSHEET_ID',
    PROP_SS_KEY: 'BACKUP_SPREADSHEET_ID',
    PROP_FOLDER_KEY: 'BACKUP_DRIVE_FOLDER_ID'
  }
};

/**
 * ------------------------------------------------------------------------------
 * DETEKSI SEMUA SHEET DATA (MULTI-SHEET HELPER)
 * Mendeteksi seluruh sheet dalam spreadsheet yang memiliki data metering operasional.
 * ------------------------------------------------------------------------------
 */
function getAllTargetSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var validSheets = [];

  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var r = s.getLastRow();
    var c = s.getLastColumn();
    // Sheet dianggap sebagai sheet data jika memiliki header + minimal 1 baris data (r >= 2) dan kolom operasional (c >= 5)
    if (r >= 2 && c >= 5) {
      validSheets.push(s);
    }
  }

  // Fallback ke sheet aktif jika tidak ditemukan sheet yang memenuhi syarat
  if (validSheets.length === 0) {
    validSheets.push(ss.getActiveSheet());
  }

  return validSheets;
}

/**
 * Helper untuk sheet aktif (khusus operasi sheet tunggal seperti penentuan sumber backup)
 */
function getActiveTargetSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var r = sheet.getLastRow();
  var c = sheet.getLastColumn();
  if (r >= 2 && c >= 5) {
    return sheet;
  }
  return ss.getSheetByName('MASTER METERING') || ss.getSheetByName('MASTER-RESPONSE-MET') || sheet;
}

/**
 * Deteksi apakah sebuah parameter secara alami bertanda minus (PER, GRID VOLTAGE TX A & B)
 */
function isNaturallyNegativeColumn(header, median) {
  var h = String(header || '').toUpperCase();
  // 1. Parameter transmisi / pemancar yang secara teknis memang bertanda minus:
  if (/\bPER\b/i.test(h) || h.indexOf('GRID VOLTAGE') !== -1 || h.indexOf('GRID VOLT') !== -1) {
    return true;
  }
  // 2. Statistik adaptif: jika mayoritas data (median) bernilai negatif:
  if (median !== null && median < -0.5) {
    return true;
  }
  return false;
}

/**
 * ------------------------------------------------------------------------------
 * MENU UTAMA SPREADSHEET
 * ------------------------------------------------------------------------------
 */
function onOpen() {
  var ui = getSafeUi();
  if (!ui) return;

  ui.createMenu('⚡ Master Metering Suite')
    .addItem('🔍 1. Pindai SEMUA Sheet (Pola Median, Min-Max, Typo & Spike - Bebas Fisika)', 'pindaiSemuaAnomali')
    .addItem('📅 2. Urutkan Waktu Riil Shift (Semua Sheet)', 'sortRowsChronologicallyByDateTime')
    .addSeparator()
    .addItem('⚡ 3. Terapkan Perbaikan KWH & WBP/LWBP (Semua Sheet)', 'perbaikiKwhDanWbpLwbp')
    .addItem('🛠️ 4. Terapkan Perbaikan Non-KWH (Semua Sheet)', 'perbaikiNonKwh')
    .addItem('⏱️ 5. Terapkan Perbaikan Hour Meter (Semua Sheet)', 'perbaikiHourMeterBulat')
    .addItem('⏰ 6. Pulihkan Format Waktu Metering (Semua Sheet: 7:00, 1:00, 23:00)', 'pulihkanFormatWaktuMetering')
    .addSeparator()
    .addItem('🧹 7. Hapus Semua Tanda & Catatan (Semua Sheet)', 'hapusSemuaTandaPerbaikan')
    .addSeparator()
    .addSubMenu(ui.createMenu('📦 Suite Backup & Arsip Data')
      .addItem('📅 Backup & Arsipkan Harian (Pindah & Hapus dari Master)', 'backupHarianManual')
      .addItem('📆 Backup & Arsipkan Bulanan (Pindah & Hapus dari Master)', 'backupBulananManual')
      .addItem('💾 Backup Lengkap File Spreadsheet', 'backupLengkapSemuaData')
      .addSeparator()
      .addItem('⚙️ Atur ID Spreadsheet Tujuan Backup', 'aturIdSpreadsheetTujuan')
      .addItem('📁 Atur ID Folder Drive Tujuan Backup', 'aturIdFolderDriveTujuan'))
    .addToUi();
}

/**
 * ------------------------------------------------------------------------------
 * 1. PINDAI SEMUA SHEET SECARA MENYELURUH (100% BEBAS RUMUS FISIKA)
 * ------------------------------------------------------------------------------
 */
function pindaiSemuaAnomali() {
  var targetSheets = getAllTargetSheets();
  if (targetSheets.length === 0) {
    showAlert("Tidak ada sheet yang memiliki data untuk dipindai.");
    return;
  }

  var totalAnomalies = 0;
  var totalProcessed = 0;
  var sheetsReport = [];

  for (var sIdx = 0; sIdx < targetSheets.length; sIdx++) {
    var sheet = targetSheets[sIdx];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var values = dataRange.getValues();
    var backgrounds = dataRange.getBackgrounds();
    var notes = dataRange.getNotes();

    var colStats = computeColumnStats(headers, values);
    var sheetAnomalies = 0;

    var colHourA = findColIndex(headers, ['HOUR METER TX A']);
    var colHourB = findColIndex(headers, ['HOUR METER TX B']);
    var wbpPairs = findWbpLwbpPairs(headers);

    for (var c = 0; c < lastCol; c++) {
      var h = String(headers[c] || '').trim();
      var prof = getColumnCategory(h);
      if (prof === 'SKIP_TEXT') continue;

      var stat = colStats[c];
      var med = stat ? stat.median : null;

      for (var r = 0; r < values.length; r++) {
        totalProcessed++;
        var raw = values[r][c];
        var curNote = notes[r][c];
        var isOldAuditMarker = (curNote && curNote.indexOf('[AUDIT') !== -1);

        // A. Formula Error
        if (typeof raw === 'string' && /#DIV\/0!|#VALUE!|#REF!|#N\/A/i.test(raw)) {
          backgrounds[r][c] = CONFIG.COLORS.ANOMALY;
          notes[r][c] = "[AUDIT - FORMULA ERROR]\n• Nilai: '" + raw + "'";
          sheetAnomalies++;
          continue;
        }

        var v = parseNum(raw);
        if (v === null) {
          if (isOldAuditMarker) {
            backgrounds[r][c] = null;
            notes[r][c] = '';
          }
          continue;
        }

        var anomalyReason = null;
        var recommendedVal = null;

        // B. Parameter Operasional Non-KWH (Murni Pola Statistik Median, Min-Max, Typo & Spike)
        if (prof === 'PURE_PATTERN_NON_KWH') {
          var prevV = (r > 0) ? parseNum(values[r - 1][c]) : null;
          var nextV = (r + 1 < values.length) ? parseNum(values[r + 1][c]) : null;

          if (med !== null) {
            var isNegCol = isNaturallyNegativeColumn(h, med);

            if (isNegCol) {
              // Kolom yang Secara Alami Bernilai Minus (PER, GRID VOLTAGE TX A & B)
              if (v > 0) {
                if (Math.abs(v - Math.abs(med)) < Math.abs(med) * 0.35) {
                  anomalyReason = "Typo lupa tanda minus (" + v + "). Nilai riil harus negatif (-" + v + ").";
                  recommendedVal = -Math.abs(v);
                } else {
                  anomalyReason = "Nilai positif menyimpang (" + v + "). Kolom ini normalnya minus (~" + med + ").";
                  recommendedVal = (prevV !== null && nextV !== null) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : med;
                }
              } else if (Math.abs(v) > Math.abs(med) * CONFIG.PATTERN_SETTINGS.SPIKE_RATIO_TYPO) {
                var absV = Math.abs(v);
                var absMed = Math.abs(med);
                if (Math.abs((absV / 10.0) - absMed) < absMed * 0.35) {
                  recommendedVal = (absMed < 100) ? Math.round((v / 10.0) * 10) / 10 : Math.round(v / 10.0);
                  anomalyReason = "Typo kelebihan digit '0' / koma 10x (" + v + "). Pola normal: ~" + med;
                } else if (Math.abs((absV / 100.0) - absMed) < absMed * 0.35) {
                  recommendedVal = (absMed < 100) ? Math.round((v / 100.0) * 10) / 10 : Math.round(v / 100.0);
                  anomalyReason = "Typo kelebihan digit '00' / koma 100x (" + v + "). Pola normal: ~" + med;
                } else if (Math.abs((absV / 1000.0) - absMed) < absMed * 0.35) {
                  recommendedVal = (absMed < 100) ? Math.round((v / 1000.0) * 10) / 10 : Math.round(v / 1000.0);
                  anomalyReason = "Titik desimal hilang / 1000x (" + v + "). Pola normal: ~" + med;
                } else {
                  anomalyReason = "Lonjakan nilai ekstrem menyimpang dari pola (" + v + " vs normal ~" + med + ").";
                  recommendedVal = (prevV !== null && nextV !== null) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : med;
                }
              } else if (Math.abs(v) < Math.abs(med) * CONFIG.PATTERN_SETTINGS.DROP_RATIO_TYPO && v !== 0) {
                var absV2 = Math.abs(v);
                var absMed2 = Math.abs(med);
                if (Math.abs((absV2 * 10.0) - absMed2) < absMed2 * 0.35) {
                  recommendedVal = (absMed2 < 100) ? Math.round((v * 10.0) * 10) / 10 : Math.round(v * 10.0);
                  anomalyReason = "Typo kurang digit / koma tergeser 0.1x (" + v + "). Pola normal: ~" + med;
                }
              }

              if (!anomalyReason && prevV !== null && nextV !== null) {
                var thSpikeNeg = Math.max(15.0, Math.abs(med) * 0.3);
                var diffPNeg = v - prevV;
                var diffNNeg = v - nextV;
                if (diffPNeg > thSpikeNeg && diffNNeg > thSpikeNeg && Math.abs(prevV - nextV) <= thSpikeNeg * 1.2) {
                  anomalyReason = "Spike Up sesaat melonjak dari pola tetangga (" + v + " vs " + prevV + " & " + nextV + ").";
                  recommendedVal = Math.round(((prevV + nextV) / 2.0) * 10) / 10;
                } else if (diffPNeg < -thSpikeNeg && diffNNeg < -thSpikeNeg && Math.abs(prevV - nextV) <= thSpikeNeg * 1.2) {
                  anomalyReason = "Spike Down sesaat anjlok dari pola tetangga (" + v + " vs " + prevV + " & " + nextV + ").";
                  recommendedVal = Math.round(((prevV + nextV) / 2.0) * 10) / 10;
                }
              } else if (!anomalyReason && v === 0 && Math.abs(med) > 5.0) {
                if (prevV !== null && Math.abs(prevV) > 5.0 && nextV !== null && Math.abs(nextV) > 5.0) {
                  anomalyReason = "Drop anjlok ke nol (" + v + "). Pola normal: ~" + med;
                  recommendedVal = Math.round(((prevV + nextV) / 2.0) * 10) / 10;
                }
              }
            } else {
              // Parameter Standar (Normalnya Positif)
              if (v < 0) {
                anomalyReason = "Typo tanda minus (" + v + "). Nilai operasional harus positif.";
                recommendedVal = Math.abs(v);
              } else if (med > 0 && v > med * CONFIG.PATTERN_SETTINGS.SPIKE_RATIO_TYPO) {
                if (Math.abs((v / 10.0) - med) < med * 0.35) {
                  recommendedVal = (med < 100) ? Math.round((v / 10.0) * 10) / 10 : Math.round(v / 10.0);
                  anomalyReason = "Typo kelebihan digit '0' / koma bergeser 10x (" + v + "). Pola normal: ~" + med;
                } else if (Math.abs((v / 100.0) - med) < med * 0.35) {
                  recommendedVal = (med < 100) ? Math.round((v / 100.0) * 10) / 10 : Math.round(v / 100.0);
                  anomalyReason = "Typo kelebihan digit '00' / koma bergeser 100x (" + v + "). Pola normal: ~" + med;
                } else if (Math.abs((v / 1000.0) - med) < med * 0.35) {
                  recommendedVal = (med < 100) ? Math.round((v / 1000.0) * 10) / 10 : Math.round(v / 1000.0);
                  anomalyReason = "Titik desimal hilang / 1000x (" + v + "). Pola normal: ~" + med;
                } else {
                  anomalyReason = "Lonjakan nilai ekstrem menyimpang dari pola (" + v + " vs normal ~" + med + ").";
                  recommendedVal = (prevV !== null && nextV !== null) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : med;
                }
              } else if (med > 0 && v < med * CONFIG.PATTERN_SETTINGS.DROP_RATIO_TYPO && v > 0) {
                if (Math.abs((v * 10.0) - med) < med * 0.35) {
                  recommendedVal = (med < 100) ? Math.round((v * 10.0) * 10) / 10 : Math.round(v * 10.0);
                  anomalyReason = "Typo kurang digit / koma tergeser 0.1x (" + v + "). Pola normal: ~" + med;
                }
              }

              if (!anomalyReason && prevV !== null && nextV !== null && prevV > 0 && nextV > 0) {
                var thSpike = (med >= 10.0) ? Math.max(25.0, med * 0.3) : Math.max(1.5, med * 0.3);
                var diffP = v - prevV;
                var diffN = v - nextV;
                if (diffP > thSpike && diffN > thSpike && Math.abs(prevV - nextV) <= thSpike * 1.2) {
                  anomalyReason = "Spike Up sesaat melonjak dari pola tetangga (" + v + " vs " + prevV + " & " + nextV + ").";
                  recommendedVal = (med < 100) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : Math.round((prevV + nextV) / 2.0);
                } else if (diffP < -thSpike && diffN < -thSpike && Math.abs(prevV - nextV) <= thSpike * 1.2) {
                  anomalyReason = "Spike Down sesaat anjlok dari pola tetangga (" + v + " vs " + prevV + " & " + nextV + ").";
                  recommendedVal = (med < 100) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : Math.round((prevV + nextV) / 2.0);
                }
              } else if (!anomalyReason && v === 0 && med > 5.0) {
                if (prevV !== null && prevV > 5.0 && nextV !== null && nextV > 5.0) {
                  anomalyReason = "Drop anjlok ke nol (" + v + "). Pola normal: ~" + med;
                  recommendedVal = (med < 100) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : Math.round((prevV + nextV) / 2.0);
                }
              }
            }
          }
        }

        // C. Hour Meter TX A / TX B (Bulat Murni & Akumulatif)
        else if (prof === 'HOUR_METER_TX' || c === colHourA || c === colHourB) {
          if (Math.abs(v - Math.round(v)) > 0.001) {
            anomalyReason = "Nilai Hour Meter mengandung angka pecahan desimal.";
            recommendedVal = Math.round(v);
          } else if (r > 0) {
            var prevH = parseNum(values[r - 1][c]);
            if (prevH !== null && v < prevH) {
              anomalyReason = "Hour Meter turun dari shift sebelumnya (" + v + " < " + prevH + ").";
              recommendedVal = Math.round(prevH + 2);
            }
          }
        }

        // D. Kolom Hours Umum
        else if (prof === 'HOURS_GENERAL') {
          if (med !== null && med > 0 && (v > med * 4.0 || v < 0)) {
            anomalyReason = "Typo lonjakan nilai ekstrem pada kolom Hours (" + v + " vs nominal ~" + med + ").";
            recommendedVal = med;
          }
        }

        // E. Meteran Akumulatif (KWH, WBP, LWBP)
        else if (prof === 'KWH' || prof === 'WBP' || prof === 'LWBP') {
          if (r > 0) {
            var prevK = parseNum(values[r - 1][c]);
            if (prevK !== null) {
              var deltaK = v - prevK;
              if (deltaK < -CONFIG.PATTERN_SETTINGS.TOLERANCE_KWH_ROUNDING) {
                anomalyReason = "Nilai KWH anjlok turun (" + v + " < " + prevK + "). Terindikasi reset/typo digit.";
                recommendedVal = prevK;
              } else if (deltaK > 50000) {
                anomalyReason = "Lonjakan KWH ekstrem tak wajar (+" + Math.round(deltaK) + "). Terindikasi typo digit.";
                recommendedVal = prevK;
              }
            }
          }
        }

        // Simpan Hasil Penandaan Audit
        if (anomalyReason) {
          backgrounds[r][c] = CONFIG.COLORS.ANOMALY;
          var solText = (recommendedVal !== null) ? "\n• Rekomendasi Solusi: " + recommendedVal : "";
          notes[r][c] = "[AUDIT POLA DATA v17.0]\n• Masalah: " + anomalyReason + solText;
          sheetAnomalies++;
        } else if (isOldAuditMarker) {
          backgrounds[r][c] = null;
          notes[r][c] = '';
        }
      }
    }

    dataRange.setBackgrounds(backgrounds);
    dataRange.setNotes(notes);

    totalAnomalies += sheetAnomalies;
    sheetsReport.push("• " + sheet.getName() + ": " + sheetAnomalies + " anomali terdeteksi");
  }

  showAlert("🔍 Hasil Pemindaian Pola SEMUA Sheet (Edisi v17.0):\n" +
            "Total " + totalAnomalies + " anomali ditemukan dari " + totalProcessed + " sel di " + targetSheets.length + " sheet:\n\n" +
            sheetsReport.join("\n") + "\n\n" +
            "📌 Catatan: Sel anomali ditandai warna merah muda lembut lengkap dengan catatan solusinya.");
}

/**
 * ------------------------------------------------------------------------------
 * 2. PENGURUTAN BARIS SECARA KRONOLOGIS (SEMUA SHEET)
 * Mengurutkan baris secara kronologis waktu riil shift pada semua sheet.
 * Format angka asli dan plain text pada kolom waktu terjaga 100%.
 * ------------------------------------------------------------------------------
 */
function sortRowsChronologicallyByDateTime() {
  var targetSheets = getAllTargetSheets();
  var totalSorted = 0;
  var sheetsReport = [];

  for (var sIdx = 0; sIdx < targetSheets.length; sIdx++) {
    var sheet = targetSheets[sIdx];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 3 || lastCol < 2) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colTime = findColIndex(headers, ['TIMESTAMP', 'TANGGAL']);
    var colJam = findColIndex(headers, ['WAKTU METERING', 'JAM', 'WAKTU']);

    if (colTime === -1 && colJam === -1) continue;

    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var values = dataRange.getValues();
    var backgrounds = dataRange.getBackgrounds();
    var notes = dataRange.getNotes();
    var numberFormats = dataRange.getNumberFormats();

    var combined = [];
    for (var r = 0; r < values.length; r++) {
      var tsVal = (colTime !== -1) ? values[r][colTime] : null;
      var jamVal = (colJam !== -1) ? values[r][colJam] : null;
      var epoch = getExactShiftEpoch(tsVal, jamVal);

      combined.push({
        origIndex: r,
        epoch: epoch,
        rowValues: values[r],
        rowBgs: backgrounds[r],
        rowNotes: notes[r],
        rowFormats: numberFormats[r]
      });
    }

    combined.sort(function(a, b) {
      if (a.epoch !== b.epoch) return a.epoch - b.epoch;
      return a.origIndex - b.origIndex;
    });

    var sortedValues = [];
    var sortedBgs = [];
    var sortedNotes = [];
    var sortedFormats = [];

    for (var i = 0; i < combined.length; i++) {
      sortedValues.push(combined[i].rowValues);
      sortedBgs.push(combined[i].rowBgs);
      sortedNotes.push(combined[i].rowNotes);
      sortedFormats.push(combined[i].rowFormats);
    }

    dataRange.setNumberFormats(sortedFormats);
    dataRange.setValues(sortedValues);
    dataRange.setBackgrounds(sortedBgs);
    dataRange.setNotes(sortedNotes);

    totalSorted += combined.length;
    sheetsReport.push("• " + sheet.getName() + ": " + combined.length + " baris diurutkan");
  }

  showAlert("📅 Pengurutan Kronologis SEMUA Sheet Selesai!\n" +
            "Total " + totalSorted + " baris data di " + targetSheets.length + " sheet telah tersusun rapi berdasarkan urutan waktu riil shift:\n\n" +
            sheetsReport.join("\n"));
}

function getExactShiftEpoch(tsVal, jamVal) {
  var baseDate = null;
  if (tsVal instanceof Date && !isNaN(tsVal.getTime())) {
    baseDate = new Date(tsVal.getTime());
  } else if (typeof tsVal === 'string' && tsVal.trim() !== '') {
    var p = tsVal.trim().split(/[\s/T-]+/);
    if (p.length >= 3) {
      var part1 = parseInt(p[0], 10);
      var part2 = parseInt(p[1], 10);
      var part3 = parseInt(p[2], 10);
      if (part1 > 1000) baseDate = new Date(part1, part2 - 1, part3);
      else if (part3 > 1000) baseDate = new Date(part3, part2 - 1, part1);
      else baseDate = new Date(tsVal);
    } else {
      baseDate = new Date(tsVal);
    }
  }

  if (!baseDate || isNaN(baseDate.getTime())) {
    baseDate = new Date(2026, 0, 1);
  }

  var shiftHour = parseShiftHourInt(jamVal);
  if (shiftHour === null) {
    if (tsVal instanceof Date) shiftHour = tsVal.getHours();
    else shiftHour = 0;
  }

  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), shiftHour, 0, 0, 0).getTime();
}

/**
 * ------------------------------------------------------------------------------
 * 3. TERAPKAN PERBAIKAN KWH & WBP/LWBP (SEMUA SHEET)
 * Anti-cascade, toleransi pembulatan manusia 1.0 kWh, dan proteksi idle line.
 * ------------------------------------------------------------------------------
 */
function perbaikiKwhDanWbpLwbp() {
  var targetSheets = getAllTargetSheets();
  var totalFixed = 0;
  var sheetsReport = [];

  for (var sIdx = 0; sIdx < targetSheets.length; sIdx++) {
    var sheet = targetSheets[sIdx];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var values = dataRange.getValues();
    var bgs = dataRange.getBackgrounds();
    var notes = dataRange.getNotes();

    var colJam = findColIndex(headers, ['WAKTU METERING', 'JAM', 'WAKTU']);
    var colTs = findColIndex(headers, ['TIMESTAMP', 'TANGGAL']);
    var wbpPairs = findWbpLwbpPairs(headers);
    var sheetFixedCount = 0;

    for (var c = 0; c < lastCol; c++) {
      var h = String(headers[c] || '').trim();
      var prof = getColumnCategory(h);
      if (prof !== 'KWH' && prof !== 'WBP' && prof !== 'LWBP') continue;

      var isSecondaryIdle = (h.toUpperCase().indexOf('SCTV') !== -1 || h.toUpperCase().indexOf('CADANGAN') !== -1 || h.toUpperCase().indexOf('STANDBY') !== -1);
      var tolIdle = isSecondaryIdle ? CONFIG.PATTERN_SETTINGS.TOLERANCE_IDLE_LINE : 0.0;
      var tolRound = CONFIG.PATTERN_SETTINGS.TOLERANCE_KWH_ROUNDING;

      for (var r = 1; r < values.length; r++) {
        var vPrev = parseNum(values[r - 1][c]);
        var vCur = parseNum(values[r][c]);
        if (vPrev === null || vCur === null) continue;

        var delta = vCur - vPrev;

        // Toleransi selisih turun kecil (pembulatan manusia atau variasi meter idle)
        if (delta < 0 && Math.abs(delta) <= (tolRound + tolIdle)) {
          if (bgs[r][c] === CONFIG.COLORS.ANOMALY) {
            bgs[r][c] = null;
            notes[r][c] = '';
          }
          continue;
        }

        // Koreksi Typo Multiplier (10x, 100x, 1000x)
        if (delta > 5000) {
          if (Math.abs((vCur / 10.0) - vPrev) < 1000) {
            var corrected10 = Math.round((vCur / 10.0) * 10) / 10;
            values[r][c] = corrected10;
            bgs[r][c] = CONFIG.COLORS.PREDICTED;
            notes[r][c] = "[KOREKSI TYPO 10x KWH]\n• Semula: " + vCur + "\n• Baru: " + corrected10;
            sheetFixedCount++;
            continue;
          }
        }

        // Koreksi Step Turun / Penurunan Anjlok
        if (delta < -tolRound) {
          var vNext = (r + 1 < values.length) ? parseNum(values[r + 1][c]) : null;
          var correctedVal = null;
          var reason = "";

          if (vNext !== null && vNext >= vPrev) {
            // Anomali tunggal sesaat (Spike Down / Salah Catat di baris r)
            var prevJam = (colJam !== -1) ? values[r - 1][colJam] : null;
            var curJam = (colJam !== -1) ? values[r][colJam] : null;
            var nextJam = (colJam !== -1) ? values[r + 1][colJam] : null;
            var prevTs = (colTs !== -1) ? values[r - 1][colTs] : null;
            var curTs = (colTs !== -1) ? values[r][colTs] : null;
            var nextTs = (colTs !== -1) ? values[r + 1][colTs] : null;

            var h1 = getElapsedHours(prevJam, curJam, prevTs, curTs);
            var hTotal = getElapsedHours(prevJam, nextJam, prevTs, nextTs);

            if (hTotal > 0 && h1 > 0 && h1 < hTotal) {
              correctedVal = Math.round((vPrev + (vNext - vPrev) * (h1 / hTotal)) * 10) / 10;
            } else {
              correctedVal = Math.round(((vPrev + vNext) / 2.0) * 10) / 10;
            }
            reason = "Interpolasi waktu shift antara baris sebelum dan sesudah.";
          } else {
            // Nilai turun permanen atau berkelanjutan: tahan di nilai sebelumnya (anti-cascade)
            correctedVal = vPrev;
            reason = "Penurunan ditahan di nilai shift sebelumnya (anti-cascade).";
          }

          if (correctedVal !== null) {
            values[r][c] = correctedVal;
            bgs[r][c] = CONFIG.COLORS.PREDICTED;
            notes[r][c] = "[PERBAIKAN KWH v17.0]\n• Semula: " + vCur + "\n• Baru: " + correctedVal + "\n• Alasan: " + reason;
            sheetFixedCount++;
          }
        }
      }
    }

    dataRange.setValues(values);
    dataRange.setBackgrounds(bgs);
    dataRange.setNotes(notes);

    totalFixed += sheetFixedCount;
    sheetsReport.push("• " + sheet.getName() + ": " + sheetFixedCount + " sel diperbaiki");
  }

  showAlert("⚡ Perbaikan KWH & WBP/LWBP SEMUA Sheet Selesai!\n" +
            "Total " + totalFixed + " sel diperbaiki di " + targetSheets.length + " sheet:\n\n" +
            sheetsReport.join("\n"));
}

/**
 * ------------------------------------------------------------------------------
 * 4. TERAPKAN PERBAIKAN NON-KWH (SEMUA SHEET)
 * Murni pola statistik: Median, Min-Max, Typo 10x/0.1x & Spike Up/Down sesaat.
 * Melindungi parameter alami negatif (PER, GRID VOLTAGE TX A & B).
 * ------------------------------------------------------------------------------
 */
function perbaikiNonKwh() {
  var targetSheets = getAllTargetSheets();
  var totalFixed = 0;
  var sheetsReport = [];

  for (var sIdx = 0; sIdx < targetSheets.length; sIdx++) {
    var sheet = targetSheets[sIdx];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var values = dataRange.getValues();
    var bgs = dataRange.getBackgrounds();
    var notes = dataRange.getNotes();

    var colStats = computeColumnStats(headers, values);
    var sheetFixedCount = 0;

    for (var c = 0; c < lastCol; c++) {
      var h = String(headers[c] || '').trim();
      var prof = getColumnCategory(h);

      if (prof === 'SKIP_TEXT' || prof === 'KWH' || prof === 'WBP' || prof === 'LWBP' || prof === 'HOUR_METER_TX' || prof === 'HOURS_GENERAL') {
        continue;
      }

      var stat = colStats[c];
      var med = stat ? stat.median : null;
      if (med === null) continue;

      var isNegCol = isNaturallyNegativeColumn(h, med);

      for (var r = 0; r < values.length; r++) {
        var v = parseNum(values[r][c]);
        if (v === null) continue;

        var prevV = (r > 0) ? parseNum(values[r - 1][c]) : null;
        var nextV = (r + 1 < values.length) ? parseNum(values[r + 1][c]) : null;
        var correctedVal = null;
        var reason = "";

        if (isNegCol) {
          // Parameter Alami Minus (PER, GRID VOLTAGE TX A & B)
          if (v > 0) {
            if (Math.abs(v - Math.abs(med)) < Math.abs(med) * 0.35) {
              correctedVal = -Math.abs(v);
              reason = "Typo lupa tanda minus dinormalkan menjadi -" + Math.abs(v) + ".";
            } else {
              correctedVal = (prevV !== null && nextV !== null) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : med;
              reason = "Nilai positif menyimpang dinetralkan ke pola minus.";
            }
          } else if (Math.abs(v) > Math.abs(med) * CONFIG.PATTERN_SETTINGS.SPIKE_RATIO_TYPO) {
            var absV = Math.abs(v);
            var absMed = Math.abs(med);
            if (Math.abs((absV / 10.0) - absMed) < absMed * 0.35) {
              correctedVal = (absMed < 100) ? Math.round((v / 10.0) * 10) / 10 : Math.round(v / 10.0);
              reason = "Typo kelebihan digit '0' dinormalkan (/10).";
            } else if (Math.abs((absV / 100.0) - absMed) < absMed * 0.35) {
              correctedVal = (absMed < 100) ? Math.round((v / 100.0) * 10) / 10 : Math.round(v / 100.0);
              reason = "Typo kelebihan digit '00' dinormalkan (/100).";
            } else if (Math.abs((absV / 1000.0) - absMed) < absMed * 0.35) {
              correctedVal = (absMed < 100) ? Math.round((v / 1000.0) * 10) / 10 : Math.round(v / 1000.0);
              reason = "Titik desimal hilang dinormalkan (/1000).";
            } else {
              correctedVal = (prevV !== null && nextV !== null) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : med;
              reason = "Lonjakan nilai ekstrem dinetralkan ke pola nominal.";
            }
          } else if (Math.abs(v) < Math.abs(med) * CONFIG.PATTERN_SETTINGS.DROP_RATIO_TYPO && v !== 0) {
            var absV2 = Math.abs(v);
            var absMed2 = Math.abs(med);
            if (Math.abs((absV2 * 10.0) - absMed2) < absMed2 * 0.35) {
              correctedVal = (absMed2 < 100) ? Math.round((v * 10.0) * 10) / 10 : Math.round(v * 10.0);
              reason = "Typo koma bergeser 0.1x dinormalkan (*10).";
            }
          }

          if (correctedVal === null && prevV !== null && nextV !== null) {
            var thSpikeNeg = Math.max(15.0, Math.abs(med) * 0.3);
            if ((v - prevV > thSpikeNeg) && (v - nextV > thSpikeNeg) && Math.abs(prevV - nextV) <= thSpikeNeg * 1.2) {
              correctedVal = Math.round(((prevV + nextV) / 2.0) * 10) / 10;
              reason = "Spike Up sesaat dinetralkan menggunakan rata-rata tetangga.";
            } else if ((prevV - v > thSpikeNeg) && (nextV - v > thSpikeNeg) && Math.abs(prevV - nextV) <= thSpikeNeg * 1.2) {
              correctedVal = Math.round(((prevV + nextV) / 2.0) * 10) / 10;
              reason = "Spike Down sesaat dinetralkan menggunakan rata-rata tetangga.";
            }
          } else if (correctedVal === null && v === 0 && Math.abs(med) > 5.0) {
            if (prevV !== null && Math.abs(prevV) > 5.0 && nextV !== null && Math.abs(nextV) > 5.0) {
              correctedVal = Math.round(((prevV + nextV) / 2.0) * 10) / 10;
              reason = "Drop anjlok ke nol dinetralkan ke rata-rata tetangga.";
            }
          }
        } else {
          // Parameter Standar (Normalnya Positif)
          if (v < 0) {
            correctedVal = Math.abs(v);
            reason = "Nilai negatif dinetralkan menjadi positif.";
          } else if (med > 0 && v > med * CONFIG.PATTERN_SETTINGS.SPIKE_RATIO_TYPO) {
            if (Math.abs((v / 10.0) - med) < med * 0.35) {
              correctedVal = (med < 100) ? Math.round((v / 10.0) * 10) / 10 : Math.round(v / 10.0);
              reason = "Typo kelebihan digit '0' dinormalkan (/10).";
            } else if (Math.abs((v / 100.0) - med) < med * 0.35) {
              correctedVal = (med < 100) ? Math.round((v / 100.0) * 10) / 10 : Math.round(v / 100.0);
              reason = "Typo kelebihan digit '00' dinormalkan (/100).";
            } else if (Math.abs((v / 1000.0) - med) < med * 0.35) {
              correctedVal = (med < 100) ? Math.round((v / 1000.0) * 10) / 10 : Math.round(v / 1000.0);
              reason = "Titik desimal hilang dinormalkan (/1000).";
            } else {
              correctedVal = (prevV !== null && nextV !== null) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : med;
              reason = "Lonjakan nilai ekstrem dinetralkan ke pola nominal.";
            }
          } else if (med > 0 && v < med * CONFIG.PATTERN_SETTINGS.DROP_RATIO_TYPO && v > 0) {
            if (Math.abs((v * 10.0) - med) < med * 0.35) {
              correctedVal = (med < 100) ? Math.round((v * 10.0) * 10) / 10 : Math.round(v * 10.0);
              reason = "Typo koma bergeser 0.1x dinormalkan (*10).";
            }
          } else if (prevV !== null && nextV !== null && prevV > 0 && nextV > 0) {
            var thSpike = (med >= 10.0) ? Math.max(25.0, med * 0.3) : Math.max(1.5, med * 0.3);
            if ((v - prevV > thSpike) && (v - nextV > thSpike) && Math.abs(prevV - nextV) <= thSpike * 1.2) {
              correctedVal = (med < 100) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : Math.round((prevV + nextV) / 2.0);
              reason = "Spike Up sesaat dinetralkan menggunakan rata-rata tetangga.";
            } else if ((prevV - v > thSpike) && (nextV - v > thSpike) && Math.abs(prevV - nextV) <= thSpike * 1.2) {
              correctedVal = (med < 100) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : Math.round((prevV + nextV) / 2.0);
              reason = "Spike Down sesaat dinetralkan menggunakan rata-rata tetangga.";
            }
          } else if (v === 0 && med > 5.0 && prevV !== null && prevV > 5.0 && nextV !== null && nextV > 5.0) {
            correctedVal = (med < 100) ? Math.round(((prevV + nextV) / 2.0) * 10) / 10 : Math.round((prevV + nextV) / 2.0);
            reason = "Drop anjlok ke nol dinetralkan ke rata-rata tetangga.";
          }
        }

        if (correctedVal !== null && correctedVal !== v) {
          values[r][c] = correctedVal;
          bgs[r][c] = CONFIG.COLORS.PREDICTED;
          notes[r][c] = "[PERBAIKAN POLA NON-KWH v17.0]\n• Semula: " + v + "\n• Baru: " + correctedVal + "\n• Alasan: " + reason;
          sheetFixedCount++;
        }
      }
    }

    dataRange.setValues(values);
    dataRange.setBackgrounds(bgs);
    dataRange.setNotes(notes);

    totalFixed += sheetFixedCount;
    sheetsReport.push("• " + sheet.getName() + ": " + sheetFixedCount + " sel diperbaiki");
  }

  showAlert("🛠️ Perbaikan Non-KWH SEMUA Sheet Selesai!\n" +
            "Total " + totalFixed + " sel diperbaiki di " + targetSheets.length + " sheet:\n\n" +
            sheetsReport.join("\n"));
}

/**
 * ------------------------------------------------------------------------------
 * 5. TERAPKAN PERBAIKAN HOUR METER (SEMUA SHEET)
 * Menghilangkan desimal (bulat murni) dan menyinkronkan akumulator shift.
 * ------------------------------------------------------------------------------
 */
function perbaikiHourMeterBulat() {
  var targetSheets = getAllTargetSheets();
  var totalFixed = 0;
  var sheetsReport = [];

  for (var sIdx = 0; sIdx < targetSheets.length; sIdx++) {
    var sheet = targetSheets[sIdx];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colA = findColIndex(headers, ['HOUR METER TX A']);
    var colB = findColIndex(headers, ['HOUR METER TX B']);
    if (colA === -1 && colB === -1) continue;

    var colJam = findColIndex(headers, ['WAKTU METERING', 'JAM', 'WAKTU']);
    var colTs = findColIndex(headers, ['TIMESTAMP', 'TANGGAL']);

    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var values = dataRange.getValues();
    var bgs = dataRange.getBackgrounds();
    var notes = dataRange.getNotes();
    var sheetFixedCount = 0;

    function syncHourColumn(colIdx, defaultAnchor) {
      if (colIdx === -1) return;

      var baseRow = -1;
      var baseVal = null;

      for (var r = 0; r < values.length; r++) {
        var v = parseNum(values[r][colIdx]);
        if (v !== null && v > 50000 && Math.abs(v - Math.round(v)) < 0.001) {
          baseRow = r;
          baseVal = Math.round(v);
          break;
        }
      }

      if (baseRow === -1) {
        baseRow = 0;
        baseVal = defaultAnchor;
        values[baseRow][colIdx] = baseVal;
        bgs[baseRow][colIdx] = CONFIG.COLORS.PREDICTED;
        notes[baseRow][colIdx] = "[HOUR METER INISIALISASI ANCHOR]\n• Nilai Ditetapkan: " + baseVal;
        sheetFixedCount++;
      } else if (Math.abs(parseNum(values[baseRow][colIdx]) - baseVal) > 0.001) {
        values[baseRow][colIdx] = baseVal;
        bgs[baseRow][colIdx] = null;
        notes[baseRow][colIdx] = '';
        sheetFixedCount++;
      }

      // Maju ke baris berikutnya
      var curVal = baseVal;
      for (var f = baseRow + 1; f < values.length; f++) {
        var prevJam = (colJam !== -1) ? values[f - 1][colJam] : null;
        var thisJam = (colJam !== -1) ? values[f][colJam] : null;
        var prevTs = (colTs !== -1) ? values[f - 1][colTs] : null;
        var thisTs = (colTs !== -1) ? values[f][colTs] : null;

        var elapsedH = Math.round(getElapsedHours(prevJam, thisJam, prevTs, thisTs));
        var expected = Math.round(curVal + elapsedH);
        var existVal = parseNum(values[f][colIdx]);

        if (existVal === null || existVal < curVal || Math.abs(existVal - expected) > 6 || (Math.abs(existVal - Math.round(existVal)) > 0.001)) {
          values[f][colIdx] = expected;
          bgs[f][colIdx] = CONFIG.COLORS.PREDICTED;
          notes[f][colIdx] = "[HOUR METER BULAT SINKRON]\n• Semula: " + existVal + "\n• Baru: " + expected + "\n• Interval: +" + elapsedH + " jam";
          curVal = expected;
          sheetFixedCount++;
        } else {
          curVal = Math.round(existVal);
          if (bgs[f][colIdx] === CONFIG.COLORS.ANOMALY) {
            bgs[f][colIdx] = null;
            notes[f][colIdx] = '';
          }
        }
      }

      // Mundur ke baris sebelumnya
      var backVal = baseVal;
      for (var b = baseRow - 1; b >= 0; b--) {
        var bJam = (colJam !== -1) ? values[b][colJam] : null;
        var nextJam = (colJam !== -1) ? values[b + 1][colJam] : null;
        var bTs = (colTs !== -1) ? values[b][colTs] : null;
        var nextTs = (colTs !== -1) ? values[b + 1][colTs] : null;

        var bElapsed = Math.round(getElapsedHours(bJam, nextJam, bTs, nextTs));
        var expBack = Math.round(backVal - bElapsed);
        var curExist = parseNum(values[b][colIdx]);

        if (curExist === null || curExist > backVal || Math.abs(curExist - expBack) > 6 || (Math.abs(curExist - Math.round(curExist)) > 0.001)) {
          values[b][colIdx] = expBack;
          bgs[b][colIdx] = CONFIG.COLORS.PREDICTED;
          notes[b][colIdx] = "[HOUR METER BULAT SINKRON MUNDUR]\n• Semula: " + curExist + "\n• Baru: " + expBack + "\n• Interval: -" + bElapsed + " jam";
          backVal = expBack;
          sheetFixedCount++;
        } else {
          backVal = Math.round(curExist);
          if (bgs[b][colIdx] === CONFIG.COLORS.ANOMALY) {
            bgs[b][colIdx] = null;
            notes[b][colIdx] = '';
          }
        }
      }
    }

    syncHourColumn(colA, 94685);
    if (colB !== -1) syncHourColumn(colB, 98596);

    dataRange.setValues(values);
    dataRange.setBackgrounds(bgs);
    dataRange.setNotes(notes);

    totalFixed += sheetFixedCount;
    sheetsReport.push("• " + sheet.getName() + ": " + sheetFixedCount + " sel diperbaiki");
  }

  showAlert("⏱️ Perbaikan Hour Meter SEMUA Sheet Selesai!\n" +
            "Total " + totalFixed + " sel diperbaiki di " + targetSheets.length + " sheet:\n\n" +
            sheetsReport.join("\n"));
}

/**
 * ------------------------------------------------------------------------------
 * 6. PEMULIHAN FORMAT WAKTU METERING (SEMUA SHEET)
 * Memulihkan waktu shift asli Google Forms (7:00, 1:00, 23:00 tanpa :25 dan tanpa 12/30/1899)
 * Format kolom dikunci sebagai Plain Text (@).
 * ------------------------------------------------------------------------------
 */
function formatOriginalShiftTime(val) {
  if (val === null || val === undefined || val === '') return '';

  var hour = null;

  if (typeof val === 'string') {
    var s = val.trim();
    var match = s.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      hour = parseInt(match[1], 10);
    } else {
      var n = parseInt(s, 10);
      if (!isNaN(n) && n >= 0 && n < 24) hour = n;
    }
  } else if (val instanceof Date) {
    if (!isNaN(val.getTime())) {
      hour = val.getHours();
    }
  } else if (typeof val === 'number') {
    if (val >= 0 && val < 1) {
      var totalMin = Math.round(val * 24 * 60);
      hour = Math.floor(totalMin / 60) % 24;
    } else {
      hour = Math.round(val) % 24;
    }
  }

  if (hour !== null && hour >= 0 && hour < 24) {
    // Kembalikan ke format shift asli Google Forms (contoh: 7:00, 1:00, 23:00)
    return hour + ':00';
  }

  return String(val).trim();
}

function formatTimeHHmm(val) {
  return formatOriginalShiftTime(val);
}

function pulihkanFormatWaktuMetering() {
  var targetSheets = getAllTargetSheets();
  var totalRestored = 0;
  var sheetsReport = [];

  for (var sIdx = 0; sIdx < targetSheets.length; sIdx++) {
    var sheet = targetSheets[sIdx];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colJam = findColIndex(headers, ['WAKTU METERING', 'JAM', 'WAKTU']);
    if (colJam === -1) continue;

    var range = sheet.getRange(2, colJam + 1, lastRow - 1, 1);
    var rawValues = range.getValues();
    var newValues = [];
    var sheetCount = 0;

    for (var i = 0; i < rawValues.length; i++) {
      var restored = formatOriginalShiftTime(rawValues[i][0]);
      newValues.push([restored]);
      sheetCount++;
    }

    // Kunci format kolom sebagai Plain Text (@) agar aman dari distorsi 12/30/1899
    range.setNumberFormat('@');
    range.setValues(newValues);

    totalRestored += sheetCount;
    sheetsReport.push("• " + sheet.getName() + ": " + sheetCount + " baris");
  }

  showAlert("⏰ Pemulihan Format SEMUA Sheet Selesai!\n" +
            "Total " + totalRestored + " baris WAKTU METERING berhasil dipulihkan di " + targetSheets.length + " sheet sesuai format asli Google Forms (7:00, 1:00, 23:00):\n\n" +
            sheetsReport.join("\n") + "\n\n" +
            "Format kolom dikunci sebagai Plain Text (@) agar aman selamanya.");
}

/**
 * ------------------------------------------------------------------------------
 * 7. HAPUS SEMUA TANDA PERBAIKAN & CATATAN AUDIT (SEMUA SHEET)
 * ------------------------------------------------------------------------------
 */
function hapusSemuaTandaPerbaikan() {
  var targetSheets = getAllTargetSheets();
  var totalCleared = 0;
  var sheetsReport = [];

  for (var sIdx = 0; sIdx < targetSheets.length; sIdx++) {
    var sheet = targetSheets[sIdx];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var bgs = dataRange.getBackgrounds();
    var notes = dataRange.getNotes();
    var sheetCleared = 0;

    for (var r = 0; r < bgs.length; r++) {
      for (var c = 0; c < bgs[r].length; c++) {
        var color = String(bgs[r][c] || '').toUpperCase();
        if (color === CONFIG.COLORS.ANCHOR || color === '#FFFF00') continue;

        if (color === CONFIG.COLORS.ANOMALY || color === CONFIG.COLORS.PREDICTED || (notes[r][c] && notes[r][c] !== '')) {
          bgs[r][c] = null;
          notes[r][c] = '';
          sheetCleared++;
        }
      }
    }

    dataRange.setBackgrounds(bgs);
    dataRange.setNotes(notes);
    totalCleared += sheetCleared;
    sheetsReport.push("• " + sheet.getName() + ": " + sheetCleared + " penanda dibersihkan");
  }

  showAlert("🧹 Pembersihan SEMUA Sheet Selesai!\n" +
            "Total " + totalCleared + " penanda audit & catatan dibersihkan di " + targetSheets.length + " sheet:\n\n" +
            sheetsReport.join("\n"));
}

/**
 * ------------------------------------------------------------------------------
 * 8. SUITE BACKUP, ARSIP & CUT-OFF (PINDAH & HAPUS DARI MASTER)
 * ------------------------------------------------------------------------------
 */
function aturIdSpreadsheetTujuan() {
  var ui = getSafeUi();
  if (!ui) return;
  var props = PropertiesService.getScriptProperties();
  var curVal = props.getProperty(CONFIG.BACKUP.PROP_SS_KEY) || CONFIG.BACKUP.DEFAULT_SPREADSHEET_ID;
  var res = ui.prompt("⚙️ Atur ID Spreadsheet Tujuan Backup",
    "Masukkan ID Spreadsheet tujuan penyimpanan backup:\n(ID adalah deretan karakter acak pada URL spreadsheet di antara /d/ dan /edit)\n\nSaat ini: " + curVal,
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() === ui.Button.OK) {
    var val = res.getResponseText().trim();
    if (val !== "") {
      props.setProperty(CONFIG.BACKUP.PROP_SS_KEY, val);
      showAlert("✅ ID Spreadsheet Backup berhasil disimpan:\n" + val);
    }
  }
}

function aturIdFolderDriveTujuan() {
  var ui = getSafeUi();
  if (!ui) return;
  var props = PropertiesService.getScriptProperties();
  var curVal = props.getProperty(CONFIG.BACKUP.PROP_FOLDER_KEY) || "(Belum diatur / Root Google Drive)";
  var res = ui.prompt("📁 Atur ID Folder Google Drive Tujuan Backup File",
    "Masukkan ID Folder Drive tujuan penyimpanan file duplikat backup:\n(ID adalah bagian akhir dari URL folder di Drive)\n\nSaat ini: " + curVal,
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() === ui.Button.OK) {
    var val = res.getResponseText().trim();
    if (val !== "") {
      props.setProperty(CONFIG.BACKUP.PROP_FOLDER_KEY, val);
      showAlert("✅ ID Folder Google Drive Backup berhasil disimpan:\n" + val);
    }
  }
}

function getBackupDestinationSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var targetId = props.getProperty(CONFIG.BACKUP.PROP_SS_KEY) || CONFIG.BACKUP.DEFAULT_SPREADSHEET_ID;
  try {
    return SpreadsheetApp.openById(targetId);
  } catch (e) {
    showAlert("⚠️ Tidak dapat membuka Spreadsheet Tujuan dengan ID: '" + targetId + "'.\n" +
              "Pastikan ID valid dan akun Anda memiliki hak akses Edit ke file tersebut.\n\n" +
              "Detail: " + e.toString());
    return null;
  }
}

function extractRowDate(rowVal) {
  if (rowVal instanceof Date && !isNaN(rowVal.getTime())) {
    return {
      year: rowVal.getFullYear(),
      month: rowVal.getMonth() + 1,
      day: rowVal.getDate()
    };
  }
  if (typeof rowVal === 'string' && rowVal.trim() !== '') {
    var s = rowVal.trim();
    var p = s.split(/[\s/T-]+/);
    if (p.length >= 3) {
      var p0 = parseInt(p[0], 10);
      var p1 = parseInt(p[1], 10);
      var p2 = parseInt(p[2], 10);
      if (p0 > 1000) return { year: p0, month: p1, day: p2 };
      if (p2 > 1000) return { year: p2, month: p1, day: p0 };
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    }
  }
  return null;
}

function parseUserDailyInput(inputStr) {
  if (!inputStr) return null;
  var s = inputStr.trim().toLowerCase();

  var mIndo = s.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (mIndo) {
    var d = parseInt(mIndo[1], 10);
    var namaBulan = mIndo[2];
    var y = parseInt(mIndo[3], 10);
    var bulanMap = {
      'januari': 1, 'jan': 1, 'februari': 2, 'feb': 2, 'maret': 3, 'mar': 3,
      'april': 4, 'apr': 4, 'mei': 5, 'may': 5, 'juni': 6, 'jun': 6,
      'juli': 7, 'jul': 7, 'agustus': 8, 'agu': 8, 'agt': 8,
      'september': 9, 'sep': 9, 'oktober': 10, 'okt': 10, 'oct': 10,
      'november': 11, 'nov': 11, 'desember': 12, 'des': 12, 'dec': 12
    };
    if (bulanMap[namaBulan]) return { year: y, month: bulanMap[namaBulan], day: d };
  }

  var parts = s.split(/[\/\-\.\s]+/);
  if (parts.length >= 3) {
    var p0 = parseInt(parts[0], 10);
    var p1 = parseInt(parts[1], 10);
    var p2 = parseInt(parts[2], 10);
    if (p0 > 1000) return { year: p0, month: p1, day: p2 };
    if (p2 > 1000) return { year: p2, month: p1, day: p0 };
  }
  return null;
}

function parseUserMonthlyInput(inputStr) {
  if (!inputStr) return null;
  var s = inputStr.trim().toLowerCase();

  var mIndo = s.match(/^([a-z]+)\s*(\d{4})?$/);
  if (mIndo) {
    var namaBulan = mIndo[1];
    var y = mIndo[2] ? parseInt(mIndo[2], 10) : 2026;
    var bulanMap = {
      'januari': 1, 'jan': 1, 'februari': 2, 'feb': 2, 'maret': 3, 'mar': 3,
      'april': 4, 'apr': 4, 'mei': 5, 'may': 5, 'juni': 6, 'jun': 6,
      'juli': 7, 'jul': 7, 'agustus': 8, 'agu': 8, 'agt': 8,
      'september': 9, 'sep': 9, 'oktober': 10, 'okt': 10, 'oct': 10,
      'november': 11, 'nov': 11, 'desember': 12, 'des': 12, 'dec': 12
    };
    if (bulanMap[namaBulan]) return { year: y, month: bulanMap[namaBulan] };
  }

  var parts = s.split(/[\/\-\.\s]+/);
  if (parts.length === 2) {
    var p0 = parseInt(parts[0], 10);
    var p1 = parseInt(parts[1], 10);
    if (p0 > 1000 && p1 >= 1 && p1 <= 12) return { year: p0, month: p1 };
    if (p1 > 1000 && p0 >= 1 && p0 <= 12) return { year: p1, month: p0 };
  } else if (parts.length === 1) {
    var p = parseInt(parts[0], 10);
    if (p >= 1 && p <= 12) return { year: 2026, month: p };
  }
  return null;
}

function backupHarianManual() {
  var ui = getSafeUi();
  if (!ui) return;
  var srcSheet = getActiveTargetSheet();
  if (!srcSheet) return;

  var lastRow = srcSheet.getLastRow();
  var lastCol = srcSheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    showAlert("Sheet master kosong atau tidak memiliki data.");
    return;
  }

  var res = ui.prompt("📅 Backup & Arsipkan Harian (Cut-Off Data)",
    "Masukkan tanggal yang ingin diarsipkan dan dihapus dari sheet master:\n(Format fleksibel: YYYY-MM-DD, DD/MM/YYYY, atau contoh: 5 Maret 2026)",
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var targetDate = parseUserDailyInput(res.getResponseText());
  if (!targetDate) {
    showAlert("⚠️ Format tanggal tidak dikenali. Gunakan contoh: 2026-03-05 atau 05/03/2026 atau 5 Maret 2026.");
    return;
  }

  var yStr = String(targetDate.year);
  var mStr = (targetDate.month < 10 ? '0' : '') + targetDate.month;
  var dStr = (targetDate.day < 10 ? '0' : '') + targetDate.day;
  var targetTag = yStr + mStr + dStr;
  var targetLabel = dStr + "/" + mStr + "/" + yStr;

  var headers = srcSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colTime = findColIndex(headers, ['TIMESTAMP', 'TANGGAL']);
  if (colTime === -1) {
    showAlert("Kolom TIMESTAMP / Tanggal tidak ditemukan di sheet.");
    return;
  }

  var allData = srcSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var matchedRows = [];
  var remainingRows = [];

  for (var r = 0; r < allData.length; r++) {
    var dObj = extractRowDate(allData[r][colTime]);
    if (dObj && dObj.year === targetDate.year && dObj.month === targetDate.month && dObj.day === targetDate.day) {
      matchedRows.push(allData[r]);
    } else {
      remainingRows.push(allData[r]);
    }
  }

  if (matchedRows.length === 0) {
    showAlert("ℹ️ Data tidak ditemukan untuk tanggal: " + targetLabel + " (" + targetTag + ").");
    return;
  }

  var destSS = getBackupDestinationSpreadsheet();
  if (!destSS) return;

  var tabName = 'BACKUP_HARI_' + targetTag;
  var backupSheet = getOrCreateSheet(destSS, tabName);

  backupSheet.clear();
  backupSheet.appendRow(headers);
  backupSheet.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#E8EAED');

  var destRange = backupSheet.getRange(2, 1, matchedRows.length, lastCol);
  destRange.setValues(matchedRows);
  backupSheet.autoResizeColumns(1, Math.min(lastCol, 20));

  // Otomatis aktifkan tab backup agar langsung terlihat oleh pengguna
  backupSheet.activate();

  // CUT-OFF: Hapus baris yang telah di-backup dari Sheet Master
  var totalRowsBefore = lastRow - 1;
  srcSheet.getRange(2, 1, totalRowsBefore, lastCol).clearContent();
  srcSheet.getRange(2, 1, totalRowsBefore, lastCol).clearNote();

  if (remainingRows.length > 0) {
    srcSheet.getRange(2, 1, remainingRows.length, lastCol).setValues(remainingRows);
  }

  showAlert("✅ Backup & Arsipkan Harian Selesai!\n\n" +
            "• Tanggal: " + targetLabel + "\n" +
            "• Jumlah Baris Dipindahkan: " + matchedRows.length + " baris\n" +
            "• Tab Backup Tujuan: '" + tabName + "' (Langsung Aktif)\n" +
            "• Status Sheet Master: " + matchedRows.length + " baris telah dipotong & dihapus agar sheet tetap bersih dan ringan.\n" +
            "• Sisa Baris di Master: " + remainingRows.length + " baris.");
}

function backupBulananManual() {
  var ui = getSafeUi();
  if (!ui) return;
  var srcSheet = getActiveTargetSheet();
  if (!srcSheet) return;

  var lastRow = srcSheet.getLastRow();
  var lastCol = srcSheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    showAlert("Sheet master kosong atau tidak memiliki data.");
    return;
  }

  var res = ui.prompt("📆 Backup & Arsipkan Bulanan (Cut-Off Data)",
    "Masukkan bulan yang ingin diarsipkan dan dihapus dari sheet master:\n(Format fleksibel: YYYY-MM, MM/YYYY, atau contoh: Maret 2026 / 3)",
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var targetMonth = parseUserMonthlyInput(res.getResponseText());
  if (!targetMonth) {
    showAlert("⚠️ Format bulan tidak dikenali. Gunakan contoh: 2026-03 atau 03/2026 atau Maret 2026.");
    return;
  }

  var yStr = String(targetMonth.year);
  var mStr = (targetMonth.month < 10 ? '0' : '') + targetMonth.month;
  var targetTag = yStr + mStr;
  var targetLabel = mStr + "/" + yStr;

  var headers = srcSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colTime = findColIndex(headers, ['TIMESTAMP', 'TANGGAL']);
  if (colTime === -1) {
    showAlert("Kolom TIMESTAMP / Tanggal tidak ditemukan di sheet.");
    return;
  }

  var allData = srcSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var matchedRows = [];
  var remainingRows = [];

  for (var r = 0; r < allData.length; r++) {
    var dObj = extractRowDate(allData[r][colTime]);
    if (dObj && dObj.year === targetMonth.year && dObj.month === targetMonth.month) {
      matchedRows.push(allData[r]);
    } else {
      remainingRows.push(allData[r]);
    }
  }

  if (matchedRows.length === 0) {
    showAlert("ℹ️ Data tidak ditemukan untuk bulan: " + targetLabel + " (" + targetTag + ").");
    return;
  }

  var destSS = getBackupDestinationSpreadsheet();
  if (!destSS) return;

  var tabName = 'BACKUP_BULAN_' + targetTag;
  var backupSheet = getOrCreateSheet(destSS, tabName);

  backupSheet.clear();
  backupSheet.appendRow(headers);
  backupSheet.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#E8EAED');

  var destRange = backupSheet.getRange(2, 1, matchedRows.length, lastCol);
  destRange.setValues(matchedRows);
  backupSheet.autoResizeColumns(1, Math.min(lastCol, 20));

  // Otomatis aktifkan tab backup agar langsung terlihat oleh pengguna
  backupSheet.activate();

  // CUT-OFF: Hapus baris yang telah di-backup dari Sheet Master
  var totalRowsBefore = lastRow - 1;
  srcSheet.getRange(2, 1, totalRowsBefore, lastCol).clearContent();
  srcSheet.getRange(2, 1, totalRowsBefore, lastCol).clearNote();

  if (remainingRows.length > 0) {
    srcSheet.getRange(2, 1, remainingRows.length, lastCol).setValues(remainingRows);
  }

  showAlert("✅ Backup & Arsipkan Bulanan Selesai!\n\n" +
            "• Bulan: " + targetLabel + "\n" +
            "• Jumlah Baris Dipindahkan: " + matchedRows.length + " baris\n" +
            "• Tab Backup Tujuan: '" + tabName + "' (Langsung Aktif)\n" +
            "• Status Sheet Master: " + matchedRows.length + " baris telah dipotong & dihapus agar sheet tetap bersih dan ringan.\n" +
            "• Sisa Baris di Master: " + remainingRows.length + " baris.");
}

function backupLengkapSemuaData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var fileId = ss.getId();
  var file = DriveApp.getFileById(fileId);

  var now = new Date();
  var dateStr = Utilities.formatDate(now, "Asia/Jakarta", "yyyyMMdd_HHmmss");
  var copyName = "BACKUP_FULL_" + ss.getName() + "_" + dateStr;

  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(CONFIG.BACKUP.PROP_FOLDER_KEY);

  var destFolder = null;
  if (folderId && folderId.trim() !== "") {
    try {
      destFolder = DriveApp.getFolderById(folderId.trim());
    } catch (e) {
      destFolder = null;
    }
  }

  var copiedFile = null;
  if (destFolder) {
    copiedFile = file.makeCopy(copyName, destFolder);
  } else {
    copiedFile = file.makeCopy(copyName);
  }

  showAlert("💾 Backup Lengkap File Spreadsheet Berhasil!\n\n" +
            "• Nama File Backup: " + copyName + "\n" +
            "• Lokasi: " + (destFolder ? destFolder.getName() : "Root Google Drive Anda") + "\n" +
            "• URL Akses: " + copiedFile.getUrl());
}

/**
 * ------------------------------------------------------------------------------
 * HELPER / FUNGSI PENDUKUNG MATEMATIKA, WAKTU & STATISTIK
 * ------------------------------------------------------------------------------
 */
function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    var s = val.trim();
    if (s === '' || s === '-' || s === 'null' || s === 'undefined') return null;
    s = s.replace(/,/g, '.');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  return null;
}

function parseShiftHourInt(jamVal) {
  if (jamVal === null || jamVal === undefined || jamVal === '') return null;
  if (typeof jamVal === 'string') {
    var match = jamVal.trim().match(/^(\d{1,2})/);
    if (match) return parseInt(match[1], 10);
  } else if (jamVal instanceof Date && !isNaN(jamVal.getTime())) {
    return jamVal.getHours();
  } else if (typeof jamVal === 'number') {
    if (jamVal >= 0 && jamVal < 1) {
      return Math.floor(Math.round(jamVal * 24 * 60) / 60) % 24;
    }
    return Math.round(jamVal) % 24;
  }
  return null;
}

function getElapsedHours(jamPrev, jamCur, tsPrev, tsCur) {
  var hPrev = parseShiftHourInt(jamPrev);
  var hCur = parseShiftHourInt(jamCur);

  if (hPrev !== null && hCur !== null) {
    var diffH = hCur - hPrev;
    if (diffH < 0) diffH += 24;
    if (diffH > 0 && diffH <= 12) return diffH;
  }

  if (tsPrev && tsCur) {
    var t1 = (tsPrev instanceof Date) ? tsPrev.getTime() : new Date(tsPrev).getTime();
    var t2 = (tsCur instanceof Date) ? tsCur.getTime() : new Date(tsCur).getTime();
    if (!isNaN(t1) && !isNaN(t2) && t2 > t1) {
      var hrs = (t2 - t1) / 3600000.0;
      if (hrs >= 0.5 && hrs <= 12) return hrs;
    }
  }

  return 2.0; // Standar default shift 2 jam
}

function formatDateYMD(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, "Asia/Jakarta", "yyyyMMdd");
}

function formatDateYM(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, "Asia/Jakarta", "yyyyMM");
}

function getOrCreateSheet(ss, sheetName) {
  var s = ss.getSheetByName(sheetName);
  if (!s) {
    s = ss.insertSheet(sheetName);
  }
  return s;
}

function findColIndex(headers, candidateNames) {
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').toUpperCase().trim();
    for (var i = 0; i < candidateNames.length; i++) {
      if (h === candidateNames[i].toUpperCase()) return c;
    }
  }
  for (var c2 = 0; c2 < headers.length; c2++) {
    var h2 = String(headers[c2] || '').toUpperCase().trim();
    for (var j = 0; j < candidateNames.length; j++) {
      if (h2.indexOf(candidateNames[j].toUpperCase()) !== -1) return c2;
    }
  }
  return -1;
}

function findWbpLwbpPairs(headers) {
  var pairs = [];
  var wbpCols = {};
  var lwbpCols = {};

  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').toUpperCase();
    if (h.indexOf('LWBP') !== -1) {
      var keyL = h.replace(/LWBP/g, '').replace(/\s+/g, ' ').trim();
      lwbpCols[keyL] = c;
    } else if (h.indexOf('WBP') !== -1) {
      var keyW = h.replace(/WBP/g, '').replace(/\s+/g, ' ').trim();
      wbpCols[keyW] = c;
    }
  }

  for (var k in wbpCols) {
    if (lwbpCols[k] !== undefined) {
      pairs.push({ key: k, wbpCol: wbpCols[k], lwbpCol: lwbpCols[k] });
    }
  }
  return pairs;
}

function getColumnCategory(header) {
  var h = String(header || '').toLowerCase().trim();
  if (!h) return 'SKIP_TEXT';

  // Kolom Teks / Identitas / Timestamp (Dilewati dari audit angka)
  if (/timestamp|stempel|waktu metering|jam|teknisi|ruangan|selesai|fo\s|ip radio/i.test(h)) return 'SKIP_TEXT';

  // 1. Kategori Meteran Akumulatif (Aturan Monotonik, Toleransi Pembulatan & Jam Shift)
  if (/\blwbp\b/i.test(h)) return 'LWBP';
  if (/\bwbp\b/i.test(h)) return 'WBP';
  if (h.indexOf('kwh') !== -1) return 'KWH';

  // 2. Kategori Hour Meter (Strict Bulat & Monotonik)
  if (h.indexOf('hour meter tx a') !== -1 || h.indexOf('hour meter tx b') !== -1) return 'HOUR_METER_TX';
  if (h === 'hours' || h.indexOf('hours') !== -1) return 'HOURS_GENERAL';

  // 3. Seluruh Parameter Operasional Non-KWH Lainnya (Murni Pola Statistik: Min, Med, Max, Typo & Spike)
  return 'PURE_PATTERN_NON_KWH';
}

function computeColumnStats(headers, values) {
  var stats = {};
  var numCols = headers.length;

  for (var c = 0; c < numCols; c++) {
    var nums = [];
    for (var r = 0; r < values.length; r++) {
      var n = parseNum(values[r][c]);
      if (n !== null) nums.push(n);
    }

    if (nums.length === 0) {
      stats[c] = null;
      continue;
    }

    nums.sort(function(a, b) { return a - b; });

    var median = 0;
    var mid = Math.floor(nums.length / 2);
    if (nums.length % 2 === 0) {
      median = (nums[mid - 1] + nums[mid]) / 2.0;
    } else {
      median = nums[mid];
    }

    var q1 = nums[Math.floor(nums.length * 0.25)];
    var q3 = nums[Math.floor(nums.length * 0.75)];

    stats[c] = {
      count: nums.length,
      min: nums[0],
      max: nums[nums.length - 1],
      median: median,
      q1: q1,
      q3: q3,
      iqr: q3 - q1
    };
  }

  return stats;
}

function getSafeUi() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

function showAlert(message) {
  var ui = getSafeUi();
  if (ui) {
    ui.alert(message);
  } else {
    Logger.log(message);
  }
}
