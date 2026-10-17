/**
 * =========================================================================
 * TECHNICIAN ROSTER MATRIX & SHIFT CODE NORMALIZER
 * =========================================================================
 * Ingests monthly rosters from central scheduling spreadsheet, converts
 * color-coded shift blocks into standardized shift codes (e.g. C15, C31,
 * C47, OFF, CUTI), and generates a transposed daily deployment table.
 */

const SCHEDULE_CONFIG = {
  SOURCE_SPREADSHEET_ID: "YOUR_SOURCE_SCHEDULE_SPREADSHEET_ID",
  ROSTER_NAMES: [
    "Technician A",
    "Technician B",
    "Technician C",
    "Technician D",
    "Technician E",
    "Technician F",
    "Technician G",
    "Technician H",
    "Technician I"
  ]
};

function pullScheduleFromSelectedMonth() {
  const targetSheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const valB1 = targetSheet.getRange("B1").getValue();
  let selection = "";

  if (valB1 instanceof Date) {
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    selection = monthNames[valB1.getMonth()] + " " + valB1.getFullYear();
  } else {
    selection = String(valB1 || "").trim();
  }

  if (!selection) {
    Browser.msgBox("Please specify month and year in cell B1 first (e.g. 'Agustus 2026')");
    return;
  }

  executeSchedulePipeline(selection);
}

function executeSchedulePipeline(monthYearStr) {
  const targetSS = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = targetSS.getActiveSheet();

  const sourceSS = SpreadsheetApp.openById(SCHEDULE_CONFIG.SOURCE_SPREADSHEET_ID);
  const allSheets = sourceSS.getSheets();
  let sourceSheet = null;

  const parts = monthYearStr.toLowerCase().split(" ");
  const monthWord = parts[0];
  const yearWord = parts.length > 1 ? parts[1] : "";

  for (let s of allSheets) {
    const name = s.getName().toLowerCase().trim();
    if (name.includes(monthWord) && (!yearWord || name.includes(yearWord))) {
      sourceSheet = s;
      break;
    }
  }

  if (!sourceSheet) {
    Browser.msgBox(`Sheet tab for '${monthYearStr}' not found in source spreadsheet.`);
    return;
  }

  const sourceValues = sourceSheet.getDataRange().getValues();
  const sourceBg = sourceSheet.getDataRange().getBackgrounds();
  const sourceFC = sourceSheet.getDataRange().getFontColors();
  const sourceFW = sourceSheet.getDataRange().getFontWeights();

  let dateRowIdx = -1;
  let nameColIdx = -1;

  for (let r = 0; r < Math.min(10, sourceValues.length); r++) {
    for (let c = 0; c < Math.min(5, sourceValues[r].length); c++) {
      const val = String(sourceValues[r][c]).toLowerCase().trim();
      if (val === "teknisi" || val === "nama" || val === "technician") {
        nameColIdx = c;
        dateRowIdx = r + 1;
        break;
      }
    }
    if (nameColIdx !== -1) break;
  }

  if (nameColIdx === -1) { nameColIdx = 0; dateRowIdx = 4; }
  const dayRowIdx = Math.max(0, dateRowIdx - 1);

  let lastDateCol = 1;
  for (let c = nameColIdx + 1; c < sourceValues[dateRowIdx].length; c++) {
    const num = parseInt(sourceValues[dateRowIdx][c], 10);
    if (!isNaN(num) && num >= 1 && num <= 31) lastDateCol = c;
  }
  const totalColsNeeded = (lastDateCol - nameColIdx) + 1;

  // Map technician row locations in source
  const rowMap = {};
  for (let r = 0; r < sourceValues.length; r++) {
    const nameVal = String(sourceValues[r][nameColIdx] || "").trim().toLowerCase().replace(/\s+/g, ' ');
    if (nameVal) rowMap[nameVal] = r;
  }

  // Clear previous output range
  targetSheet.getRange("A5:AZ100").clearContent().clearFormat();

  // Populate formatted header
  const dayRowData = sourceValues[dayRowIdx].slice(nameColIdx + 1, lastDateCol + 1);
  const dateRowData = sourceValues[dateRowIdx].slice(nameColIdx + 1, lastDateCol + 1);
  dayRowData.unshift("Technician");
  dateRowData.unshift("");

  targetSheet.getRange(5, 1, 2, totalColsNeeded).setValues([dayRowData, dateRowData])
    .setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");

  // Extract technician schedules
  const newValues = [];
  const newBg = [];
  const newFC = [];
  const newFW = [];

  for (let k = 0; k < SCHEDULE_CONFIG.ROSTER_NAMES.length; k++) {
    const targetClean = SCHEDULE_CONFIG.ROSTER_NAMES[k].toLowerCase().trim();
    const foundRow = rowMap[targetClean] !== undefined ? rowMap[targetClean] : -1;

    if (foundRow !== -1) {
      const rowVal = sourceValues[foundRow].slice(nameColIdx + 1, lastDateCol + 1);
      const rowBg = sourceBg[foundRow].slice(nameColIdx + 1, lastDateCol + 1);
      const rowFc = sourceFC[foundRow].slice(nameColIdx + 1, lastDateCol + 1);
      const rowFw = sourceFW[foundRow].slice(nameColIdx + 1, lastDateCol + 1);

      rowVal.unshift(SCHEDULE_CONFIG.ROSTER_NAMES[k]);
      rowBg.unshift("#ffffff");
      rowFc.unshift("#000000");
      rowFw.unshift("bold");

      newValues.push(rowVal);
      newBg.push(rowBg);
      newFC.push(rowFc);
      newFW.push(rowFw);
    }
  }

  const startRowSchedule = 7;
  const targetRange = targetSheet.getRange(startRowSchedule, 1, newValues.length, totalColsNeeded);
  targetRange.setValues(newValues).setBackgrounds(newBg).setFontColors(newFC).setFontWeights(newFW);

  // Convert color codes to normalized shift codes
  const startRowConverted = startRowSchedule + newValues.length + 3;
  const convertedValues = [];

  for (let i = 0; i < newValues.length; i++) {
    const convRow = [SCHEDULE_CONFIG.ROSTER_NAMES[i]];
    for (let j = 1; j < totalColsNeeded; j++) {
      convRow.push(normalizeShiftCode(newValues[i][j], newBg[i][j]));
    }
    convertedValues.push(convRow);
  }

  targetSheet.getRange(startRowConverted - 1, 1).setValue("STANDARDIZED SHIFT CODE MATRIX").setFontWeight("bold");
  targetSheet.getRange(startRowConverted, 1, convertedValues.length, totalColsNeeded)
    .setValues(convertedValues).setHorizontalAlignment("center");

  // Render Daily Transpose Matrix
  const startHeaderTranspose = startRowConverted + convertedValues.length + 2;
  const transposeValues = [];
  const numDays = totalColsNeeded - 1;

  for (let day = 0; day < numDays; day++) {
    const dailyRow = [];
    for (let tech = 0; tech < convertedValues.length; tech++) {
      dailyRow.push(convertedValues[tech][day + 1]);
    }
    transposeValues.push(dailyRow);
  }

  targetSheet.getRange(startHeaderTranspose, 1).setValue("DAILY DEPLOYMENT TRANSPOSE").setFontWeight("bold");
  targetSheet.getRange(startHeaderTranspose + 1, 1, transposeValues.length, transposeValues[0].length)
    .setValues(transposeValues).setHorizontalAlignment("center");

  Browser.msgBox("Schedule ingestion and transposition completed successfully!");
}

function normalizeShiftCode(val, bg) {
  const value = String(val || "").trim();
  const backgroundColor = String(bg || "").toLowerCase();

  const isYellow = ["#ffff00", "#fff2cc", "#ffe599", "#ffd966"].includes(backgroundColor);
  const isGreen  = ["#92d050", "#38761d", "#6aa84f", "#8fce00", "#d9ead3"].includes(backgroundColor);
  const isRed    = ["#ff0000", "#f44336", "#e6b8b8", "#fce5cd"].includes(backgroundColor);
  const isBlue   = ["#00ffff", "#00b0f0", "#9fc5e8", "#c9daf8"].includes(backgroundColor);

  const valUpper = value.toUpperCase();
  if (valUpper === "DT") return "C47*";
  if (valUpper === "FS") return "C47'";
  if (valUpper === "SAKIT") return "SAKIT";
  if ((isYellow || isGreen) && valUpper === "OFF") return "OFF";
  if (isRed && valUpper === "CUTI") return "CUTI";
  if (isBlue && valUpper === "TL") return "D49*";

  if (isYellow) {
    if (value === "1") return "C15";
    if (value === "2") return "C31";
    if (value === "3") return "C47";
  } else if (isGreen) {
    if (value === "1") return "C17";
    if (value === "2") return "C33";
    if (value === "3") return "C01";
  }

  return value;
}
