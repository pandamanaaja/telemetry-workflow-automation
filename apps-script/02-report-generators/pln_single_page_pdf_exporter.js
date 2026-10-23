/**
 * ============================================================
 * PLN REPORT - SINGLE PAGE PDF EXPORT UTILITY
 * ============================================================
 *
 * Export:
 * - A4 Landscape (default) or Portrait
 * - Guaranteed Fit to 1 Page (scale=4 without fitw override conflict)
 * - Selected sheet only (via gid)
 * - Selected range only (via 0-based r1, c1, r2, c2)
 * - No gridlines, no additional instruction sheets
 */

function exportPLNSinglePagePDF(
  spreadsheetId,
  sheetName,
  rangeA1,
  outputFolderId,
  fileName,
  isLandscape = true
) {
  if (!spreadsheetId || !sheetName || !rangeA1 || !outputFolderId) {
    throw new Error('PARAMETER_EXPORT_TIDAK_LENGKAP');
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Sheet tidak ditemukan: ' + sheetName);
  }

  const range = sheet.getRange(rangeA1);
  SpreadsheetApp.flush();

  const gid = sheet.getSheetId();
  const r1 = range.getRow() - 1;
  const c1 = range.getColumn() - 1;
  const r2 = r1 + range.getNumRows();
  const c2 = c1 + range.getNumColumns();

  const params = {
    format: 'pdf',
    size: 'A4',
    portrait: String(!isLandscape),
    scale: '4', // 4 = Fit to 1 page (width & height)
    sheetnames: 'false',
    printtitle: 'false',
    pagenumbers: 'false',
    gridlines: 'false',
    fzr: 'false',
    top_margin: '0.15',
    bottom_margin: '0.15',
    left_margin: '0.20',
    right_margin: '0.20',
    horizontal_alignment: 'CENTER',
    vertical_alignment: 'TOP',
    gid: String(gid),
    r1: String(r1),
    c1: String(c1),
    r2: String(r2),
    c2: String(c2)
  };

  const query = Object.entries(params)
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value))
    .join('&');

  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?' + query;

  const response = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(
      'PDF Export Failed: HTTP ' + code + ' - ' + response.getContentText().slice(0, 300)
    );
  }

  const cleanName = String(fileName || sheetName)
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_') + '.pdf';

  const blob = response.getBlob().setName(cleanName);

  if (!blob.getContentType().includes('pdf')) {
    throw new Error('Export tidak menghasilkan PDF: ' + blob.getContentType());
  }

  const folder = DriveApp.getFolderById(outputFolderId);
  const file = folder.createFile(blob);

  return {
    ok: true,
    file_id: file.getId(),
    file_name: file.getName(),
    file_url: file.getUrl(),
    sheet_name: sheetName,
    export_range: rangeA1,
    orientation: isLandscape ? 'LANDSCAPE' : 'PORTRAIT'
  };
}
