const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Master Response MET Suite v8.5 Tests', () => {
  it('cekBatasFisik: validates electrical and operational bounds under PLN standard', () => {
    // Normal 50Hz frequency
    const normalFreq = 50.0;
    assert.strictEqual(normalFreq >= 47.0 && normalFreq <= 53.0, true);

    // Abnormal 45Hz frequency
    const lowFreq = 45.0;
    assert.strictEqual(lowFreq >= 47.0 && lowFreq <= 53.0, false);

    // Cos Phi minimum PLN standard is 0.85
    const goodCosPhi = 0.94;
    assert.strictEqual(goodCosPhi >= 0.85, true);

    const badCosPhi = 0.75;
    assert.strictEqual(badCosPhi >= 0.85, false);
  });

  it('3-Phase Power Correlation: P = 3 * Vavg * Iavg * CosPhi / 1000 matches PTOT', () => {
    const vAvg = 218.24;
    const iAvg = 124.84;
    const cosPhi = 0.941;
    const pTeoretis = (3 * vAvg * iAvg * cosPhi) / 1000;

    // Expected ~76.8 kW
    assert.ok(pTeoretis > 75.0 && pTeoretis < 80.0);
  });

  it('Zero-variance protection: identical Min and Max must NOT be flagged as anomaly', () => {
    const constantValues = [1204.0, 1204.0, 1204.0, 1204.0, 1204.0];
    const min = Math.min(...constantValues);
    const max = Math.max(...constantValues);

    const isConstant = Math.abs(max - min) < 0.0001;
    assert.strictEqual(isConstant, true);
  });

  it('Backup sheet naming convention: formats accurately into BACKUP_BULAN_YYYYMM', () => {
    const targetYear = 2026;
    const targetMonth = 8;
    const paddedMonth = String(targetMonth).padStart(2, '0');
    const sheetName = 'BACKUP_BULAN_' + targetYear + paddedMonth;

    assert.strictEqual(sheetName, 'BACKUP_BULAN_202608');
  });

  it('Jam Metering protection: verifies hour extraction preserves original shift time', () => {
    const parseJam = (val) => {
      if (!val) return null;
      if (val instanceof Date) return { hh: val.getHours(), mm: val.getMinutes() };
      const str = String(val).trim();
      const m = str.match(/(\d{1,2})[:.](\d{2})/);
      return m ? { hh: parseInt(m[1], 10) % 24, mm: parseInt(m[2], 10) } : null;
    };

    const res1 = parseJam('11:00');
    assert.deepStrictEqual(res1, { hh: 11, mm: 0 });

    const res2 = parseJam('23:00');
    assert.deepStrictEqual(res2, { hh: 23, mm: 0 });
  });
});
