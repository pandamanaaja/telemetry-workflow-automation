/**
 * =========================================================================
 * COMPOSITE KEY DEDUPLICATION PROCESSOR (HIGH PERFORMANCE)
 * =========================================================================
 * Detects duplicate submissions using a multi-column composite key:
 * [Date/Timestamp (Col A)] + [Normalized Hour (Col B)] + [Technician (Col C)]
 *
 * Supports non-destructive highlighting or batch array-level deletion.
 */

function buildCompositeKey(displayRow) {
  const dateText = String(displayRow[0] || "").split(" ")[0].trim();
  const rawHour = String(displayRow[1] || "").trim().replace('.', ':');
  const techText = String(displayRow[2] || "").trim().toLowerCase().replace(/\s+/g, ' ');

  let normalizedHour = rawHour;
  if (rawHour.includes(":")) {
    const parts = rawHour.split(":");
    const h = parseInt(parts[0], 10);
    const m = parts[1] || "00";
    if (!isNaN(h)) {
      normalizedHour = `${h < 10 ? '0' + h : h}:${m}`;
    }
  }

  return `${dateText} | ${normalizedHour} | ${techText}`;
}

/**
 * Highlights duplicate rows in soft yellow (#FFF2CC) via batch setBackgrounds
 */
function highlightDuplicates() {
  processDuplicatesInternal(false);
  SpreadsheetApp.getUi().alert("Duplicate highlighting completed.");
}

/**
 * Removes duplicate rows cleanly using batch in-memory rewriting
 */
function removeDuplicates() {
  processDuplicatesInternal(true);
  SpreadsheetApp.getUi().alert("Duplicate removal completed.");
}

function processDuplicatesInternal(autoDelete = false) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2) return;

  const displayValues = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const rawValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const backgrounds = autoDelete ? null : sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();

  const seenKeys = new Set();
  const duplicateRowIndices = [];
  const cleanRows = [rawValues[0]]; // Retain header row

  for (let i = 1; i < displayValues.length; i++) {
    const row = displayValues[i];
    if (!row[0]) continue; // Ignore empty rows

    const key = buildCompositeKey(row);
    if (seenKeys.has(key)) {
      duplicateRowIndices.push(i + 1);
      if (!autoDelete) {
        for (let c = 0; c < lastCol; c++) {
          backgrounds[i][c] = "#FFF2CC"; // Highlight row
        }
      }
    } else {
      seenKeys.add(key);
      cleanRows.push(rawValues[i]);
    }
  }

  if (duplicateRowIndices.length === 0) return;

  if (autoDelete) {
    // High-performance batch rewrite
    sheet.getRange(1, 1, lastRow, lastCol).clearContent();
    sheet.getRange(1, 1, cleanRows.length, lastCol).setValues(cleanRows);
  } else {
    // Batch set backgrounds in one call
    sheet.getRange(1, 1, lastRow, lastCol).setBackgrounds(backgrounds);
  }
}
