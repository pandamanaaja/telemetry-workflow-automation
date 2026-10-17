/**
 * Shift code normalizer & composite deduplication key generator.
 */

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

function buildCompositeKey(displayRow) {
  const dateText = String(displayRow[0] || "").split(" ")[0].trim();
  const rawHour = String(displayRow[1] || "").trim().replace('.', ':');
  const techText = String(displayRow[2] || "").trim().toLowerCase().replace(/\s+/g, ' ');

  let normalizedHour = rawHour;
  if (rawHour.includes(":")) {
    const parts = rawHour.split(":");
    const h = parseInt(parts[0], 10);
    const m = parts[1] || "00";
    if (!isNaN(h)) {
      normalizedHour = `${h < 10 ? '0' + h : h}:${m}`;
    }
  }

  return `${dateText} | ${normalizedHour} | ${techText}`;
}

module.exports = {
  normalizeShiftCode,
  buildCompositeKey
};
