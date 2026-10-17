const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  safeNum,
  roundStr,
  inRange,
  normText,
  correctNumberLike,
  extractNumberWithUnitFromText
} = require('../src/telemetryParser');

describe('OCR Heuristic & Ambiguity Correction Tests', () => {
  it('correctNumberLike: converts OCR character confusions to digits', () => {
    assert.strictEqual(correctNumberLike('lO5'), '105');
    assert.strictEqual(correctNumberLike('S8'), '58');
    assert.strictEqual(correctNumberLike('Z6'), '26');
  });

  it('safeNum: parses numbers with comma or dot decimals', () => {
    assert.strictEqual(safeNum('49.50'), 49.5);
    assert.strictEqual(safeNum('49,50'), 49.5);
    assert.strictEqual(safeNum('invalid'), '');
  });

  it('roundStr: rounds floats to 2 decimal places and keeps integers clean', () => {
    assert.strictEqual(roundStr(49.555), '49.56');
    assert.strictEqual(roundStr(1000), '1000');
    assert.strictEqual(roundStr(''), '');
  });

  it('normText: standardizes telemetry panel label tokens', () => {
    const raw = '0P 1016 W  R/P 0 W  TEMP 40 C  0G 40 V  PA 01';
    const normalized = normText(raw);

    assert.ok(normalized.includes('OP'));
    assert.ok(normalized.includes('RP'));
    assert.ok(normalized.includes('DC'));
    assert.ok(normalized.includes('PA-01'));
  });

  it('extractNumberWithUnitFromText: extracts values within physical ranges', () => {
    const sampleText = 'OP 1016 W  RP 0 W  TEMP 40 C';
    const op = extractNumberWithUnitFromText(sampleText, 'W', [500, 1200]);
    const temp = extractNumberWithUnitFromText(sampleText, 'C', [30, 60]);

    assert.deepStrictEqual(op, ['1016']);
    assert.deepStrictEqual(temp, ['40']);
  });

  it('inRange: validates numerical physical limits correctly', () => {
    assert.strictEqual(inRange('1000', [500, 1200]), true);
    assert.strictEqual(inRange('400', [500, 1200]), false);
    assert.strictEqual(inRange('1300', [500, 1200]), false);
  });
});
