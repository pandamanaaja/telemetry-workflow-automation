/**
 * ==============================================================================
 * MASTER-RESPONSE-MET: SUITE DETEKSI, PERBAIKAN & AUTO-SHEET BACKUP (v8.5)
 * ==============================================================================
 * Fitur Utama v8.5:
 *  1. ZERO-TOUCH METADATA PROTECTION:
 *     - Kolom Jam Metering, Timestamp, dan Nama Teknisi 100% terlindungi.
 *     - Penulisan hanya dilakukan pada kolom telemetri yang diperbaiki (colFixed > 0).
 *     - Menu 1-Klik Pemulih Jam Metering (HH:mm) jika tidak sengaja terformat 12/30/1899.
 * 
 *  2. PROTEKSI NILAI KONSTAN (ZERO-VARIANCE PROTECTION):
 *     - Jika nilai Min, Max, Mean, Median & pola data sama -> BUKAN ANOMALI.
 *     - Melindungi parameter setpoint konstan (Counter, SV, Standby RF, dll.).
 * 
 *  3. CATATAN REKOMENDASI DI SETIAP SEL ANOMALI:
 *     - Sel merah menyertakan "Nilai Rekomendasi" estimasi normal.
 *     - Sel hijau pastel mencatat "Nilai Lama" dan "Nilai Baru (Rekomendasi)".
 * 
 *  4. PEMINDAIAN SEMUA DATA (KWH & NON-KWH DENGAN STANDAR PLN):
 *     - KWH: Typo digit depan (numpad), desimal 10x, drop, macet, lompatan prematur.
 *     - Non-KWH: Volt, Current, Daya KW, PTOT, Cos Phi (>= 0.85), Freq (50 Hz),
 *       Suhu Coolant/Elbow, Tekanan Waveguide (0.00 drop), Debit Flow, Baterai UPS.
 * 
 *  5. AUTO-CREATE SHEET BACKUP:
 *     - Otomatis membuat tab baru (BACKUP_BULAN_YYYYMM, BACKUP_TGL_YYYYMMDD).
 *     - Menyalin header, membekukan baris 1, dan memindahkan baris lama dari Master.
 * 
 * CATATAN KREDENSIAL:
 * Ganti YOUR_MASTER_SPREADSHEET_ID dan YOUR_BACKUP_SPREADSHEET_ID dengan ID asli Anda.
 * Jika ditanamkan langsung pada sheet Backup, kosongkan TARGET_ID = "".
 * ==============================================================================
 */

var SHEET_NAME      = "MASTER-RESPONSE-MET"; // Mendukung "MASTER-RESPONSE-MET", "MASTER METERING", atau sheet aktif
var SOURCE_ID       = "YOUR_MASTER_SPREADSHEET_ID"; // ID Spreadsheet Master
var TARGET_ID       = "YOUR_BACKUP_SPREADSHEET_ID"; // ID Spreadsheet Backup (atau kosongkan "" jika standalone)

var COLOR_ANOMALY   = "#FF4D4D"; // Merah: Anomali
var COLOR_PREDICTED = "#D9EAD3"; // Hijau Pastel: Hasil Perbaikan

function onOpen() {
  var ui = getSafeUi();
  if (!ui) return;

  ui.createMenu('⚡ Audit & Perbaikan v8.5')
    .addItem('1. 🔍 Pindai SEMUA Anomali (Sertakan Nilai Rekomendasi)', 'pindaiSemuaAnomali')
    .addItem('2. ⚡ PERBAIKI SEMUA ANOMALI OTOMATIS (Terapkan Rekomendasi)', 'perbaikiSemuaAnomaliOtomatis')
    .addSeparator()
    .addItem('🕒 Kembalikan Format Jam Metering Asli (HH:mm)', 'kembalikanFormatJamMeteringAsli')
    .addItem('3. 🧹 Bersihkan Penanda Warna & Catatan', 'bersihkanPenanda')
    .addItem('   ✨ Reset Total Semua Warna Data', 'resetTotalSemuaWarnaData')
    .addSeparator()
    .addItem('4. 📅 Urutkan Kronologis Waktu (Waktu Riil)', 'urutkanBarisKronologis')
    .addSeparator()
    .addItem('📁 1. Pecah / Pindahkan Bulan (YYYY-MM) ➔ Sheet Baru', 'backupManualSesuaiBulan')
    .addItem('📁 2. Pecah / Pindahkan Tanggal (YYYY-MM-DD) ➔ Sheet Baru', 'backupManualSesuaiTanggal')
    .addItem('📁 3. Backup Otomatis (2 Bulan Lalu) ➔ Sheet Baru', 'backupOtomatis2BulanLalu')
    .addItem('📁 4. Backup LENGKAP Semua Data ➔ Sheet Baru', 'backupLengkapSemuaData')
    .addSeparator()
    .addItem('📥 Tarik Data Bulan dari File Master ➔ Sheet Baru', 'tarikDataDariMaster')
    .addToUi();
}

/**
 * ==============================================================================
 * PEMULIH FORMAT JAM METERING 1-KLIK (ANTI 12/30/1899)
 * ==============================================================================
 */
function kembalikanFormatJamMeteringAsli() {
  var ui = getSafeUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var jamIdx = -1;
  for (var c = 0; c < lastCol; c++) {
    var h = String(headers[c] || '').toLowerCase().trim();
    if (h.includes("jam metering") || h === "jam") {
      jamIdx = c;
      break;
    }
  }

  if (jamIdx === -1) {
    if (ui) ui.alert("Kolom Tidak Ditemukan", "Kolom 'Jam Metering' tidak ditemukan pada sheet aktif.", ui.ButtonSet.OK);
    return;
  }

  var numRows = lastRow - 1;
  var jamRange = sheet.getRange(2, jamIdx + 1, numRows, 1);
  jamRange.setNumberFormat("HH:mm");

  if (ui) {
    ui.alert(
      "🕒 Format Jam Metering Berhasil Dipulihkan!",
      "Format kolom 'Jam Metering' berhasil dikembalikan ke format waktu asli (HH:mm).\n\n" +
      "Nilai jam (seperti 11:00, 13:00, 15:00) kini tampil normal kembali.",
      ui.ButtonSet.OK
    );
  }
}

/**
 * ==============================================================================
 * 1. 🔍 PINDAI SEMUA ANOMALI
 * ==============================================================================
 */
function pindaiSemuaAnomali() {
  eksekusiAuditDanPerbaikan(false);
}

/**
 * ==============================================================================
 * 2. ⚡ PERBAIKI SEMUA ANOMALI OTOMATIS
 * ==============================================================================
 */
function perbaikiSemuaAnomaliOtomatis() {
  var ui = getSafeUi();
  if (ui) {
    var konfirmasi = ui.alert(
      "⚡ Konfirmasi Perbaikan Menyeluruh (v8.5)",
      "Sistem akan langsung menerapkan nilai rekomendasi ke seluruh sel anomali di tab ini:\n\n" +
      "• KWH: Typo digit depan, desimal 10x, drop, macet, lonjakan prematur\n" +
      "• Non-KWH: Typo angka ratusan/desimal, spike lonjakan/anjlok, drop sensor 0.00\n" +
      "• Proteksi: Jam Metering, Timestamp & Nama Teknisi DIJAMIN 100% TIDAK BERUBAH\n" +
      "• Proteksi Khusus: Kolom setpoint & data konstan (Min=Max) terlindungi aman\n\n" +
      "Lanjutkan perbaikan otomatis sekarang?",
      ui.ButtonSet.YES_NO
    );
    if (konfirmasi !== ui.Button.YES) return;
  }
  eksekusiAuditDanPerbaikan(true);
}

/**
 * ==============================================================================
 * ENGINE UTAMA (AUDIT, DETEKSI & ZERO-TOUCH WRITE)
 * ==============================================================================
 */
function eksekusiAuditDanPerbaikan(isApply) {
  if (typeof isApply === 'undefined') isApply = false;
  var ui = getSafeUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  var START_ROW = 2;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < START_ROW || lastCol < 1) return;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var numRows = lastRow - START_ROW + 1;
  var range = sheet.getRange(START_ROW, 1, numRows, lastCol);
  var values = range.getValues();
  var backgrounds = range.getBackgrounds();
  var notes = range.getNotes();

  var vavgIdx = -1, iavgIdx = -1, cosfiIdx = -1, ptotIdx = -1;
  for (var c = 0; c < lastCol; c++) {
    var hl = String(headers[c] || '').trim().toLowerCase();
    if (hl === "vavg") vavgIdx = c;
    if (hl === "iavg") iavgIdx = c;
    if (hl.includes("cos fi") || hl.includes("power faktor")) cosfiIdx = c;
    if (hl === "ptot") ptotIdx = c;
  }

  var totalDitemukan = 0;
  var totalDiperbaiki = 0;
  var ringkasanKolom = [];
  var statKwhCount = 0, statNonKwhCount = 0;

  for (var c = 0; c < lastCol; c++) {
    var h = String(headers[c] || '').trim();
    var hl = h.toLowerCase();

    // LEWATI DAN LINDUNGI TOTAL: Timestamp, Nama Teknisi, Jam Metering, dll.
    if (isIgnoredColumn(hl) || isStatusOrTextColumn(hl)) continue;

    var validVals = [];
    for (var r = 0; r < numRows; r++) {
      var v = parseCleanNumber(values[r][c]);
      if (v !== null) validVals.push(v);
    }
    if (validVals.length < 3) continue;

    validVals.sort(function(a, b) { return a - b; });
    var colMin = validVals[0];
    var colMax = validVals[validVals.length - 1];
    var colMed = validVals[Math.floor(validVals.length / 2)];
    var colSum = 0;
    for (var i = 0; i < validVals.length; i++) colSum += validVals[i];
    var colMean = colSum / validVals.length;

    // ATURAN: Jika Min, Max, Mean, Median sama (variansi 0) -> BUKAN ANOMALI
    if (Math.abs(colMax - colMin) < 0.0001) continue;

    var isKwh = isKwhColumn(hl);
    var isEdel = hl.includes("e del");

    var medDelta = 1.1;
    if (isKwh) {
      var deltas = [];
      for (var r = 1; r < numRows; r++) {
        var vC = parseCleanNumber(values[r][c]);
        var vP = parseCleanNumber(values[r - 1][c]);
        if (vC !== null && vP !== null && vC > vP) deltas.push(vC - vP);
      }
      deltas.sort(function(a, b) { return a - b; });
      if (deltas.length > 0) medDelta = deltas[Math.floor(deltas.length / 2)];
      else medDelta = isEdel ? 0.0002 : (hl.includes("timing") ? 2.0 : 1.1);
    }

    var isBad = new Array(numRows).fill(false);
    var badReasons = new Array(numRows).fill("");
    var recomVals = new Array(numRows).fill(null);
    var consecStagnanCount = 1;

    for (var r = 0; r < numRows; r++) {
      var cur = parseCleanNumber(values[r][c]);
      if (cur === null) {
        consecStagnanCount = 1;
        continue;
      }

      if (Math.abs(cur - colMed) < 0.00001 && !isKwh) {
        consecStagnanCount = 1;
        continue;
      }

      if (isKwh) {
        if (r > 0) {
          var prev = parseCleanNumber(values[r - 1][c]);
          if (prev !== null) {
            var diff = cur - prev;

            if (cur < prev * 0.5 && prev > 10000) {
              isBad[r] = true;
              recomVals[r] = prev + medDelta;
              badReasons[r] = "Typo Digit Depan KWH: " + cur + " (Sebelumnya " + prev + ")";
            }
            else if (cur > prev * 5 && cur > 100000) {
              isBad[r] = true;
              recomVals[r] = prev + medDelta;
              badReasons[r] = "Typo Titik Desimal 10x: " + cur + " (Sebelumnya " + prev + ")";
            }
            else if (diff < (isEdel ? -0.00005 : -0.1)) {
              isBad[r] = true;
              recomVals[r] = prev + medDelta;
              badReasons[r] = "Meter Turun: " + cur + " (Sebelumnya " + prev + ")";
            }
            else if (Math.abs(diff) < 0.00001 && !isEdel && !hl.includes("timing")) {
              isBad[r] = true;
              recomVals[r] = prev + medDelta;
              badReasons[r] = "Meter Macet/Kembar: " + cur;
            }
            else if (diff > 0 && diff <= 0.35 * medDelta && !isEdel && !hl.includes("timing")) {
              isBad[r] = true;
              recomVals[r] = prev + medDelta;
              badReasons[r] = "Merayap Mikro: +" + diff.toFixed(2) + " (Normal: +" + medDelta.toFixed(2) + ")";
            }

            if (!isBad[r] && r < numRows - 1) {
              var next = parseCleanNumber(values[r + 1][c]);
              if (next !== null) {
                var diffNext = cur - next;
                var spkThresh = isEdel ? 0.001 : 2.0 * medDelta;
                if (diff > spkThresh && diffNext > spkThresh) {
                  isBad[r] = true;
                  recomVals[r] = (prev + next) / 2;
                  badReasons[r] = "Typo Lonjakan: " + cur + " (Diapit " + prev + " & " + next + ")";
                }
              }
            }
          }
        }

        if (r > 0 && r < numRows - 2 && !isBad[r]) {
          var prev = parseCleanNumber(values[r - 1][c]);
          if (prev !== null && (cur - prev > 2.0 * medDelta)) {
            var next1 = parseCleanNumber(values[r + 1][c]);
            var next2 = parseCleanNumber(values[r + 2][c]);
            if (next1 !== null && next2 !== null && (next1 - cur <= 0.45 * medDelta || next2 - next1 <= 0.45 * medDelta)) {
              isBad[r] = true;
              recomVals[r] = prev + medDelta;
              badReasons[r] = "Lompatan Prematur: +" + (cur - prev).toFixed(2) + " vs Normal +" + medDelta.toFixed(2);
            }
          }
        }

        if (isBad[r]) statKwhCount++;

      } else {
        var checkPhy = cekBatasFisik(hl, cur);
        if (checkPhy.isError) {
          isBad[r] = true;
          recomVals[r] = colMed;
          badReasons[r] = checkPhy.reason;
        }

        if (!isBad[r] && hl === "ptot" && vavgIdx !== -1 && iavgIdx !== -1 && cosfiIdx !== -1) {
          var vVal = parseCleanNumber(values[r][vavgIdx]);
          var iVal = parseCleanNumber(values[r][iavgIdx]);
          var pfVal = parseCleanNumber(values[r][cosfiIdx]);
          if (vVal !== null && iVal !== null && pfVal !== null) {
            var pTeoretis = (3 * vVal * iVal * pfVal) / 1000;
            if (Math.abs(cur - pTeoretis) > 18.0) {
              isBad[r] = true;
              recomVals[r] = pTeoretis;
              badReasons[r] = "Anomali Korelasi Daya PLN: PTOT " + cur + " kW vs Teoretis " + pTeoretis.toFixed(1) + " kW";
            }
          }
        }

        if (!isBad[r]) {
          var wVals = [];
          for (var k = Math.max(0, r - 2); k <= Math.min(numRows - 1, r + 2); k++) {
            var vNum = parseCleanNumber(values[k][c]);
            if (vNum !== null) wVals.push(vNum);
          }

          if (wVals.length >= 3) {
            wVals.sort(function(a, b) { return a - b; });
            var wMed = wVals[Math.floor(wVals.length / 2)];

            if (wMed >= 85 && wMed <= 260 && Math.abs(wMed - cur - 100) < 25) {
              isBad[r] = true;
              recomVals[r] = cur + 100;
              badReasons[r] = "Typo Hilang Ratusan: " + cur + " (Normal ~" + wMed.toFixed(1) + ")";
            }
            else if (wMed >= 85 && cur < 30 && Math.abs(cur - Math.floor(wMed / 10)) <= 2) {
              isBad[r] = true;
              recomVals[r] = wMed;
              badReasons[r] = "Typo Hilang Digit Belakang: " + cur + " (Normal ~" + wMed.toFixed(1) + ")";
            }
            else if (wMed > 5 && Math.abs(cur - wMed * 10) < wMed * 2.5) {
              isBad[r] = true;
              recomVals[r] = cur / 10;
              badReasons[r] = "Typo Titik Desimal 10x: " + cur + " (Normal ~" + wMed.toFixed(1) + ")";
            }
            else if (wMed > 10 && Math.abs(cur - wMed / 10) < Math.max(wMed * 0.08, 2)) {
              isBad[r] = true;
              recomVals[r] = cur * 10;
              badReasons[r] = "Typo Titik Desimal 0.1x: " + cur + " (Normal ~" + wMed.toFixed(1) + ")";
            }
            else if ((cur > wMed + 35 && cur > wMed * 1.8) || (wMed > 0 && cur > wMed * 3.5 && cur - wMed > 15)) {
              isBad[r] = true;
              recomVals[r] = wMed;
              badReasons[r] = "Spike Naik Ekstrim: " + cur + " (Normal ~" + wMed.toFixed(1) + ")";
            }
            else if (wMed > 15 && cur < wMed * 0.60 && (wMed - cur) > 10) {
              isBad[r] = true;
              recomVals[r] = wMed;
              badReasons[r] = "Spike Anjlok Turun: " + cur + " (Normal ~" + wMed.toFixed(1) + ")";
            }
          }

          if (!isBad[r] && r > 0 && r < numRows - 1) {
            var prev = parseCleanNumber(values[r - 1][c]);
            var next = parseCleanNumber(values[r + 1][c]);
            if (prev !== null && next !== null) {
              var base = (prev + next) / 2;
              var diffP = cur - prev;
              var diffN = cur - next;

              if (diffP > 0 && diffN > 0) {
                var jump = Math.min(diffP, diffN);
                if ((base > 15 && jump / base > 0.35 && jump > 8) || jump > 25) {
                  isBad[r] = true;
                  recomVals[r] = base;
                  badReasons[r] = "Spike Naik Tajam: " + cur + " (Diapit " + prev + " & " + next + ")";
                }
              } else if (diffP < 0 && diffN < 0) {
                var drop = Math.min(Math.abs(diffP), Math.abs(diffN));
                if ((base > 15 && drop / base > 0.35 && drop > 8) || drop > 25) {
                  isBad[r] = true;
                  recomVals[r] = base;
                  badReasons[r] = "Spike Turun Tajam: " + cur + " (Diapit " + prev + " & " + next + ")";
                }
              }
            }
          }
        }

        if (!isBad[r] && isDynamicAnalogColumn(hl)) {
          if (r > 0) {
            var prev = parseCleanNumber(values[r - 1][c]);
            if (prev !== null && Math.abs(cur - prev) < 0.00001) {
              consecStagnanCount++;
              if (consecStagnanCount >= 5) {
                isBad[r] = true;
                recomVals[r] = colMed;
                badReasons[r] = "Sensor Stagnan/Macet: Nilai " + cur + " konstan " + consecStagnanCount + " shift berturut-turut";
              }
            } else {
              consecStagnanCount = 1;
            }
          } else {
            consecStagnanCount = 1;
          }
        } else {
          consecStagnanCount = 1;
        }

        if (isBad[r]) statNonKwhCount++;
      }

      if (isBad[r]) {
        totalDitemukan++;
        var decP = getDecPlaces(hl, cur, cur);
        var recomFormatted = recomVals[r] !== null ? Number(recomVals[r]).toFixed(decP) : colMed.toFixed(decP);

        if (!isApply) {
          backgrounds[r][c] = COLOR_ANOMALY;
          notes[r][c] = "[ANOMALI TERDETEKSI]\n" +
                        "• Parameter: " + h + "\n" +
                        "• Nilai Terbaca: " + cur + "\n" +
                        "• Nilai Rekomendasi: " + recomFormatted + "\n" +
                        "• Keterangan: " + badReasons[r];
        }
      }
    }

    // NORMALISASI PERBAIKAN: HANYA TULIS KOLOM YANG DIPERBAIKI (ZERO-TOUCH KE METADATA)
    if (isApply) {
      var r = 0;
      var colFixed = 0;

      while (r < numRows) {
        if (isBad[r]) {
          var startIdx = r - 1;
          while (startIdx >= 0 && isBad[startIdx]) startIdx--;

          var endIdx = r;
          while (endIdx < numRows && isBad[endIdx]) endIdx++;

          var vStart = (startIdx >= 0 && startIdx < numRows) ? parseCleanNumber(values[startIdx][c]) : null;
          var vEnd   = (endIdx >= 0 && endIdx < numRows) ? parseCleanNumber(values[endIdx][c]) : null;

          var anchorA = vStart !== null ? vStart : vEnd;
          var anchorB = vEnd !== null ? vEnd : vStart;

          if (anchorA !== null && anchorB !== null) {
            var totalSteps = endIdx - startIdx;
            var slope = totalSteps > 0 ? (anchorB - anchorA) / totalSteps : 0;
            var decPlaces = getDecPlaces(hl, anchorA, anchorB);
            var decFactor = Math.pow(10, decPlaces);

            for (var k = Math.max(0, startIdx + 1); k < Math.min(numRows, endIdx); k++) {
              var oldVal = values[k][c];
              var calculated = anchorA + ((k - startIdx) * slope);
              var finalVal = decPlaces === 0 ? Math.round(calculated) : Math.round(calculated * decFactor) / decFactor;

              if (isKwh && k > 0 && values[k - 1]) {
                var prevVal = Number(values[k - 1][c]);
                if (!isNaN(prevVal) && finalVal <= prevVal) {
                  finalVal = Math.round((prevVal + (1 / decFactor)) * decFactor) / decFactor;
                }
              }

              values[k][c] = finalVal;
              backgrounds[k][c] = COLOR_PREDICTED;
              notes[k][c] = "[TERKOREKSI OTOMATIS]\n" +
                            "• Parameter: " + h + "\n" +
                            "• Nilai Lama: " + oldVal + "\n" +
                            "• Nilai Baru (Rekomendasi): " + finalVal + "\n" +
                            "• Status: Normalisasi Linier (Sesuai Tren & Standar PLN)";
              colFixed++;
              totalDiperbaiki++;
            }
          }
          r = endIdx;
        } else {
          r++;
        }
      }

      // HANYA TULIS KOLOM INI JIKA ADA SEL YANG DIPERBAIKI
      if (colFixed > 0) {
        ringkasanKolom.push(h + " (" + colFixed + " sel)");
        var colDataOnly = new Array(numRows);
        for (var rowIdx = 0; rowIdx < numRows; rowIdx++) {
          colDataOnly[rowIdx] = [values[rowIdx][c]];
        }
        sheet.getRange(START_ROW, c + 1, numRows, 1).setValues(colDataOnly);
      }
    }
  }

  // Tulis warna dan catatan saja (tidak mengubah format angka di kolom lain)
  range.setBackgrounds(backgrounds);
  range.setNotes(notes);

  if (ui) {
    if (isApply) {
      ui.alert(
        "✅ Perbaikan Otomatis Selesai (v8.5)",
        "Berhasil menormalkan " + totalDiperbaiki + " sel anomali pada tab ini:\n\n" +
        "• Anomali KWH / Akumulator : " + statKwhCount + " sel\n" +
        "• Anomali Non-KWH & PLN    : " + statNonKwhCount + " sel\n\n" +
        "Rincian Kolom Terkoreksi:\n" +
        "• " + ringkasanKolom.slice(0, 15).join('\n• ') +
        (ringkasanKolom.length > 15 ? "\n...dan " + (ringkasanKolom.length - 15) + " kolom lainnya." : "") +
        "\n\nKolom Jam Metering, Timestamp & Teknisi tetap 100% terlindungi dalam format aslinya.",
        ui.ButtonSet.OK
      );
    } else {
      ui.alert(
        "🔍 Pemindaian Selesai (v8.5)",
        "Ditemukan total " + totalDitemukan + " sel anomali pada tab ini:\n\n" +
        "• KWH & Akumulator: " + statKwhCount + " sel (Typo digit depan, 10x, drop, macet)\n" +
        "• Non-KWH & PLN   : " + statNonKwhCount + " sel (Spike, batas mutu PLN, typo desimal)\n\n" +
        "Catatan rekomendasi telah disematkan pada setiap sel yang ditandai Merah (" + COLOR_ANOMALY + ").\n\n" +
        "Klik menu '2. ⚡ PERBAIKI SEMUA ANOMALI OTOMATIS' untuk menerapkan nilai rekomendasi.",
        ui.ButtonSet.OK
      );
    }
  }
}

/**
 * ==============================================================================
 * 3. 🧹 BERSIHKAN PENANDA WARNA & CATATAN
 * ==============================================================================
 */
function bersihkanPenanda() {
  var ui = getSafeUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var START_ROW = 2;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < START_ROW || lastCol < 1) return;

  var numRows = lastRow - START_ROW + 1;
  var range = sheet.getRange(START_ROW, 1, numRows, lastCol);

  range.clearNote();
  var bgs = range.getBackgrounds();
  var count = 0;

  for (var r = 0; r < numRows; r++) {
    for (var c = 0; c < lastCol; c++) {
      var color = String(bgs[r][c] || '').toLowerCase().trim();
      if (color === '#ff4d4d' || color === '#d9ead3' || color === '#f4cccc' || color === '#b6d7a8') {
        bgs[r][c] = '#ffffff';
        count++;
      }
    }
  }

  range.setBackgrounds(bgs);
  if (ui) ui.alert("🧹 Pembersihan Selesai", "Berhasil membersihkan " + count + " sel penanda warna dan menghapus seluruh catatan sel.", ui.ButtonSet.OK);
}

function resetTotalSemuaWarnaData() {
  var ui = getSafeUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var START_ROW = 2;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < START_ROW || lastCol < 1) return;

  var range = sheet.getRange(START_ROW, 1, lastRow - START_ROW + 1, lastCol);
  range.setBackground(null);
  range.clearNote();

  if (ui) ui.alert("Seluruh warna data dan catatan berhasil di-reset bersih.");
}

/**
 * ==============================================================================
 * 4. 📅 PENGURUTAN BARIS KRONOLOGIS
 * ==============================================================================
 */
function urutkanBarisKronologis() {
  var ui = getSafeUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var tsIdx = -1, jamIdx = -1;
  for (var c = 0; c < lastCol; c++) {
    var h = String(headers[c]).toLowerCase();
    if (h.includes("timestamp") || h.includes("tanggal")) tsIdx = c;
    if (h.includes("jam metering") || h === "jam") jamIdx = c;
  }

  var numRows = lastRow - 1;
  var tsVals = sheet.getRange(2, tsIdx + 1, numRows, 1).getValues();
  var jamVals = jamIdx !== -1 ? sheet.getRange(2, jamIdx + 1, numRows, 1).getValues() : null;
  var sortKeys = new Array(numRows);
  var lastDate = null;

  for (var r = 0; r < numRows; r++) {
    var d = parseTanggal(tsVals[r][0], lastDate);
    if (d) lastDate = d;
    var t = parseJam(jamVals ? jamVals[r][0] : null);
    if (d && t) {
      sortKeys[r] = [new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.hh, t.mm, 0).getTime() + (r / 100000)];
    } else {
      sortKeys[r] = [9999999999999 + r];
    }
  }

  var helperCol = lastCol + 1;
  sheet.getRange(2, helperCol, numRows, 1).setValues(sortKeys);
  sheet.getRange(2, 1, numRows, helperCol).sort({ column: helperCol, ascending: true });
  sheet.deleteColumn(helperCol);

  if (ui) ui.alert("Data berhasil diurutkan sesuai urutan waktu riil.");
}

/**
 * ==============================================================================
 * 5. 📁 FITUR BACKUP: MEMBUAT SHEET BARU LANGSUNG DI WORKBOOK INI
 * ==============================================================================
 */
function backupManualSesuaiBulan() {
  var ui = getSafeUi();
  if (!ui) return;

  var res = ui.prompt(
    "⚙️ Pecah / Backup Bulan ke Sheet Baru",
    "Masukkan Bulan & Tahun yang ingin dipindahkan ke tab Sheet baru:\n\n" +
    "Format:\n" +
    "• YYYY-MM (misal: 2026-08)\n" +
    "• Nama Bulan (misal: Agustus 2026)",
    ui.ButtonSet.OK_CANCEL
  );

  if (res.getSelectedButton() !== ui.Button.OK) return;
  var input = res.getResponseText().trim();
  if (!input) return;

  var targetYear = null, targetMonth = null;
  var m1 = input.match(/^(\d{4})[\/\-](\d{1,2})$/);
  if (m1) { targetYear = parseInt(m1[1], 10); targetMonth = parseInt(m1[2], 10); }

  var m2 = input.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (!m1 && m2) { targetMonth = parseInt(m2[1], 10); targetYear = parseInt(m2[2], 10); }

  if (!targetYear || !targetMonth) {
    var monthNames = [
      ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["mei", 5], ["may", 5],
      ["jun", 6], ["jul", 7], ["agu", 8], ["aug", 8], ["sep", 9], ["okt", 10],
      ["oct", 10], ["nov", 11], ["des", 12], ["dec", 12]
    ];
    var lower = input.toLowerCase();
    for (var i = 0; i < monthNames.length; i++) {
      if (lower.includes(monthNames[i][0])) { targetMonth = monthNames[i][1]; break; }
    }
    var yearMatch = input.match(/\b(20\d{2})\b/);
    if (yearMatch) targetYear = parseInt(yearMatch[1], 10);
  }

  if (!targetYear || !targetMonth || targetMonth < 1 || targetMonth > 12) {
    ui.alert("Format Tidak Valid", "Gunakan format: YYYY-MM (misal: 2026-08).", ui.ButtonSet.OK);
    return;
  }

  var paddedMonth = String(targetMonth).padStart(2, "0");
  var newSheetName = "BACKUP_BULAN_" + targetYear + paddedMonth;

  prosesPecahSheet(function(d) {
    return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
  }, "BULAN " + targetYear + "-" + paddedMonth, newSheetName);
}

function backupManualSesuaiTanggal() {
  var ui = getSafeUi();
  if (!ui) return;

  var res = ui.prompt("Backup Tanggal", "Masukkan tanggal: YYYY-MM-DD (misal: 2026-08-01)", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var tgl = res.getResponseText().trim();
  var cleanTgl = tgl.replace(/[\/\-]/g, "");
  var newSheetName = "BACKUP_TGL_" + cleanTgl;

  prosesPecahSheet(function(d) {
    var s = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    return s === tgl;
  }, tgl, newSheetName);
}

function backupOtomatis2BulanLalu() {
  var now = new Date();
  var target = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  var targetYear = target.getFullYear();
  var targetMonth = target.getMonth() + 1;
  var paddedMonth = String(targetMonth).padStart(2, "0");
  var newSheetName = "BACKUP_BULAN_" + targetYear + paddedMonth;

  prosesPecahSheet(function(d) { 
    return d.getMonth() === target.getMonth() && d.getFullYear() === target.getFullYear(); 
  }, "2 BULAN LALU (" + targetYear + "-" + paddedMonth + ")", newSheetName);
}

function backupLengkapSemuaData() { 
  var now = new Date();
  var ymd = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  var newSheetName = "BACKUP_LENGKAP_" + ymd;
  prosesPecahSheet(function() { return true; }, "LENGKAP", newSheetName); 
}

/**
 * ENGINE PEMINDAH DATA KE SHEET BARU DI WORKBOOK INI
 */
function prosesPecahSheet(filterFn, label, targetSheetName) {
  var ui = getSafeUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var currentSheet = ss.getActiveSheet();

  var data = currentSheet.getDataRange().getValues();
  if (data.length <= 1) {
    if (ui) ui.alert("Data Kosong", "Tidak ada baris data pada sheet saat ini.", ui.ButtonSet.OK);
    return;
  }

  var headers = data[0];
  var toBackup = [], toKeep = [headers];

  for (var i = 1; i < data.length; i++) {
    var d = parseTanggal(data[i][0]);
    if (d && filterFn(d)) {
      toBackup.push(data[i]);
    } else {
      toKeep.push(data[i]);
    }
  }

  if (toBackup.length === 0) {
    if (ui) ui.alert("Informasi", "[" + label + "]: Tidak ditemukan baris data yang cocok.", ui.ButtonSet.OK);
    return;
  }

  var newSheet = ss.getSheetByName(targetSheetName);
  if (!newSheet) {
    newSheet = ss.insertSheet(targetSheetName);
    newSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    newSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#EFEFEF");
    newSheet.setFrozenRows(1);
  }

  var nextRow = newSheet.getLastRow() + 1;
  newSheet.getRange(nextRow, 1, toBackup.length, toBackup[0].length).setValues(toBackup);

  currentSheet.clearContents();
  currentSheet.getRange(1, 1, toKeep.length, toKeep[0].length).setValues(toKeep);

  if (ui) {
    ui.alert(
      "✅ Berhasil Membuat Sheet Baru!",
      "[" + label + "]:\n\n" +
      "• Nama Sheet Baru: [" + targetSheetName + "]\n" +
      "• Jumlah baris dipindahkan: " + toBackup.length + " baris\n" +
      "• Sisa baris di sheet asal: " + (toKeep.length - 1) + " baris\n\n" +
      "Tab baru telah dibuat di sebelah tab saat ini.",
      ui.ButtonSet.OK
    );
  }
}

/**
 * OPTIONAL: TARIK DATA DARI SPREADSHEET MASTER KE SHEET BARU DI SINI
 */
function tarikDataDariMaster() {
  var ui = getSafeUi();
  if (!ui) return;

  var res = ui.prompt(
    "📥 Tarik Data dari Master",
    "Masukkan Bulan & Tahun dari file Master (YYYY-MM, misal: 2026-08):",
    ui.ButtonSet.OK_CANCEL
  );

  if (res.getSelectedButton() !== ui.Button.OK) return;
  var input = res.getResponseText().trim();
  var match = input.match(/^(\d{4})[\/\-](\d{1,2})$/);
  if (!match) {
    ui.alert("Format salah", "Gunakan format YYYY-MM (misal: 2026-08)", ui.ButtonSet.OK);
    return;
  }

  var targetYear = parseInt(match[1], 10);
  var targetMonth = parseInt(match[2], 10);
  var paddedMonth = String(targetMonth).padStart(2, "0");
  var newSheetName = "BACKUP_BULAN_" + targetYear + paddedMonth;

  var masterSS;
  try {
    masterSS = SpreadsheetApp.openById(SOURCE_ID);
  } catch (e) {
    ui.alert("Gagal Buka Master", "Tidak dapat membuka file master. Pastikan ID dan izin akses benar.", ui.ButtonSet.OK);
    return;
  }

  var masterSheet = masterSS.getSheetByName("MASTER-RESPONSE-MET") || 
                    masterSS.getSheetByName("MASTER METERING") || 
                    masterSS.getActiveSheet();
  var data = masterSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var headers = data[0];
  var toBackup = [], toKeep = [headers];

  for (var i = 1; i < data.length; i++) {
    var d = parseTanggal(data[i][0]);
    if (d && d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth) {
      toBackup.push(data[i]);
    } else {
      toKeep.push(data[i]);
    }
  }

  if (toBackup.length === 0) {
    ui.alert("Data Kosong", "Tidak ada data bulan " + targetYear + "-" + paddedMonth + " di Master.", ui.ButtonSet.OK);
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var newSheet = ss.getSheetByName(newSheetName);
  if (!newSheet) {
    newSheet = ss.insertSheet(newSheetName);
    newSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    newSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#EFEFEF");
    newSheet.setFrozenRows(1);
  }

  newSheet.getRange(newSheet.getLastRow() + 1, 1, toBackup.length, toBackup[0].length).setValues(toBackup);

  masterSheet.clearContents();
  masterSheet.getRange(1, 1, toKeep.length, toKeep[0].length).setValues(toKeep);

  ui.alert("✅ Sukses Tarik dari Master", "Berhasil menarik " + toBackup.length + " baris dari Master dan membuat tab [" + newSheetName + "] di file Backup ini.", ui.ButtonSet.OK);
}

/**
 * ==============================================================================
 * 6. HELPER & IDENTIFIKASI FISIK OPERASIONAL PLN
 * ==============================================================================
 */
function getSafeUi() { 
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; } 
}

function parseCleanNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    var s = val.trim();
    if (s === '' || s === '-' || s === 'OFF' || s === 'TRIP') return null;
    if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    else if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    var num = Number(s);
    return isNaN(num) ? null : num;
  }
  return null;
}

function isKwhColumn(hl) {
  return hl.includes("kwh") || hl.includes("e del") || hl.includes("wbp") || hl.includes("timing");
}

function isIgnoredColumn(hl) {
  return hl.includes("timestamp") || hl.includes("nama teknisi") || hl.includes("jam metering") ||
         hl.includes("section metering") || hl.includes("apakah sudah selesai");
}

function isStatusOrTextColumn(hl) {
  if (hl.includes("cooling status")) return false;
  return hl.includes("status") || hl.includes("lamp") || hl.includes("indikator") ||
         hl.includes("fan") || hl.includes("fheat") || hl.includes("exciter") ||
         hl.includes("control") || hl.includes("u-link") || hl.includes("dummy / bpf") ||
         hl.includes("plc") || hl.includes("apakah") || hl.includes("center freq");
}

function isStaticOrSetpointColumn(hl) {
  return hl.includes("sv") || hl.includes("forward power") || hl.includes("reflected") ||
         hl.includes("counter") || hl.includes("mode") || hl.includes("per") ||
         hl.includes("rf ex out") || hl.includes("ac-io") || hl.includes("snr tx a") ||
         hl.includes("im tx a") || hl.includes("incoming ups voltage") ||
         hl.includes("output voltage freq") || hl.includes("input ac freq") || hl.includes("bypass freq");
}

function isDynamicAnalogColumn(hl) {
  if (isStaticOrSetpointColumn(hl)) return false;
  return hl.includes("elbow") || hl.includes("rigid") || hl.includes("coolant tank pv") ||
         hl.includes("ptot") || hl.includes("coolant flow") || hl.includes("room temperature");
}

function cekBatasFisik(hl, val) {
  if (hl.includes("freq") || hl.includes("hz")) {
    if (val < 47.0 || val > 53.0) return { isError: true, reason: "Frekuensi abnormal (" + val + " Hz, standar PLN 50 Hz)" };
    return { isError: false };
  }
  if (hl.includes("faktor") || hl.includes("cos fi") || hl.includes("cos")) {
    if (val < 0.70 || val > 1.00) return { isError: true, reason: "Power factor abnormal (" + val + ", standar PLN min 0.85)" };
    return { isError: false };
  }
  if (hl === "kw" && (val < 70 || val > 150)) {
    return { isError: true, reason: "Daya KW Plant abnormal (" + val + " kW, normal 100-130 kW)" };
  }
  if (hl === "ptot" && (val < 50 || val > 95)) {
    return { isError: true, reason: "Daya PTOT Pemancar abnormal (" + val + " kW, normal 75-85 kW)" };
  }
  if (hl.includes("r-n") || hl.includes("s-n") || hl.includes("t-n") || hl === "vavg") {
    if (val < 170 || val > 260) return { isError: true, reason: "Tegangan Fasa-Netral abnormal (" + val + "V, standar PLN ~220V)" };
    return { isError: false };
  }
  if (hl.includes("voltage") || hl.includes("volt")) {
    if (val < 320 || val > 450) return { isError: true, reason: "Tegangan Fasa-Fasa abnormal (" + val + "V, normal ~400V)" };
    return { isError: false };
  }
  if (hl.includes("current") && !hl.includes("battery") && !hl.includes("ups current") && !hl.includes("batt-i")) {
    if (val < 0 || val > 180) return { isError: true, reason: "Arus AC saluran abnormal (" + val + " A)" };
    return { isError: false };
  }
  if (hl.includes("battery ups voltage")) {
    if (val < 460 || val > 550) return { isError: true, reason: "Tegangan Baterai UPS abnormal (" + val + "V, normal ~516V)" };
    return { isError: false };
  }
  if (hl.includes("battery ups current")) {
    if (val < 0 || val > 5.0) return { isError: true, reason: "Arus Baterai UPS abnormal (" + val + "A, normal 0.2-0.5A)" };
    return { isError: false };
  }
  if (hl.includes("dc dc-v")) {
    if (val < 500 || val > 650) return { isError: true, reason: "Tegangan DC Bus abnormal (" + val + "V, normal ~575V)" };
    return { isError: false };
  }
  if (hl.includes("dc batt-v")) {
    if (val < 320 || val > 440) return { isError: true, reason: "Tegangan DC BATT-V abnormal (" + val + "V, normal ~375V)" };
    return { isError: false };
  }
  if (hl.includes("cooling status") || hl.includes("coolant tank pv")) {
    if (val < 20 || val > 55) return { isError: true, reason: "Suhu Coolant TX abnormal (" + val + "°C, normal 30-45°C)" };
    return { isError: false };
  }
  if (hl.includes("temp") || hl.includes("elbow") || hl.includes("rigid")) {
    if (val < 14 || val > 35) return { isError: true, reason: "Suhu Ruang/Elbow abnormal (" + val + "°C, normal 18-28°C)" };
    return { isError: false };
  }
  if (hl.includes("preassure") || hl.includes("pressure")) {
    if (val < 1.5 || val > 6.0) return { isError: true, reason: "Tekanan Waveguide abnormal (" + val + " bar, normal 2.5-4.5)" };
    return { isError: false };
  }
  if (hl.includes("coolant flow")) {
    if (val < 35 || val > 75) return { isError: true, reason: "Coolant Flow abnormal (" + val + " L/min, normal 50-65)" };
    return { isError: false };
  }
  if (hl.includes("output tx")) {
    if (val < 5.0 || val > 15.0) return { isError: true, reason: "Output Power TX abnormal (" + val + " kW, normal ~10 kW)" };
    return { isError: false };
  }
  if (hl.includes("im tx") && val > 0) {
    return { isError: true, reason: "Intermodulation abnormal (+" + val + " dB, harus bernilai negatif)" };
  }

  return { isError: false };
}

function getDecPlaces(hl, anchorA, anchorB) {
  if (hl.includes("e del")) return 4;
  if (hl.includes("counter") || hl.includes("timing") || hl.includes("mode")) return 0;
  if (hl.includes("freq") || hl.includes("cos") || hl.includes("faktor") || hl.includes("ptot") ||
      hl.includes("vavg") || hl.includes("iavg") || hl.includes("kwh") || hl.includes("output tx") ||
      hl.includes("reflect tx") || hl.includes("link margin")) return 2;
  if (hl.includes("temp") || hl.includes("elbow") || hl.includes("rigid") || hl.includes("pv") ||
      hl.includes("battery") || hl.includes("snr") || hl.includes("pressure") || hl.includes("preassure") ||
      hl.includes("flow") || hl.includes("cooling")) return 1;
  if (anchorA % 1 === 0 && anchorB % 1 === 0) return 0;
  return 1;
}

function parseTanggal(val, prev) {
  if (!val) return prev;
  if (val instanceof Date) return val;
  var str = String(val).trim();
  var mIso = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (mIso) return new Date(parseInt(mIso[1], 10), parseInt(mIso[2], 10) - 1, parseInt(mIso[3], 10));
  var m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  return prev;
}

function parseJam(val) {
  if (!val) return null;
  if (val instanceof Date) return { hh: val.getHours(), mm: val.getMinutes() };
  var str = String(val).trim();
  var m = str.match(/(\d{1,2})[:.](\d{2})/);
  return m ? { hh: parseInt(m[1], 10) % 24, mm: parseInt(m[2], 10) } : null;
}
