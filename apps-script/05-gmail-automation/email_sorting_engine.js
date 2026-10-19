/**
 * =========================================================================
 * MASTER ENGINE: AUTOMASI GMAIL ALL MAIL (LIBRARY & MASTER ACCOUNT VERSION)
 * Script ID: YOUR_SCRIPT_ID
 * =========================================================================
 */

var MAX_EXEC_TIME = 240000; // Batas aman 4 menit
var BATCH_SIZE = 50;
var USE_DATE_LIMIT_ON_TRIGGER = true; // Batasi pindaian rutin ke 30 hari terakhir agar hemat kuota

// ATURAN TERPUSAT (Logika Asli Anda Dipertahankan Sepenuhnya)
var RULES = [
  // A. OUTGOING / KELUAR
  { enabled: true, keywords: [], senders: ["site_a@example.com"], recipients: [], isSent: true, labelName: "Laporan Terkirim Panjang", archive: true },
  { enabled: true, keywords: [], senders: ["site_b@example.com"], recipients: [], isSent: true, labelName: "Laporan Terkirim Joglo", archive: true },

  // B. INCOMING / MASUK
  { enabled: true, keywords: [], senders: [], recipients: ["site_b@example.com"], isSent: false, labelName: "Site Joglo", archive: true },
  { enabled: true, keywords: [], senders: [], recipients: ["site_a@example.com"], isSent: false, labelName: "Site Panjang", archive: true },
  { enabled: true, keywords: ["PENGAJUAN DUTTY OFFICER"], senders: [], recipients: [], isSent: false, labelName: "DO ACC", archive: true },
  { enabled: true, keywords: ["Pengganti Tugas Cuti", "Cuti", "Pengajuan Cuti"], senders: [], recipients: [], isSent: false, labelName: "Pengganti Tugas Cuti", archive: true },
  { enabled: true, keywords: [], senders: ["drive-shares-dm-noreply@google.com", "drive-shares-noreply@google.com", "no-reply@accounts.google.com", "noreply-apps-scripts-notifications@google.com"], recipients: [], isSent: false, labelName: "Google Drive Notif", archive: true },
  { enabled: true, keywords: [], senders: ["broadcast@example.com", "it_ops@example.com", "it_ops2@example.com", "helpdesk@example.com"], recipients: [], isSent: false, labelName: "IT Alert", archive: true },
  { enabled: true, keywords: ["Konfirmasi Absensi Anda", "konfirmasi absensi", "Izin Absen", "Keterangan Absen", "medical", "Pengajuan Medical Reimbursement"], senders: [], recipients: [], isSent: false, labelName: "Konfirmasi Absen", archive: true },
  { enabled: true, keywords: [], senders: ["all_staff@example.com"], recipients: [], isSent: false, labelName: "Kegiatan Internal", archive: true },
  { enabled: true, keywords: [], senders: ["hrd@example.com","hub@example.com","benefit_admin@example.com"], recipients: [], isSent: false, labelName: "Info HRD", archive: true },
  { enabled: true, keywords: ["samsung"], senders: [], recipients: [], isSent: false, labelName: "Samsung", archive: true },
  { enabled: true, keywords: ["PEMBAYARAN DUTTY OFFICER"], senders: [], recipients: [], isSent: false, labelName: "PEMBAYARAN DUTTY OFFICER", archive: true },
  { enabled: true, keywords: ["Payroll Slip Salary"], senders: [], recipients: [], isSent: false, labelName: "Payroll Slip Salary", archive: true },
  { enabled: true, keywords: [], senders: ["internal_coop@example.com"], recipients: [], isSent: false, labelName: "Koperasi", archive: true },
  { enabled: true, keywords: ["duka cita", "duka"], senders: [], recipients: [], isSent: false, labelName: "Duka Cita", archive: true }
];

// =========================================================================
// 1. MANAJEMEN TRIGGER MASTER
// =========================================================================
function AKTIFKAN_OTOMATISASI_MASTER() {
  HENTIKAN_OTOMATISASI_MASTER();
  
  ScriptApp.newTrigger('sortEmailsMultiCriteria')
    .timeBased()
    .everyMinutes(5)
    .create();
    
  Logger.log("âœ… Otomatisasi AKUN MASTER berhasil diaktifkan rutin 5 menit!");
  sortEmailsMultiCriteria();
}

function HENTIKAN_OTOMATISASI_MASTER() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sortEmailsMultiCriteria') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log("ðŸ›‘ Trigger untuk akun Master dihentikan.");
}

// =========================================================================
// 2. CORE ENGINE (HIGH PERFORMANCE & HEMAT KUOTA API)
// =========================================================================
function sortEmailsMultiCriteria() {
  executeEmailSorting(USE_DATE_LIMIT_ON_TRIGGER);
}

// Fungsi manual untuk memproses seluruh riwayat email lama tanpa batas 30 hari
function prosesSemuaRiwayatEmailLama() {
  executeEmailSorting(false);
}

function executeEmailSorting(useDateLimit) {
  var startTime = Date.now();
  var labelCache = initLabelCache();

  for (var i = 0; i < RULES.length; i++) {
    if (Date.now() - startTime > MAX_EXEC_TIME) {
      Logger.log("â³ Waktu eksekusi mencapai batas aman 4 menit. Dilanjutkan pada pindaian berikutnya.");
      break;
    }

    var rule = RULES[i];
    if (rule.enabled === false) continue;

    var query = buildQuery(rule, RULES, useDateLimit);
    var threads = GmailApp.search(query, 0, BATCH_SIZE);

    if (threads.length > 0) {
      var label = getOrCreateLabel(rule.labelName, labelCache);

      // Hasil query sudah dieksklusi -label:, langsung proses dalam 1 batch tanpa looping per thread
      label.addToThreads(threads);

      if (rule.archive) {
        GmailApp.moveThreadsToArchive(threads);
      }
      
      Logger.log("âœ“ [" + rule.labelName + "] Berhasil memproses " + threads.length + " email.");
    }
  }
}

// =========================================================================
// HELPER: BUILD QUERY (DENGAN LOGIKA ASLI ANDA)
// =========================================================================
function buildQuery(rule, allRules, useDateLimit) {
  var queryParts = [];

  // 1. Batasan waktu untuk pindaian rutin
  if (useDateLimit) {
    queryParts.push('newer_than:30d');
  }

  // 2. Kecualikan label agar thread yang sudah diproses tidak diambil lagi
  var excludeLabels = allRules.map(function(r) { return '-label:"' + r.labelName + '"'; }).join(" ");
  queryParts.push(excludeLabels);

  // 3. Logika Asli Anda (Dipertahankan Persis)
  if (rule.senders && rule.senders.length > 0) {
    queryParts.push('from:(' + rule.senders.join(' OR ') + ')');
  } else if (rule.isSent) {
    queryParts.push('from:me');
  } else {
    queryParts.push('-from:me');
  }

  if (rule.recipients && rule.recipients.length > 0) {
    queryParts.push('to:(' + rule.recipients.join(' OR ') + ')');
  }

  // 4. Kata Kunci Subjek
  if (rule.keywords && rule.keywords.length > 0) {
    var formattedKw = rule.keywords.map(function(k) { return '"' + k + '"'; }).join(' OR ');
    queryParts.push('subject:(' + formattedKw + ')');
  }

  return queryParts.join(" ");
}

// =========================================================================
// HELPER: CACHE LABEL (Mencegah Pemanggilan API Berulang Kali)
// =========================================================================
function initLabelCache() {
  var cache = {};
  var userLabels = GmailApp.getUserLabels();
  for (var i = 0; i < userLabels.length; i++) {
    cache[userLabels[i].getName().toLowerCase()] = userLabels[i];
  }
  return cache;
}

function getOrCreateLabel(labelName, cache) {
  var lowerName = labelName.toLowerCase();
  if (cache[lowerName]) {
    return cache[lowerName];
  }
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  cache[lowerName] = label;
  return label;
}

// =========================================================================
// HELPER: PEMBERSIHAN LABEL LENGKAP SAMPAI HABIS
// =========================================================================
function resetAndCleanLabels() {
  var totalCleaned = 0;
  for (var i = 0; i < RULES.length; i++) {
    var label = GmailApp.getUserLabelByName(RULES[i].labelName);
    if (label) {
      var threads = label.getThreads(0, 100);
      while (threads.length > 0) {
        label.removeFromThreads(threads);
        totalCleaned += threads.length;
        threads = label.getThreads(0, 100); // Lanjutkan batch berikutnya sampai benar-benar bersih
      }
    }
  }
  Logger.log("âœ… Pembersihan selesai. Total " + totalCleaned + " email dibersihkan dari label.");
}
