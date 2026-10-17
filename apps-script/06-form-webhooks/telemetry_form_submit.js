/**
 * =========================================================================
 * FORM SUBMISSION TELEMETRY DISPATCHER TO N8N
 * =========================================================================
 * Listens to Google Form submissions capturing transmitter photos (TX A & TX B),
 * extracts Google Drive file IDs, builds structured payload, and dispatches to n8n.
 */

const TELEMETRY_DISPATCHER_CONFIG = {
  N8N_WEBHOOK_URL: 'https://your-n8n-instance.com/webhook/telemetry-ocr-webhook',
  FORM_TITLE: 'Transmitter Telemetry Form',
  QUESTION_JAM_LAPORAN: 'Jam Laporan'
};

function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  const execId = Utilities.getUuid();

  try {
    lock.waitLock(30000);

    if (!e || !e.namedValues) {
      throw new Error('Invalid event object. Ensure trigger is installed as: From spreadsheet -> On form submit.');
    }

    const now = new Date();
    const namedValues = e.namedValues;
    const responseId = 'RESP-' + Date.now();
    const props = PropertiesService.getScriptProperties();
    const dedupeKey = 'sent_' + responseId;

    if (props.getProperty(dedupeKey)) {
      Logger.log('Duplicate submission skipped: ' + execId);
      return;
    }

    const payload = {
      form_title: TELEMETRY_DISPATCHER_CONFIG.FORM_TITLE,
      response_id: responseId,
      submitted_at: formatDateTime(now),
      tanggal_submit: formatDate(now),
      jam_submit: formatTime(now),
      respondent_email: '',
      batch_id: 'BATCH-' + now.getTime(),
      jam_laporan: '',
      files: []
    };

    Object.keys(namedValues).forEach((title) => {
      const values = namedValues[title];
      if (!values || values.length === 0) return;

      if (title.trim().toLowerCase() === TELEMETRY_DISPATCHER_CONFIG.QUESTION_JAM_LAPORAN.toLowerCase()) {
        payload.jam_laporan = values[0] || '';
        return;
      }

      const txLabel = resolveTxLabel(title);
      if (txLabel === 'UNKNOWN') return;

      const startIndex = resolveStartIndex(title);
      const fileUrls = values.join(',').split(',').map(v => v.trim()).filter(Boolean);

      fileUrls.forEach((url, idx) => {
        const fileId = extractFileId(url);
        if (!fileId) return;

        let fileName = `${txLabel} Photo ${startIndex + idx}`;
        let mimeType = 'image/jpeg';
        let driveUrl = url;

        try {
          const file = DriveApp.getFileById(fileId);
          fileName = file.getName();
          mimeType = file.getMimeType();
          driveUrl = file.getUrl();
        } catch (_) {}

        payload.files.push({
          tx: txLabel,
          image_index: startIndex + idx,
          image_name: fileName,
          drive_file_id: fileId,
          drive_url: driveUrl,
          mime_type: mimeType
        });
      });
    });

    if (payload.files.length === 0) {
      throw new Error('No valid TX A / TX B image uploads found in submission.');
    }

    const response = UrlFetchApp.fetch(TELEMETRY_DISPATCHER_CONFIG.N8N_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      props.setProperty(dedupeKey, new Date().toISOString());
      Logger.log(`Successfully dispatched ${payload.files.length} images to n8n.`);
    } else {
      throw new Error(`Webhook failed with code ${code}: ${response.getContentText()}`);
    }

  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function resolveTxLabel(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('tx a')) return 'TX A';
  if (t.includes('tx b')) return 'TX B';
  return 'UNKNOWN';
}

function resolveStartIndex(title) {
  const m = String(title || '').match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

function extractFileId(value) {
  if (!value) return '';
  const text = String(value).trim();
  let m = text.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  m = text.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
  return '';
}

function formatDate(d) {
  return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
}

function formatTime(d) {
  return Utilities.formatDate(d, 'Asia/Jakarta', 'HH:mm:ss');
}

function formatDateTime(d) {
  return Utilities.formatDate(d, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
}
