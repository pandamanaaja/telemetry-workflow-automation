const { describe, it } = require('node:test');
const assert = require('node:assert');
const { normalizeShiftCode, buildCompositeKey } = require('../src/shiftConverter');

describe('Roster Matrix & Deduplication Key Tests', () => {
  it('normalizeShiftCode: maps yellow shift cells correctly', () => {
    assert.strictEqual(normalizeShiftCode('1', '#ffff00'), 'C15');
    assert.strictEqual(normalizeShiftCode('2', '#ffe599'), 'C31');
    assert.strictEqual(normalizeShiftCode('3', '#ffd966'), 'C47');
  });

  it('normalizeShiftCode: maps green shift cells correctly', () => {
    assert.strictEqual(normalizeShiftCode('1', '#92d050'), 'C17');
    assert.strictEqual(normalizeShiftCode('2', '#6aa84f'), 'C33');
    assert.strictEqual(normalizeShiftCode('3', '#8fce00'), 'C01');
  });

  it('normalizeShiftCode: maps special statuses (CUTI, OFF, SAKIT, DT, FS, TL)', () => {
    assert.strictEqual(normalizeShiftCode('CUTI', '#ff0000'), 'CUTI');
    assert.strictEqual(normalizeShiftCode('OFF', '#ffff00'), 'OFF');
    assert.strictEqual(normalizeShiftCode('SAKIT', '#ffffff'), 'SAKIT');
    assert.strictEqual(normalizeShiftCode('DT', '#ffffff'), 'C47*');
    assert.strictEqual(normalizeShiftCode('FS', '#ffffff'), 'C47\'');
    assert.strictEqual(normalizeShiftCode('TL', '#00ffff'), 'D49*');
  });

  it('buildCompositeKey: standardizes hour formats into uniform composite key', () => {
    const row1 = ['2026-08-19 10:00:00', '3:00', 'Technician A'];
    const row2 = ['2026-08-19', '03:00', 'technician a '];

    assert.strictEqual(buildCompositeKey(row1), '2026-08-19 | 03:00 | technician a');
    assert.strictEqual(buildCompositeKey(row2), '2026-08-19 | 03:00 | technician a');
    assert.strictEqual(buildCompositeKey(row1), buildCompositeKey(row2)); // Must match for deduplication!
  });
});
