/**
 * =========================================================================
 * POINTER-BASED INCREMENTAL PDF REPORT GENERATOR
 * =========================================================================
 * Monitors incoming rows in raw data sheet starting from a persistent
 * pointer (ScriptProperties: LAST_PROCESSED_ROW). Renders formatted site
 * sheets into PDF files and uploads them to site-specific Drive folders.
 */

const PDF_GENERATOR_CONFIG = {
  TIMEZONE: "Asia/Jakarta",
  DATA_SHEET_NAME: "Data_Mentah",
  LOCK_TIMEOUT_MS: 30000,
  PROPERTY_KEY_LAST_ROW: "LAST_PROCESSED_ROW",

  SITE_COLUMN_INDEX: 2,     // Column B (Site Identifier)
  TANGGAL_COLUMN_INDEX: 51, // Column AY (Date of Event)

  SITES: {
    station_alpha: {
      keyword: "bekasi",
      label: "Station Alpha",
      reportSheetName: "Station_Alpha_Template",
      folderId: "YOUR_STATION_ALPHA_FOLDER_ID"
    },
    station_beta: {
      keyword: "hambalang",
      label: "Station Beta",
      reportSheetName: "Station_Beta_Template",
      folderId: "YOUR_STATION_BETA_FOLDER_ID"
    }
  }
};

/**
 * Main polling engine to generate PDFs for newly arrived rows
 */
function checkAndGeneratePDF() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(PDF_GENERATOR_CONFIG.LOCK_TIMEOUT_MS)) {
    Logger.log("Concurrent instance running. Terminated.");
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dataSheet = ss.getSheetByName(PDF_GENERATOR_CONFIG.DATA_SHEET_NAME);

    if (!dataSheet) {
      throw new Error("Data sheet not found: " + PDF_GENERATOR_CONFIG.DATA_SHEET_NAME);
    }

    const lastRow = dataSheet.getLastRow();
    if (lastRow <= 1) return;

    const props = PropertiesService.getScriptProperties();
    let savedLastRow = props.getProperty(PDF_GENERATOR_CONFIG.PROPERTY_KEY_LAST_ROW);

    // Initialize baseline pointer to current last row if unset
    if (!savedLastRow) {
      props.setProperty(PDF_GENERATOR_CONFIG.PROPERTY_KEY_LAST_ROW, String(lastRow));
      Logger.log("Baseline pointer initialized at row: " + lastRow);
      return;
    }

    const lastProcessedRow = parseInt(savedLastRow, 10);
    if (lastRow <= lastProcessedRow) {
      Logger.log("No new rows found since row " + lastProcessedRow);
      return;
    }

    const numNewRows = lastRow - lastProcessedRow;
    const maxCols = Math.max(PDF_GENERATOR_CONFIG.SITE_COLUMN_INDEX, PDF_GENERATOR_CONFIG.TANGGAL_COLUMN_INDEX);
    const newRowsData = dataSheet.getRange(lastProcessedRow + 1, 1, numNewRows, maxCols).getValues();

    for (let i = 0; i < numNewRows; i++) {
      const currentRow = lastProcessedRow + 1 + i;
      const siteRaw = newRowsData[i][PDF_GENERATOR_CONFIG.SITE_COLUMN_INDEX - 1];
      const tanggalValue = newRowsData[i][PDF_GENERATOR_CONFIG.TANGGAL_COLUMN_INDEX - 1];
      const siteValue = String(siteRaw || "").trim().toLowerCase();

      if (!tanggalValue || !siteValue) {
        props.setProperty(PDF_GENERATOR_CONFIG.PROPERTY_KEY_LAST_ROW, String(currentRow));
        continue;
      }

      const siteConfig = resolveSiteConfig(siteValue);
      if (!siteConfig) {
        Logger.log(`Unrecognized site at row ${currentRow}: ${siteRaw}`);
        props.setProperty(PDF_GENERATOR_CONFIG.PROPERTY_KEY_LAST_ROW, String(currentRow));
        continue;
      }

      generatePdfForSite(ss, siteConfig);
      props.setProperty(PDF_GENERATOR_CONFIG.PROPERTY_KEY_LAST_ROW, String(currentRow));
    }

  } finally {
    lock.releaseLock();
  }
}

function generatePdfForSite(ss, siteConfig) {
  const reportSheet = ss.getSheetByName(siteConfig.reportSheetName);
  if (!reportSheet) {
    throw new Error("Report sheet template not found: " + siteConfig.reportSheetName);
  }

  const folder = DriveApp.getFolderById(siteConfig.folderId);
  const token = ScriptApp.getOAuthToken();

  const timestamp = Utilities.formatDate(new Date(), PDF_GENERATOR_CONFIG.TIMEZONE, "dd-MM-yyyy_HH-mm-ss");
  const fileName = `Report_${siteConfig.label}_${timestamp}.pdf`;

  const exportUrl =
    `https://docs.google.com/spreadsheets/d/${ss.getId()}/export` +
    `?format=pdf&gid=${reportSheet.getSheetId()}&size=A4&portrait=true&fitw=true` +
    `&sheetnames=false&printtitle=false&pagenumbers=false&gridlines=false&fzr=false` +
    `&top_margin=0.30&bottom_margin=0.30&left_margin=0.30&right_margin=0.30`;

  const response = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Failed to export PDF. HTTP ${response.getResponseCode()}`);
  }

  const file = folder.createFile(response.getBlob().setName(fileName));
  Logger.log("PDF created successfully: " + file.getName());
}

function resolveSiteConfig(siteValue) {
  const sites = Object.values(PDF_GENERATOR_CONFIG.SITES);
  for (const s of sites) {
    if (siteValue.includes(s.keyword)) return s;
  }
  return null;
}
