/**
 * ==============================================================================
 * AUTO DELETE IMAGES MY DRIVE (WITH FOLDER EXCLUSION GUARD)
 * ==============================================================================
 * Provides high-performance server-side querying and recursive folder tree
 * traversal to safely purge uploaded image blobs from Google Drive while
 * protecting vital site archive folders and their descendant subfolders.
 * ==============================================================================
 */

const CLEANER_CONFIG = {
  // Masukkan ID folder yang DIKECUALIKAN dari penghapusan
  EXCLUDED_FOLDER_IDS: [
    'YOUR_EXCLUDED_FOLDER_ID'
  ],
  MAX_EXECUTION_TIME_MS: 5 * 60 * 1000 // Pengaman 5 menit (batas kuota GAS 6 menit)
};

/**
 * METODE 1: QUERY CEPAT SERVER-SIDE (Disarankan)
 * Memindai file gambar milik sendiri yang aktif tanpa memindai folder satu per satu.
 */
function autoDeleteImagesMyDriveExcept() {
  const startTime = new Date().getTime();
  const excludedFolderIds = new Set();

  try {
    CLEANER_CONFIG.EXCLUDED_FOLDER_IDS.forEach(id => {
      const folder = DriveApp.getFolderById(id);
      Logger.log(`Memetakan folder pengecualian: "${folder.getName()}"...`);
      collectAllSubfolderIds_(folder, excludedFolderIds);
    });
    Logger.log(`Total folder & subfolder terlindungi: ${excludedFolderIds.size}`);
  } catch (err) {
    Logger.log(`ERROR: Folder pengecualian tidak ditemukan. Operasi dibatalkan demi keamanan: ${err.message}`);
    return;
  }

  const query = "mimeType contains 'image/' and trashed = false and 'me' in owners";
  const imageFiles = DriveApp.searchFiles(query);

  let deletedCount = 0;
  let protectedCount = 0;
  let isTimedOut = false;

  Logger.log("Mulai memproses file gambar...");

  while (imageFiles.hasNext()) {
    if (new Date().getTime() - startTime > CLEANER_CONFIG.MAX_EXECUTION_TIME_MS) {
      isTimedOut = true;
      Logger.log("Peringatan: Batas waktu 5 menit tercapai. Berhenti dengan aman.");
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
      file.setTrashed(true);
      deletedCount++;
    }
  }

  const durationSec = Math.round((new Date().getTime() - startTime) / 1000);
  Logger.log("================ HASIL PEMBERSIHAN ================");
  Logger.log(`Waktu Eksekusi   : ${durationSec} detik`);
  Logger.log(`Gambar Dihapus   : ${deletedCount} file`);
  Logger.log(`Gambar Dilindungi: ${protectedCount} file`);
  Logger.log(`Status           : ${isTimedOut ? 'BELUM SELESAI (Jalankan ulang)' : 'SELESAI LENGKAP'}`);
  Logger.log("===================================================");
}

/**
 * METODE 2: TELUSUR REKURSIF (Folder Tree Traversal)
 * Menelusuri hirarki folder dari root My Drive secara bertahap.
 */
function autoDeleteImagesRecursive() {
  const rootFolder = DriveApp.getRootFolder();
  const state = {
    count: 0,
    excludedFolderIds: CLEANER_CONFIG.EXCLUDED_FOLDER_IDS,
    startTime: new Date().getTime(),
    maxExecutionTimeMs: CLEANER_CONFIG.MAX_EXECUTION_TIME_MS
  };

  Logger.log("Mulai penelusuran rekursif My Drive...");
  processFolderSafe_(rootFolder, state);
  Logger.log(`Selesai. Total gambar dipindahkan ke Sampah: ${state.count}`);
}

function processFolderSafe_(folder, state) {
  if (new Date().getTime() - state.startTime > state.maxExecutionTimeMs) {
    Logger.log("Batas waktu 5 menit tercapai. Jalankan kembali script untuk melanjutkan.");
    return;
  }

  if (state.excludedFolderIds.includes(folder.getId())) {
    Logger.log(`[DILEWATI] Folder pengecualian: "${folder.getName()}" (ID: ${folder.getId()})`);
    return;
  }

  const files = folder.getFiles();
  while (files.hasNext()) {
    if (new Date().getTime() - state.startTime > state.maxExecutionTimeMs) return;

    const file = files.next();
    try {
      if (file.getMimeType().startsWith('image/')) {
        file.setTrashed(true);
        state.count++;

        if (state.count % 50 === 0) {
          Logger.log(`Progress: ${state.count} gambar telah dipindahkan ke sampah...`);
        }
      }
    } catch (e) {
      Logger.log(`Gagal memproses file "${file.getName()}": ${e.message}`);
    }
  }

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    if (new Date().getTime() - state.startTime > state.maxExecutionTimeMs) return;
    processFolderSafe_(subfolders.next(), state);
  }
}

function collectAllSubfolderIds_(folder, idSet) {
  idSet.add(folder.getId());
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    collectAllSubfolderIds_(subfolders.next(), idSet);
  }
}
