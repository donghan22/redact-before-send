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

function capturedRange(match, group = 1) {
  const value = match[group];
  const start = match.index + match[0].lastIndexOf(value);
  return { start, end: start + value.length };
}

function validUsSsn(value) {
  const match = /^(\d{3})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return false;
  const area = Number(match[1]);
  return area !== 0 && area !== 666 && area < 900 && match[2] !== "00" && match[3] !== "0000";
}

function validIban(value) {
  const iban = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    if (/\d/.test(char)) remainder = (remainder * 10 + Number(char)) % 97;
    else remainder = (remainder * 100 + char.charCodeAt(0) - 55) % 97;
  }
  return remainder === 1;
}

function validChineseUscc(value) {
  const alphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY";
  const weights = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
  const code = value.toUpperCase();
  if (!/^[159Y][1239]/.test(code) || code.length !== 18 || [...code].some((char) => !alphabet.includes(char))) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += alphabet.indexOf(code[i]) * weights[i];
  return alphabet[(31 - (sum % 31)) % 31] === code[17];
}

const PRIVATE_KEY_LABEL = "PEM / SSH Private Key";
const PRIVATE_KEY_BEGIN = /-----BEGIN(?:RSA|EC|DSA|OPENSSH|ENCRYPTED)?PRIVATEKEY-----/i;
const PRIVATE_KEY_END = /-----END(?:RSA|EC|DSA|OPENSSH|ENCRYPTED)?PRIVATEKEY-----/i;

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
    id: "oauth_token",
    label: "OAuth / Access Token",
    severity: "critical",
    confidence: 0.9,
    re: /(?:oauth[_-]?(?:access[_-]?|refresh[_-]?)?token|access[_-]?token|refresh[_-]?token|(?:authorization[:：=]?)?bearer)[:：=]*([A-Za-z0-9._~+\/\-]{16,}={0,2})/i,
    test: (m) => capturedRange(m),
  },
  {
    id: "session_cookie",
    label: "Session Cookie",
    severity: "critical",
    confidence: 0.9,
    re: /(?:session(?:id|token)?|jsessionid|phpsessid|connect\.sid|sessioncookie|cookie)[:：=]+([A-Za-z0-9._~+\/%\-]{12,}={0,2})/i,
    test: (m) => capturedRange(m),
  },
  {
    id: "database_url",
    label: "Database Connection String",
    severity: "critical",
    confidence: 0.95,
    re: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|mssql):\/\/[A-Za-z0-9%._~!$&'()*+,;=:@\/?#\-]{6,}/i,
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
    test: (m, compact) => {
      const prefix = compact.slice(0, m.index);
      if (/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|mssql):\/\/[^\s]*$/i.test(prefix)) return null;
      return { start: m.index, end: m.index + m[0].length };
    },
  },
  {
    id: "passport_number",
    label: "Passport Number",
    severity: "critical",
    confidence: 0.8,
    re: /(?:passport(?:no\.?|number|#)|护照(?:号|号码))[:：=#\-]*([A-Z0-9]{5,12})/i,
    test: (m) => capturedRange(m),
  },
  {
    id: "us_ssn",
    label: "US Social Security Number",
    severity: "critical",
    confidence: 0.95,
    re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/,
    test: (m) => (validUsSsn(m[0]) ? { start: m.index, end: m.index + m[0].length } : null),
  },
  {
    id: "iban",
    label: "IBAN",
    severity: "critical",
    confidence: 1,
    re: /[A-Z]{2}\d{2}[A-Z0-9]{11,30}/i,
    test: (m) => (validIban(m[0]) ? { start: m.index, end: m.index + m[0].length } : null),
  },
  {
    id: "chinese_uscc",
    label: "Chinese Unified Social Credit Code",
    severity: "critical",
    confidence: 1,
    re: /[159Y][1239][0-9A-HJ-NPQRTUWXY]{16}/i,
    test: (m) => (validChineseUscc(m[0]) ? { start: m.index, end: m.index + m[0].length } : null),
  },
  {
    id: "tax_id",
    label: "Tax Identification Number",
    severity: "high",
    confidence: 0.8,
    re: /(?:tax(?:payer)?(?:id|number|no\.?)|tin|ein|vat(?:id|number|no\.?)|税号|纳税人识别号)[:：=#\-]*([A-Z0-9\-]{8,20})/i,
    test: (m) => capturedRange(m),
  },
  {
    id: "bank_account",
    label: "Bank Account Number",
    severity: "critical",
    confidence: 0.8,
    re: /(?:bankaccount(?:number|no\.?)?|account(?:number|no\.?)|银行(?:账号|账户))[:：=#\-]*(\d{8,34})/i,
    test: (m) => capturedRange(m),
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
    label: "Named Secret / Password",
    severity: "medium",
    confidence: 0.5,
    re: /(?:api[_-]?key|apikey|(?<![A-Za-z_])token|secret|password|passwd|私钥|密钥|口令)\s*[=:：]\s*[A-Za-z0-9_\-]{12,}/i,
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

  // A private-key header is only a marker; the actual secret is the body on
  // following lines. Redact the full block, or everything after BEGIN if OCR
  // misses the closing marker.
  let insidePrivateKey = false;
  for (const line of lines) {
    const words = line.words || [{ text: line.text, bbox: line.bbox }];
    const compact = words.map((word) => word.text || "").join("").replace(/\s/g, "");
    if (PRIVATE_KEY_BEGIN.test(compact)) insidePrivateKey = true;
    if (insidePrivateKey) {
      const bbox = line.bbox || unionWords(words.map((word) => word.bbox));
      zones.push({ ...bbox, label: PRIVATE_KEY_LABEL, severity: "critical", confidence: 1, kind: "pii" });
    }
    if (insidePrivateKey && PRIVATE_KEY_END.test(compact)) insidePrivateKey = false;
  }

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
