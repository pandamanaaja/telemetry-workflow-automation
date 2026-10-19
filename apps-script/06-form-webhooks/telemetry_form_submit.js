const N8N_WEBHOOK_URL = 'https://your-n8n-instance.example.com/webhook/YOUR_WEBHOOK_UUID';

const FORM_TITLE = 'N8N Form PA ST Joglo';
const QUESTION_JAM_LAPORAN = 'Jam Laporan';

function formatDateLocal(dateObj) {
  if (!dateObj) return '';
  var d = (dateObj instanceof Date) ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
}

function formatTimeLocal(dateObj) {
  if (!dateObj) return '';
  var d = (dateObj instanceof Date) ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Asia/Jakarta', 'HH:mm:ss');
}

function formatDateTimeLocal(dateObj) {
  if (!dateObj) return '';
  var d = (dateObj instanceof Date) ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
}

function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

function getTxLabel(questionTitle) {
  const title = normalizeText(questionTitle);
  if (title.includes('tx a')) return 'TX A';
  if (title.includes('tx b')) return 'TX B';
  return 'UNKNOWN';
}

function extractFileId(value) {
  if (!value) return '';
  const text = String(value).trim();
  let match = text.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (match) return match[1];
  match = text.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
  return '';
}

function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  const execId = Utilities.getUuid();

  try {
    lock.waitLock(30000);

    if (!e || !e.namedValues) {
      throw new Error('Event object tidak valid. Pastikan trigger: From spreadsheet â†’ On form submit.');
    }

    const now = new Date();
    const namedValues = e.namedValues;
    const responseId = 'RESP-' + Date.now();
    const props = PropertiesService.getScriptProperties();
    const dedupeKey = 'sent_' + responseId;

    if (props.getProperty(dedupeKey)) {
      Logger.log('SKIP duplicate submit. execId=' + execId);
      return;
    }

    const payload = {
      form_title: FORM_TITLE,
      response_id: responseId,
      submitted_at: formatDateTimeLocal(now),
      tanggal_submit: formatDateLocal(now),
      jam_submit: formatTimeLocal(now),
      respondent_email: '',
      batch_id: 'BATCH-' + now.getTime(),
      jam_laporan: '',
      files: []
    };

    // Counter dinamis per transmitter (mencegah tabrakan nomor urut)
    const txCounters = { 'TX A': 1, 'TX B': 1 };

    Object.keys(namedValues).forEach((questionTitle) => {
      const values = namedValues[questionTitle];
      if (!values || values.length === 0) return;

      if (normalizeText(questionTitle) === normalizeText(QUESTION_JAM_LAPORAN)) {
        payload.jam_laporan = values[0] || '';
        return;
      }

      const txLabel = getTxLabel(questionTitle);
      if (txLabel === 'UNKNOWN') return;

      const rawText = values.join(',');
      const fileUrls = rawText
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

      fileUrls.forEach((url) => {
        const fileId = extractFileId(url);
        if (!fileId) return;

        const currentIndex = txCounters[txLabel]++;
        let fileName = `${txLabel} Foto ${currentIndex}`;
        let mimeType = 'image/jpeg';
        let driveUrl = url;

        try {
          const file = DriveApp.getFileById(fileId);
          fileName = file.getName();
          mimeType = file.getMimeType();
          driveUrl = file.getUrl();
        } catch (err) {
          Logger.log('Warning: gagal baca detail file ID ' + fileId + ' | ' + err);
        }

        payload.files.push({
          tx: txLabel,
          image_index: currentIndex,
          image_name: fileName,
          drive_file_id: fileId,
          drive_url: driveUrl,
          mime_type: mimeType
        });
      });
    });

    if (payload.files.length === 0) {
      throw new Error('payload.files kosong. Tidak ada file upload TX A / TX B yang terbaca.');
    }

    const res = UrlFetchApp.fetch(N8N_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        "ngrok-skip-browser-warning": "true"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code >= 200 && code < 300) {
      props.setProperty(dedupeKey, new Date().toISOString());
      Logger.log('SUCCESS execId=' + execId + ' total_files=' + payload.files.length);
    } else {
      throw new Error('Webhook gagal. Code=' + code + ' Body=' + body);
    }

  } catch (error) {
    Logger.log('ERROR execId=' + execId + ': ' + error.toString());
    throw error;
  } finally {
    try {
      lock.releaseLock();
    } catch (err) {
      Logger.log('Lock release warning: ' + err);
    }
  }
}
