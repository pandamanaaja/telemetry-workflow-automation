/**
 * =========================================================================
 * GOOGLE FORM SUBMIT DISPATCHER: PLN BILL OCR INGESTION
 * =========================================================================
 * Trigger: On form submit (from Google Form linked spreadsheet)
 * Extracts uploaded PLN bill PDF/image from Drive and dispatches payload
 * to n8n Webhook for automated Gemini Multimodal OCR extraction.
 */

const PLN_CONFIG = {
  N8N_WEBHOOK_URL: 'https://your-n8n-instance.example.com/webhook/pln-bill-webhook',
  FORM_TITLE: 'Form Tagihan Listrik PLN',
  LOCK_TIMEOUT_MS: 30000
};

/**
 * Main Trigger Handler
 * Configure via: Extensions -> Apps Script -> Triggers -> Add Trigger:
 * Event Source: From spreadsheet | Event Type: On form submit
 */
function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  const execId = Utilities.getUuid();

  try {
    lock.waitLock(PLN_CONFIG.LOCK_TIMEOUT_MS);

    if (!e || !e.namedValues) {
      throw new Error('Event object e.namedValues tidak ditemukan. Pastikan trigger adalah "On form submit".');
    }

    const now = new Date();
    const namedValues = e.namedValues;
    const responseId = 'RESP-PLN-' + now.getTime();
    const props = PropertiesService.getScriptProperties();
    const dedupeKey = 'sent_' + responseId;

    if (props.getProperty(dedupeKey)) {
      Logger.log('Dedupe skip for ' + responseId);
      return;
    }

    // 1. Ekstrak Berkas PDF / Gambar Tagihan yang Diunggah
    let uploadedFileId = '';
    let uploadedFileName = '';
    let uploadedMimeType = 'application/pdf';
    let uploadedFileUrl = '';
    let respondentEmail = '';

    for (const key of Object.keys(namedValues)) {
      const lowerKey = key.toLowerCase();
      const val = namedValues[key];

      if (lowerKey.includes('email') || lowerKey.includes('pengirim')) {
        respondentEmail = (val && val[0]) ? String(val[0]).trim() : '';
      }

      if (lowerKey.includes('upload') || lowerKey.includes('file') || lowerKey.includes('struk') || lowerKey.includes('pdf') || lowerKey.includes('tagihan') || lowerKey.includes('lampiran')) {
        const rawText = val ? val.join(',') : '';
        const match = rawText.match(/[-\w]{25,}/);
        if (match) {
          uploadedFileId = match[0];
        }
      }
    }

    // Jika belum ketemu di field spesifik, scan seluruh field
    if (!uploadedFileId) {
      for (const key of Object.keys(namedValues)) {
        const raw = String(namedValues[key] || '');
        const match = raw.match(/[-\w]{25,}/);
        if (match) {
          uploadedFileId = match[0];
          break;
        }
      }
    }

    if (!uploadedFileId) {
      throw new Error('Gagal mendeteksi berkas lampiran tagihan PLN pada form submit ini.');
    }

    // 2. Baca metadata berkas dari Google Drive
    try {
      const driveFile = DriveApp.getFileById(uploadedFileId);
      uploadedFileName = driveFile.getName();
      uploadedMimeType = driveFile.getMimeType();
      uploadedFileUrl = driveFile.getUrl();
    } catch (err) {
      Logger.log('Peringatan: Gagal membaca detail metadata file ID: ' + uploadedFileId + ' (' + err.message + ')');
      uploadedFileName = 'Tagihan_PLN_' + responseId + '.pdf';
      uploadedFileUrl = 'https://drive.google.com/file/d/' + uploadedFileId + '/view';
    }

    // 3. Bangun payload pengiriman
    const payload = {
      channel: 'Google Form',
      response_id: responseId,
      submitted_at: Utilities.formatDate(now, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss"),
      respondent_email: respondentEmail,
      drive_file_id: uploadedFileId,
      file_name: uploadedFileName,
      mime_type: uploadedMimeType,
      drive_url: uploadedFileUrl
    };

    // 4. Kirim ke Webhook n8n
    const response = UrlFetchApp.fetch(PLN_CONFIG.N8N_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      props.setProperty(dedupeKey, now.toISOString());
      Logger.log(`[SUCCESS] execId=${execId} PLN file=${uploadedFileName} sent to n8n.`);
    } else {
      throw new Error(`Gagal mengirim ke n8n webhook. HTTP ${statusCode}: ${responseBody}`);
    }

  } catch (error) {
    Logger.log(`[ERROR] execId=${execId}: ${error.message}`);
    throw error;
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}
