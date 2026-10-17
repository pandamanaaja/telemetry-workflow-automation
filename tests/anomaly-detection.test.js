const { describe, it } = require('node:test');
const assert = require('node:assert');
const { calculateStats, isNumericAnomaly } = require('../src/anomalyMath');

describe('Statistical Anomaly & Z-Score Tests', () => {
  it('calculateStats: accurately calculates mean and standard deviation', () => {
    const neighbors = [10, 12, 10, 12];
    const stats = calculateStats(neighbors);

    assert.strictEqual(stats.mean, 11);
    assert.ok(Math.abs(stats.stdDev - 1.1547) < 0.001);
  });

  it('isNumericAnomaly: normal telemetry fluctuation should NOT trigger anomaly', () => {
    const neighbors = [50, 51, 49, 50, 52];
    const currentVal = 50.5;

    const anomaly = isNumericAnomaly(currentVal, neighbors);
    assert.strictEqual(anomaly, false);
  });

  it('isNumericAnomaly: extreme telemetry outlier spike SHOULD trigger anomaly', () => {
    const neighbors = [50, 50.2, 49.8, 50.1, 49.9];
    const currentVal = 85.0; // Significant spike

    const anomaly = isNumericAnomaly(currentVal, neighbors);
    assert.strictEqual(anomaly, true);
  });

  it('isNumericAnomaly: tiny delta within min absolute threshold should NOT be anomaly', () => {
    const neighbors = [50.0, 50.0, 50.0, 50.0];
    const currentVal = 50.5; // Difference is 0.5, below MIN_ABSOLUTE_DIFF of 2.0

    const anomaly = isNumericAnomaly(currentVal, neighbors, { minAbsDiff: 2.0 });
    assert.strictEqual(anomaly, false);
  });
});
