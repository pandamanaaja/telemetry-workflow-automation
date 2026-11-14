const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Read and extract helper functions from master_metering_suite.js
const suitePath = path.join(__dirname, '..', 'apps-script', '01-master-metering', 'master_metering_suite.js');
const suiteCode = fs.readFileSync(suitePath, 'utf8');

// Mock GAS globals for evaluation
const SpreadsheetApp = {
  getActiveSpreadsheet: () => ({ getSheets: () => [] }),
  getUi: () => null
};
const PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} })
};
const Utilities = {
  formatDate: (d) => d.toISOString().split('T')[0]
};

// Evaluate suite code in safe sandbox
const fnContext = {};
const sandboxFunc = new Function('SpreadsheetApp', 'PropertiesService', 'Utilities', `
  ${suiteCode}
  return {
    formatOriginalShiftTime,
    isNaturallyNegativeColumn,
    parseUserDailyInput,
    parseUserMonthlyInput,
    parseNum,
    getColumnCategory
  };
`);

const {
  formatOriginalShiftTime,
  isNaturallyNegativeColumn,
  parseUserDailyInput,
  parseUserMonthlyInput,
  parseNum,
  getColumnCategory
} = sandboxFunc(SpreadsheetApp, PropertiesService, Utilities);

describe('Master Metering Suite v17.0 Tests', () => {
  it('formatOriginalShiftTime: restores original shift hours and strips Batavia 1899 :25 offset', () => {
    assert.strictEqual(formatOriginalShiftTime('07:25'), '7:00');
    assert.strictEqual(formatOriginalShiftTime('01:25'), '1:00');
    assert.strictEqual(formatOriginalShiftTime('23:25'), '23:00');
    assert.strictEqual(formatOriginalShiftTime('05:25:00'), '5:00');
    assert.strictEqual(formatOriginalShiftTime('7:00'), '7:00');

    // Date object handling (e.g. 1899 timestamp representation)
    const d = new Date(1899, 11, 30, 7, 25, 0);
    assert.strictEqual(formatOriginalShiftTime(d), '7:00');
  });

  it('isNaturallyNegativeColumn: protects negative telemetry parameters from being inverted to positive', () => {
    assert.strictEqual(isNaturallyNegativeColumn('PER', -7.0), true);
    assert.strictEqual(isNaturallyNegativeColumn('GRID VOLTAGE TX A', -106.8), true);
    assert.strictEqual(isNaturallyNegativeColumn('GRID VOLTAGE TX B', -128.5), true);
    assert.strictEqual(isNaturallyNegativeColumn('PLN IVM Voltage R-S', 395.0), false);
    assert.strictEqual(isNaturallyNegativeColumn('CUSTOM_SENSOR', -45.0), true);
  });

  it('parseUserDailyInput: supports flexible Indonesian and standard date formats', () => {
    const d1 = parseUserDailyInput('2026-03-05');
    assert.deepStrictEqual(d1, { year: 2026, month: 3, day: 5 });

    const d2 = parseUserDailyInput('05/03/2026');
    assert.deepStrictEqual(d2, { year: 2026, month: 3, day: 5 });

    const d3 = parseUserDailyInput('5 Maret 2026');
    assert.deepStrictEqual(d3, { year: 2026, month: 3, day: 5 });
  });

  it('parseUserMonthlyInput: supports flexible monthly archive inputs', () => {
    const m1 = parseUserMonthlyInput('2026-03');
    assert.deepStrictEqual(m1, { year: 2026, month: 3 });

    const m2 = parseUserMonthlyInput('Maret 2026');
    assert.deepStrictEqual(m2, { year: 2026, month: 3 });

    const m3 = parseUserMonthlyInput('3');
    assert.deepStrictEqual(m3, { year: 2026, month: 3 });
  });

  it('getColumnCategory: categorizes columns into KWH, HOUR_METER, and PURE_PATTERN', () => {
    assert.strictEqual(getColumnCategory('Timestamp'), 'SKIP_TEXT');
    assert.strictEqual(getColumnCategory('WAKTU METERING'), 'SKIP_TEXT');
    assert.strictEqual(getColumnCategory('TEKNISI'), 'SKIP_TEXT');
    assert.strictEqual(getColumnCategory('PLN IVM KWH'), 'KWH');
    assert.strictEqual(getColumnCategory('LWBP TX A'), 'LWBP');
    assert.strictEqual(getColumnCategory('WBP TX A'), 'WBP');
    assert.strictEqual(getColumnCategory('HOUR METER TX A'), 'HOUR_METER_TX');
    assert.strictEqual(getColumnCategory('GRID VOLTAGE TX A'), 'PURE_PATTERN_NON_KWH');
    assert.strictEqual(getColumnCategory('PER'), 'PURE_PATTERN_NON_KWH');
  });
});
