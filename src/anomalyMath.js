/**
 * Rolling Z-score anomaly detector logic extracted for automated testing.
 */

function calculateStats(neighborValues) {
  if (!neighborValues || neighborValues.length < 2) return null;
  const mean = neighborValues.reduce((sum, v) => sum + v, 0) / neighborValues.length;
  const variance = neighborValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (neighborValues.length - 1);
  const stdDev = Math.sqrt(variance);
  return { mean, stdDev };
}

function isNumericAnomaly(currentVal, neighborValues, opts = {}) {
  const threshold = opts.threshold ?? 2.5;
  const minAbsDiff = opts.minAbsDiff ?? 2.0;
  const minPercentChange = opts.minPercentChange ?? 0.10;

  const stats = calculateStats(neighborValues);
  if (!stats) return false;

  const { mean, stdDev } = stats;
  const absDiff = Math.abs(currentVal - mean);
  const percentDiff = mean !== 0 ? absDiff / Math.abs(mean) : 0;

  let outlier = false;
  if (stdDev > 0) {
    const zScore = absDiff / stdDev;
    if (zScore >= threshold) outlier = true;
  } else if (absDiff > 0.001) {
    outlier = true;
  }

  return outlier && absDiff >= minAbsDiff && percentDiff >= minPercentChange;
}

module.exports = {
  calculateStats,
  isNumericAnomaly
};
