// Sensitive-text detection rules with false-positive heuristics.
//
// The OCR pipeline feeds us per-line text. Because OCR frequently splits a single
// identifier across several "words" (and drops spaces), we match against a
// *compact* (whitespace-removed) representation of each line and map matched
// character ranges back to the union of the covered word boxes. This yields a
// precise redaction zone instead of nuking a whole line.

// ---- helpers ---------------------------------------------------------------

// Chinese National ID 18-digit checksum (ISO 7064:1983, MOD 11-2).
function validCnIdChecksum(id) {
  if (!/^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(id)) {
    return false;
  }
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let s = 0;
  for (let i = 0; i < 17; i++) s += Number(id[i]) * w[i];
  const checks = "10X98765432";
  return checks[s % 11] === id[17].toUpperCase();
}

// Luhn check for bank/card numbers (6..19 digits).
function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---- rule definition -------------------------------------------------------

// strictness: 1 = lenient (more hits, more false positives), 3 = only high
// confidence. Each rule carries `confidence`; lenient mode (1) keeps
// low-confidence rules too, strict mode (3) drops confidence < 0.8.
//
// A rule's `test` runs on the compact line text and must return either:
//   null (no match)  or  { start, end }
// `guard` optionally receives the whole compact + the match and returns true
// when the match should be *kept* (used to reject digit-boundary collisions).
const RULES = [
  {
    id: "openai_key",
    label: "OpenAI API Key",
    severity: "high",
    confidence: 1.0,
    re: /sk-(?:proj-)?[A-Za-z0-9_\-]{20,}/i,
  },
  {
    id: "anthropic_key",
    label: "Anthropic API Key",
    severity: "high",
    confidence: 1.0,
    re: /sk-ant-[A-Za-z0-9\-]{20,}/i,
  },
  {
    id: "aws_key",
    label: "AWS Access Key",
    severity: "high",
    confidence: 1.0,
    re: /AKIA[0-9A-Z]{16}/,
  },
  {
    id: "google_key",
    label: "Google API Key",
    severity: "high",
    confidence: 1.0,
    re: /AIza[0-9A-Za-z\-_]{35}/,
  },
  {
    id: "github_key",
    label: "GitHub Token",
    severity: "high",
    confidence: 0.85,
    re: /gh[pousr]_[A-Za-z0-9]{36,}/,
  },
  {
    id: "jwt",
    label: "JWT Token",
    severity: "high",
    confidence: 0.9,
    re: /eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/,
  },
  {
    id: "cn_id",
    label: "Chinese ID Number",
    severity: "critical",
    confidence: 1.0,
    re: /[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/,
    test: (m) => {
      if (typeof m === "string") return validCnIdChecksum(m) ? { start: 0, end: m.length } : null;
      const raw = m[0];
      if (!validCnIdChecksum(raw)) return null;
      return { start: m.index, end: m.index + raw.length };
    },
  },
  {
    id: "cn_phone",
    label: "CN Mobile Number",
    severity: "high",
    confidence: 0.7,
    re: /1[3-9]\d{9}/,
    test: (m, compact) => {
      const raw = m[0];
      const s = m.index;
      const e = s + raw.length;
      // Reject when glued to more digits (e.g. a longer random number).
      const beforeDigit = s > 0 && /\d/.test(compact[s - 1]);
      const afterDigit = e < compact.length && /\d/.test(compact[e]);
      if (beforeDigit || afterDigit) return null;
      return { start: s, end: e };
    },
  },
  {
    id: "email",
    label: "Email Address",
    severity: "medium",
    confidence: 0.6,
    re: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/,
  },
  {
    id: "eth_address",
    label: "Ethereum Address",
    severity: "high",
    confidence: 0.9,
    re: /0x[a-fA-F0-9]{40}/,
  },
  {
    id: "btc_address",
    label: "Bitcoin Address",
    severity: "high",
    confidence: 0.85,
    re: /[13][a-km-zA-HJ-NP-Z1-9]{25,34}/,
  },
  {
    id: "bank_card",
    label: "Bank Card Number",
    severity: "critical",
    confidence: 0.4,
    re: /\b\d{13,19}\b/,
    test: (m) => {
      const raw = m[0];
      // Exclude obvious year-heavy numbers and validate with Luhn.
      if (!luhnValid(raw)) return null;
      const first = Number(raw[0]);
      if (first < 4) return null; // major card ranges start 4-6
      return { start: m.index, end: m.index + raw.length };
    },
  },
  {
    id: "named_secret",
    label: "Named Secret / Token",
    severity: "medium",
    confidence: 0.5,
    re: /(?:api[_-]?key|apikey|token|secret|password|passwd|私钥|密钥|口令)\s*[=:：]\s*[A-Za-z0-9_\-]{12,}/i,
  },
];

// Unanchored keyword phrases (may contain spaces) matched against the spaced
// sentence, not the compact form.
const KEYWORD_PHRASES = [
  { text: "confidential", severity: "medium", confidence: 0.5 },
  { text: "internal use only", severity: "medium", confidence: 0.4 },
  { text: "绝密", severity: "medium", confidence: 0.6 },
  { text: "机密", severity: "medium", confidence: 0.6 },
  { text: "内部文件", severity: "medium", confidence: 0.5 },
  { text: "财务报表", severity: "high", confidence: 0.5 },
  { text: "top secret", severity: "high", confidence: 0.6 },
];

// ---- zone building ---------------------------------------------------------

function unionWords(wordBoxes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of wordBoxes) {
    if (w.x < x0) x0 = w.x;
    if (w.y < y0) y0 = w.y;
    if (w.x + w.w > x1) x1 = w.x + w.w;
    if (w.y + w.h > y1) y1 = w.y + w.h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Map a [start,end) range in the compact string to the word boxes it covers.
function compactRangeToWords(compact, words, start, end) {
  const boxes = [];
  let pos = 0;
  for (const w of words) {
    const wLen = w.text.replace(/\s/g, "").length;
    if (wLen === 0) continue;
    const wStart = pos;
    const wEnd = pos + wLen;
    if (wEnd > start && wStart < end) boxes.push(w.bbox);
    pos = wEnd;
  }
  return boxes;
}

/**
 * Scan OCR lines (each: { text, words:[{text,bbox:{x,y,w,h}}] , bbox }).
 * Returns redact zones: [{ x, y, w, h, label, severity, confidence, kind }].
 * kind: "pii" for matched text, "keyword" for keyword phrases.
 */
export function detectSensitiveZones(lines, options = {}) {
  const strictness = options.strictness ?? 2;
  const extraKeywords = options.keywords ?? [];
  const zones = [];

  for (const line of lines) {
    const words = line.words ?? [{ text: line.text, bbox: line.bbox }];
    const spaced = words.map((w) => w.text).join(" ");
    const compact = spaced.replace(/\s/g, "");

    // 1) Compact (space-less) pattern rules.
    for (const rule of RULES) {
      if (rule.confidence < 0.6 && strictness < 2) continue; // lenient drops low-confidence
      // The rule regexes aren't /g; use a global clone so exec advances.
      const gre = new RegExp(rule.re.source, rule.re.flags.replace("g", "") + "g");
      let m;
      const matches = [];
      while ((m = gre.exec(compact)) !== null) {
        const r = rule.test ? rule.test(m, compact) : { start: m.index, end: m.index + m[0].length };
        if (r && r.end > r.start) matches.push(r);
        if (m.index === gre.lastIndex) gre.lastIndex++; // protect zero-width
        if (matches.length > 20) break;
      }
      for (const r of matches) {
        const boxes = compactRangeToWords(compact, words, r.start, r.end);
        const bbox = unionWords(boxes.length ? boxes : [line.bbox]);
        zones.push({ ...bbox, label: rule.label, severity: rule.severity, confidence: rule.confidence, kind: "pii" });
      }
    }

    // 2) Keyword phrases (spaced sentence).
    const allPhrases = [...KEYWORD_PHRASES, ...extraKeywords.map((k) => ({ text: k, severity: "medium", confidence: 0.4 }))];
    for (const ph of allPhrases) {
      if (spaced.toLowerCase().includes(ph.text.toLowerCase())) {
        zones.push({ ...line.bbox, label: `Keyword: ${ph.text}`, severity: ph.severity, confidence: ph.confidence, kind: "keyword" });
      }
    }
  }

  // Merge overlapping zones from the same kind+severity to avoid stacking.
  return mergeZones(zones);
}

function mergeZones(zones) {
  const out = [];
  for (const z of zones) {
    const hit = out.find((o) => rectsOverlap(o, z) && o.kind === z.kind && o.severity === z.severity);
    if (hit) {
      Object.assign(hit, unionRect(hit, z), { label: hit.severity === z.severity ? hit.label : `${hit.label}, ${z.label}` , confidence: Math.max(hit.confidence, z.confidence)});
    } else {
      out.push({ ...z });
    }
  }
  return out;
}

function rectsOverlap(a, b, pad = 2) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}
function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

// ---- helpers re-exports ----------------------------------------------------

export { validCnIdChecksum, luhnValid };
