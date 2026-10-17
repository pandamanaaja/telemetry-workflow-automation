/**
 * Pure utility functions extracted from the n8n OCR node
 * for isolated unit testing and CI/CD validation.
 */

function safeNum(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).replace(/,/g, '.').replace(/[^0-9.\\-]/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : '';
}

function roundStr(n) {
  if (n === '' || n === null || n === undefined) return '';
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

function inRange(v, r) {
  const n = safeNum(v);
  return n !== '' && n >= r[0] && n <= r[1];
}

function normBase(t) {
  t = String(t || '');
  t = t.replace(/\r/g, '\n').replace(/[|]/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/d8|db/gi, 'dB');
  t = t.replace(/\b0P\b|\bQP\b|\bDP\b|\bOFP\b|\bO\/P\b/gi, 'OP');
  t = t.replace(/\bRFP\b|\bFUP\b|\bR\/P\b/gi, 'RP');
  t = t.replace(/\b0G\b|\bDG\b/gi, 'DC');
  t = t.replace(/\bD\s*PA1\b/gi, 'DPA1').replace(/\bD\s*PA2\b/gi, 'DPA2');
  t = t.replace(/\bF\s*PA([1-8])\b/gi, 'FPA$1');
  t = t.replace(/\bPA[-\s]?O([1-9])\b/gi, 'PA-0$1').replace(/\bPA[-\s]?0([1-9])\b/gi, 'PA-0$1').replace(/\bPA[-\s]?([1-9])\b/gi, 'PA-0$1').replace(/\bPA[-\s]?(10)\b/gi, 'PA-$1');
  return t.trim();
}

function correctNumberLike(s, unit = '') {
  s = String(s || '').replace(/,/g, '.');
  s = s.replace(/[OoQqDd]/g, '0');
  s = s.replace(/[Il|!]/g, '1');
  s = s.replace(/[Ss]/g, '5');
  s = s.replace(/[Bb]/g, '8');
  s = s.replace(/[Zz]/g, '2');
  s = s.replace(/[Gg]/g, '6');
  s = s.replace(/[Tt]/g, '7');
  if (String(unit).toUpperCase() !== 'A') s = s.replace(/[Aa]/g, '4');
  return s;
}

function normText(t) {
  t = normBase(t);
  t = t.replace(/(?<=\d)[OoQqDd](?=\d|\.|\s*[WAVC])/g, '0');
  t = t.replace(/(?<=\d)[Il|!](?=\d|\.|\s*[WAVC])/g, '1');
  t = t.replace(/(?<=\d)[Ss](?=\d|\.|\s*[WAVC])/g, '5');
  t = t.replace(/(?<=\d)[Bb](?=\d|\.|\s*[WAVC])/g, '8');
  return t.trim();
}

function extractNumberWithUnitFromText(text, unit, flex) {
  const out = [];
  const re = new RegExp(`([0-9OQDISBAGZTIl|!.,]+)\\s*${unit}\\b`, 'gi');
  for (const m of String(text || '').matchAll(re)) {
    const n = safeNum(correctNumberLike(m[1], unit));
    if (n !== '' && n >= flex[0] && n <= flex[1]) out.push(roundStr(n));
  }
  return out;
}

module.exports = {
  safeNum,
  roundStr,
  inRange,
  normBase,
  correctNumberLike,
  normText,
  extractNumberWithUnitFromText
};
