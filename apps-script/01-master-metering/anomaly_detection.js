/**
 * =========================================================================
 * STATISTICAL ANOMALY & MISSING DATA SCANNER (MASTER METERING)
 * =========================================================================
 * Scans numeric columns for statistical outliers using a rolling Z-Score
 * algorithm while bypassing text, timestamp, and metadata headers.
 * Marks missing entries in timestamped rows and clears resolved anomalies.
 */

const SCANNER_CONFIG = {
  HEADER_ROW: 1,
  START_ROW: 2,
  WINDOW_SIZE: 3,           // Sliding window: 3 rows above & 3 rows below
  THRESHOLD_MULTIPLIER: 2.5, // Z-Score outlier threshold
  MIN_ABSOLUTE_DIFF: 2.0,    // Minimum absolute delta to consider anomaly
  MIN_PERCENT_CHANGE: 0.10,  // Minimum percentage delta (10%)
  COLOR_ANOMALY: "#FF4D4D",  // Red highlight for anomalies
  COLOR_NORMAL: "#FFFFFF"    // White reset for normal values
};

function detectNumericAnomaliesMasterMetering() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < SCANNER_CONFIG.START_ROW || lastCol < 1) {
    SpreadsheetApp.getUi().alert("Sheet is empty or no valid data rows found.");
    return;
  }

  const headers = sheet.getRange(SCANNER_CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];

  // Identify timestamp column index
  let timestampColIdx = -1;
  for (let c = 0; c < lastCol; c++) {
    const h = String(headers[c]).toLowerCase();
    if (h.includes("timestamp") || h.includes("stempel") || h.includes("waktu") || h.includes("date")) {
      timestampColIdx = c;
      break;
    }
  }

  const numRows = lastRow - SCANNER_CONFIG.START_ROW + 1;
  const range = sheet.getRange(SCANNER_CONFIG.START_ROW, 1, numRows, lastCol);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();

  let totalAnomaliesFound = 0;
  let totalEmptyFound = 0;
  let totalCleaned = 0;

  for (let colIdx = 0; colIdx < lastCol; colIdx++) {
    const headerName = String(headers[colIdx]).toLowerCase();

    // 1. Skip timestamp and time headers
    if (headerName.includes("timestamp") || headerName.includes("waktu") ||
        headerName.includes("stempel") || headerName.includes("jam")) {
      continue;
    }

    const colValues = values.map(row => row[colIdx]);

    // 2. Classify column type: text vs numeric
    let textCount = 0;
    let numberCount = 0;

    for (let r = 0; r < numRows; r++) {
      const val = colValues[r];
      if (val !== '' && val !== null) {
        if (typeof val === 'number' && !isNaN(val)) {
          numberCount++;
        } else if (typeof val === 'string' && isNaN(Number(val))) {
          textCount++;
        }
      }
    }

    // Bypass text-dominated columns & clean existing anomaly marks
    if (textCount > numberCount) {
      for (let r = 0; r < numRows; r++) {
        if (backgrounds[r][colIdx] === SCANNER_CONFIG.COLOR_ANOMALY || backgrounds[r][colIdx] === "#ff4d4d") {
          backgrounds[r][colIdx] = SCANNER_CONFIG.COLOR_NORMAL;
          totalCleaned++;
        }
      }
      continue;
    }

    // 3. Process numeric columns: build index map of valid rows
    const validRowIndices = [];
    const validRowPositionMap = {};
    for (let r = 0; r < numRows; r++) {
      const val = colValues[r];
      if (typeof val === 'number' && !isNaN(val) && val !== '' && !(val instanceof Date)) {
        validRowPositionMap[r] = validRowIndices.length;
        validRowIndices.push(r);
      }
    }

    for (let r = 0; r < numRows; r++) {
      const currentVal = colValues[r];
      const hasTimestamp = timestampColIdx !== -1 &&
                           values[r][timestampColIdx] !== '' &&
                           values[r][timestampColIdx] !== null;

      // Flag empty cells on rows that have valid timestamps
      if ((currentVal === '' || currentVal === null || isNaN(currentVal)) && hasTimestamp) {
        backgrounds[r][colIdx] = SCANNER_CONFIG.COLOR_ANOMALY;
        totalEmptyFound++;
        continue;
      }

      if (typeof currentVal !== 'number' || isNaN(currentVal) || currentVal === '') {
        continue;
      }

      // Rolling statistical outlier detection (Z-Score)
      if (validRowIndices.length >= 5) {
        const i = validRowPositionMap[r];
        if (i !== undefined) {
          const startIdx = Math.max(0, i - SCANNER_CONFIG.WINDOW_SIZE);
          const endIdx = Math.min(validRowIndices.length - 1, i + SCANNER_CONFIG.WINDOW_SIZE);

          const neighborValues = [];
          for (let j = startIdx; j <= endIdx; j++) {
            if (j !== i) {
              neighborValues.push(colValues[validRowIndices[j]]);
            }
          }

          if (neighborValues.length >= 2) {
            const mean = neighborValues.reduce((sum, v) => sum + v, 0) / neighborValues.length;
            const variance = neighborValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (neighborValues.length - 1);
            const stdDev = Math.sqrt(variance);

            const absDiff = Math.abs(currentVal - mean);
            const percentDiff = mean !== 0 ? absDiff / Math.abs(mean) : 0;

            let isAnomaly = false;

            if (stdDev > 0) {
              const zScore = absDiff / stdDev;
              if (zScore >= SCANNER_CONFIG.THRESHOLD_MULTIPLIER) {
                isAnomaly = true;
              }
            } else if (absDiff > 0.001) {
              isAnomaly = true;
            }

            if (isAnomaly && absDiff >= SCANNER_CONFIG.MIN_ABSOLUTE_DIFF && percentDiff >= SCANNER_CONFIG.MIN_PERCENT_CHANGE) {
              backgrounds[r][colIdx] = SCANNER_CONFIG.COLOR_ANOMALY;
              totalAnomaliesFound++;
            } else {
              if (backgrounds[r][colIdx] === SCANNER_CONFIG.COLOR_ANOMALY || backgrounds[r][colIdx] === "#ff4d4d") {
                totalCleaned++;
              }
              backgrounds[r][colIdx] = SCANNER_CONFIG.COLOR_NORMAL;
            }
          }
        }
      }
    }
  }

  // Batch update backgrounds in one single API call
  range.setBackgrounds(backgrounds);

  SpreadsheetApp.getUi().alert(
    `Anomaly Scan Completed!\n\n` +
    `- Missing Numeric Values (with Timestamp): ${totalEmptyFound} marked\n` +
    `- Statistical Outliers Detected: ${totalAnomaliesFound} marked\n` +
    `- Normal / Re-filled Cells Cleaned: ${totalCleaned} reset`
  );
}
