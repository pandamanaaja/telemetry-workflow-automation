/**
 * =========================================================================
 * MULTI-CRITERIA GMAIL ROUTING & ARCHIVAL ENGINE
 * =========================================================================
 * Automatically scans incoming and outgoing threads against business rules,
 * assigns hierarchical labels, and archives processed threads to keep the
 * inbox at zero. Includes execution timeout protection and trigger lifecycle.
 */

const GMAIL_ENGINE_CONFIG = {
  MAX_EXEC_TIME_MS: 240000, // 4-minute execution guard
  BATCH_SIZE: 50,
  RULES: [
    // Outgoing Dispatch & Reports
    { enabled: true, senders: ["station-alpha@company.com"], isSent: true, labelName: "Reports/Station-Alpha", archive: true },
    { enabled: true, senders: ["station-beta@company.com"], isSent: true, labelName: "Reports/Station-Beta", archive: true },

    // Incoming Station Operational Alerts
    { enabled: true, recipients: ["station-alpha@company.com"], isSent: false, labelName: "Operations/Station-Alpha", archive: true },
    { enabled: true, recipients: ["station-beta@company.com"], isSent: false, labelName: "Operations/Station-Beta", archive: true },

    // HR, Leave, & Duty Officer Approvals
    { enabled: true, keywords: ["DUTY OFFICER APPROVAL", "DO APPROVAL"], labelName: "HR/Duty-Officer-Approved", archive: true },
    { enabled: true, keywords: ["Leave Request", "Permit", "Cuti"], labelName: "HR/Leave-Requests", archive: true },
    { enabled: true, keywords: ["Attendance Confirmation", "Absensi"], labelName: "HR/Attendance", archive: true },
    { enabled: true, keywords: ["Payroll", "Slip Gaji"], labelName: "Finance/Payroll", archive: true },

    // Infrastructure & Automated Systems
    { enabled: true, senders: ["drive-shares-noreply@google.com", "no-reply@accounts.google.com"], labelName: "System/Drive-Notifications", archive: true },
    { enabled: true, senders: ["it-alerts@company.com", "helpdesk@company.com"], labelName: "IT/Alerts", archive: true }
  ]
};

/**
 * Activates recurring trigger (Every 5 minutes)
 */
function activateGmailEngineTrigger() {
  deactivateGmailEngineTrigger();
  ScriptApp.newTrigger('sortEmailsMultiCriteria')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log("Automated 5-minute Gmail sorting engine activated.");
  sortEmailsMultiCriteria();
}

/**
 * Removes existing triggers
 */
function deactivateGmailEngineTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let t of triggers) {
    if (t.getHandlerFunction() === 'sortEmailsMultiCriteria') {
      ScriptApp.deleteTrigger(t);
    }
  }
  Logger.log("Gmail sorting triggers removed.");
}

/**
 * Main worker function
 */
function sortEmailsMultiCriteria() {
  const startTime = Date.now();
  const rules = GMAIL_ENGINE_CONFIG.RULES;
  const managedLabels = rules.map(r => r.labelName.toLowerCase());

  for (let rule of rules) {
    if (!rule.enabled) continue;

    // Execution time safety guard to prevent script timeouts
    if (Date.now() - startTime > GMAIL_ENGINE_CONFIG.MAX_EXEC_TIME_MS) {
      Logger.log("Execution time limit reached. Deferring remainder to next cycle.");
      break;
    }

    const query = buildSearchQuery(rule, rules);
    const threads = GmailApp.search(query, 0, GMAIL_ENGINE_CONFIG.BATCH_SIZE);

    if (threads.length > 0) {
      const label = getOrCreateLabel(rule.labelName);
      const threadsToProcess = [];

      for (let thread of threads) {
        const existingLabels = thread.getLabels();
        const alreadyLabeled = existingLabels.some(l => managedLabels.includes(l.getName().toLowerCase()));

        if (!alreadyLabeled) {
          threadsToProcess.push(thread);
        }
      }

      if (threadsToProcess.length > 0) {
        label.addToThreads(threadsToProcess);
        if (rule.archive) {
          GmailApp.moveThreadsToArchive(threadsToProcess);
        }
        Logger.log(`[${rule.labelName}] Processed ${threadsToProcess.length} threads.`);
      }
    }
  }
}

function buildSearchQuery(rule, allRules) {
  const excludeLabels = allRules.map(r => `-label:"${r.labelName}"`).join(" ");
  const queryParts = [excludeLabels];

  if (rule.senders && rule.senders.length > 0) {
    queryParts.push('from:(' + rule.senders.join(' OR ') + ')');
  } else if (rule.isSent) {
    queryParts.push('from:me');
  } else {
    queryParts.push('-from:me');
  }

  if (rule.recipients && rule.recipients.length > 0) {
    queryParts.push('to:(' + rule.recipients.join(' OR ') + ')');
  }

  if (rule.keywords && rule.keywords.length > 0) {
    const formattedKw = rule.keywords.map(k => `"${k}"`).join(' OR ');
    queryParts.push('subject:(' + formattedKw + ')');
  }

  return queryParts.join(" ");
}

function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}
