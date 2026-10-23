/**
 * ============================================================
 * GOOGLE FORM → n8n UPLOAD WEBHOOK (v14.3 - OPTIMIZED)
 * ============================================================
 * Add this to the Apps Script BOUND TO THE FORM RESPONSE SPREADSHEET.
 * Keep your existing production submit trigger DISABLED if installing this one,
 * otherwise the same PDF may be sent twice.
 *
 * Features:
 * - Case-insensitive & fallback question matching
 * - Deduplication guard via CacheService (prevents double-submit events)
 * - Auto-retry if n8n webhook experiences transient HTTP 502/503/504 errors
 */

const PLN_FORM_FORWARD = {
  SPREADSHEET_ID: 'YOUR_PLN_MASTER_SPREADSHEET_ID',
  WEBHOOK_URL: 'https://your-n8n-instance.example.com/webhook/pln-gemini-ocr-upload',
  TECHNICIAN_QUESTION: 'Nama Teknisi',
  FILE_QUESTION: 'Upload PDF'
};

function plnInstallFormSubmitTriggerV142() {
  const ss = SpreadsheetApp.openById(PLN_FORM_FORWARD.SPREADSHEET_ID);

  const oldHandlers = [
    'onPlnFormSubmit',
    'plnForwardFormSubmitV142',
    'plnForwardFormSubmitV143'
  ];

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (
      oldHandlers.includes(trigger.getHandlerFunction()) ||
      trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const trigger = ScriptApp.newTrigger('plnForwardFormSubmitV142')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  Logger.log('Trigger berhasil dibuat: ' + trigger.getUniqueId());

  return {
    ok: true,
    spreadsheet_id: ss.getId(),
    trigger_id: trigger.getUniqueId()
  };
}

function plnForwardFormSubmitV142(e) {
  if (!e || !e.namedValues) {
    throw new Error('Run via spreadsheet On form submit trigger, not Run button');
  }

  const submissionRow = e.range ? String(e.range.getRow()) : '';

  if (submissionRow) {
    const cache = CacheService.getScriptCache();
    const dedupKey = 'PLN_FORM_SUB_' + submissionRow;
    if (cache.get(dedupKey)) {
      console.warn('Duplicate form submit event ignored for row: ' + submissionRow);
      return;
    }
    cache.put(dedupKey, '1', 120);
  }

  const fields = e.namedValues;
  const entries = Object.entries(fields).map(([k, v]) => ({
    key: String(k || '').trim(),
    keyLower: String(k || '').trim().toLowerCase(),
    value: Array.isArray(v) ? v.filter(Boolean).join(', ').trim() : String(v || '').trim()
  }));

  const techTarget = PLN_FORM_FORWARD.TECHNICIAN_QUESTION.toLowerCase();
  const techEntry =
    entries.find(x => x.keyLower === techTarget) ||
    entries.find(x => x.keyLower.includes('teknisi') || x.keyLower.includes('technician'));

  const technician = techEntry ? techEntry.value : '';
  if (!technician) {
    throw new Error(
      'NO_TECHNICIAN_ANSWER: Kolom teknisi kosong atau tidak ditemukan. Kolom tersedia: ' +
      entries.map(x => x.key).join(', ')
    );
  }

  const fileTarget = PLN_FORM_FORWARD.FILE_QUESTION.toLowerCase();
  const fileEntry =
    entries.find(x => x.keyLower === fileTarget) ||
    entries.find(x => x.keyLower.includes('upload') || x.keyLower.includes('pdf')) ||
    entries.find(x => /drive\.google\.com|(?:\/d\/|[?&]id=)[A-Za-z0-9_-]{20,}/.test(x.value));

  const uploadAnswer = fileEntry ? fileEntry.value : '';
  if (!uploadAnswer) {
    throw new Error(
      'NO_UPLOAD_ANSWER: Kolom file PDF kosong atau tidak ditemukan. Kolom tersedia: ' +
      entries.map(x => x.key).join(', ')
    );
  }

  const matched = [...uploadAnswer.matchAll(/(?:\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/g)].map(m => m[1]);
  const fallback = uploadAnswer
    .split(/[,\n]+/)
    .map(s => s.trim())
    .filter(s => /^[A-Za-z0-9_-]{20,}$/.test(s));

  const fileIds = [...new Set([...matched, ...fallback])];
  if (!fileIds.length) {
    throw new Error('NO_DRIVE_IDS_FOUND_IN_UPLOAD: ' + uploadAnswer.slice(0, 150));
  }

  const payload = {
    file_ids: fileIds,
    technician: technician,
    'Nama Teknisi': technician,
    submission_id: submissionRow
  };

  let lastCode = 0;
  let lastBody = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = UrlFetchApp.fetch(PLN_FORM_FORWARD.WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    lastCode = response.getResponseCode();
    lastBody = response.getContentText();

    if (lastCode >= 200 && lastCode < 300) {
      console.log('Sent to n8n: ' + JSON.stringify({
        row: submissionRow,
        count: fileIds.length,
        technician: technician
      }));
      return;
    }

    if (attempt < 2) {
      Utilities.sleep(2000);
    }
  }

  throw new Error('N8N_WEBHOOK_HTTP_' + lastCode + ' / ' + lastBody.slice(0, 300));
}
