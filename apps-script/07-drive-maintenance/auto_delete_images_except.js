/**
 * ==============================================================================
 * AUTO DELETE IMAGES MY DRIVE (HIGH PERFORMANCE - SERVER-SIDE SEARCH)
 * Menghapus semua file gambar di My Drive KECUALI folder tertentu & subfoldernya
 * ==============================================================================
 */

function autoDeleteImagesMyDriveExcept() {
  const startTime = new Date().getTime();
  const MAX_EXECUTION_TIME_MS = 5 * 60 * 1000; // Pengaman: Berhenti otomatis di menit ke-5 agar tidak timeout

  // ID Folder yang INGIN DIKECUALIKAN (beserta seluruh subfoldernya)
  const EXCLUDED_FOLDER_ID = 'YOUR_EXCLUDED_FOLDER_ID';

  // 1. PENGAMAN KEAMANAN: Pastikan folder pengecualian benar-benar ada
  const excludedFolderIds = new Set();
  try {
    const excludedFolder = DriveApp.getFolderById(EXCLUDED_FOLDER_ID);
    Logger.log(`Memetakan folder pengecualian: "${excludedFolder.getName()}"...`);
    collectAllSubfolderIds(excludedFolder, excludedFolderIds);
    Logger.log(`Total folder & subfolder yang dilindungi: ${excludedFolderIds.size} folder.`);
  } catch (err) {
    Logger.log(`ERROR KRITIS: Folder pengecualian ID '${EXCLUDED_FOLDER_ID}' tidak ditemukan! Operasi dibatalkan demi keamanan: ${err.message}`);
    return;
  }

  // 2. QUERY CEPAT SERVER-SIDE (Hanya mencari gambar milik sendiri yang belum di tong sampah)
  // Tidak perlu memindai file PDF, Docs, Sheets, Video, dll.
  const query = "mimeType contains 'image/' and trashed = false and 'me' in owners";
  const imageFiles = DriveApp.searchFiles(query);

  let deletedCount = 0;
  let protectedCount = 0;
  let isTimedOut = false;

  Logger.log("Mulai memproses file gambar...");

  // 3. PROSES FILE GAMBAR
  while (imageFiles.hasNext()) {
    // Cek batas waktu 5 menit agar script berhenti dengan aman
    if (new Date().getTime() - startTime > MAX_EXECUTION_TIME_MS) {
      isTimedOut = true;
      Logger.log("Peringatan: Batas waktu 5 menit tercapai. Script berhenti dengan aman untuk menghindari error timeout.");
      break;
    }

    const file = imageFiles.next();
    const parents = file.getParents();

    let isProtected = false;
    while (parents.hasNext()) {
      const parentId = parents.next().getId();
      if (excludedFolderIds.has(parentId)) {
        isProtected = true;
        break;
      }
    }

    if (isProtected) {
      protectedCount++;
    } else {
      file.setTrashed(true); // Pindahkan ke Sampah (Aman & bisa di-restore)
      deletedCount++;
    }
  }

  // 4. LAPORAN HASIL EKSEKUSI
  const durationSec = Math.round((new Date().getTime() - startTime) / 1000);
  Logger.log("================ HASIL PEMBERSIHAN ================");
  Logger.log(`Waktu Eksekusi   : ${durationSec} detik`);
  Logger.log(`Gambar Dihapus   : ${deletedCount} file`);
  Logger.log(`Gambar Dilindungi: ${protectedCount} file (di folder pengecualian)`);
  if (isTimedOut) {
    Logger.log("Status           : BELUM SELESAI SEMUA. Silakan jalankan script sekali lagi untuk melanjutkan sisa file.");
  } else {
    Logger.log("Status           : SELESAI SEMPURNA (Semua gambar di luar folder pengecualian telah dibersihkan).");
  }
  Logger.log("===================================================");
}


/**
 * Helper: Mengumpulkan ID folder utama dan seluruh anak subfoldernya ke dalam Set
 */
function collectAllSubfolderIds(folder, idSet) {
  idSet.add(folder.getId());
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    collectAllSubfolderIds(subfolders.next(), idSet);
  }
}
