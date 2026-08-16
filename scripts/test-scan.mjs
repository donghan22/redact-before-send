// Quick sanity test for the detection engine (run: node scripts/test-scan.mjs)
import { detectSensitiveZones } from "../src/shared/sensitive.js";

function line(text, words) {
  return { text, words: words ?? [{ text, bbox: { x: 10, y: 10, w: 600, h: 40 } }] };
}

const cases = [
  {
    name: "OpenAI key",
    want: true,
    line: line("sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", [
      { text: "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", bbox: { x: 10, y: 10, w: 400, h: 40 } },
    ]),
  },
  {
    name: "CN phone split across words",
    want: true,
    line: {
      text: "phone 1 3 8 0 0 1 2 3 4 5 6 ok",
      words: ["phone", "1", "3", "8", "0", "0", "1", "2", "3", "4", "5", "6", "ok"].map((t, i) => ({
        text: t,
        bbox: { x: 20 + i * 40, y: 60, w: 38, h: 30 },
      })),
    },
  },
  {
    name: "CN ID with valid checksum",
    want: true,
    line: line("ID 11010519491231002X", [
      { text: "ID", bbox: { x: 10, y: 100, w: 40, h: 30 } },
      { text: "11010519491231002X", bbox: { x: 60, y: 100, w: 200, h: 30 } },
    ]),
  },
  {
    name: "Email",
    want: true,
    line: line("beam@corp.com"),
  },
  {
    name: "Confidential keyword",
    want: true,
    line: line("Confidential - Q3 report", [
      { text: "Confidential", bbox: { x: 10, y: 180, w: 120, h: 28 } },
      { text: "-", bbox: { x: 130, y: 180, w: 20, h: 28 } },
      { text: "Q3", bbox: { x: 150, y: 180, w: 30, h: 28 } },
      { text: "report", bbox: { x: 185, y: 180, w: 60, h: 28 } },
    ]),
  },
  {
    name: "Date must NOT match",
    want: false,
    line: line("2026-08-12 14:30", [
      { text: "2026-08-12", bbox: { x: 10, y: 220, w: 110, h: 24 } },
      { text: "14:30", bbox: { x: 124, y: 220, w: 50, h: 24 } },
    ]),
  },
  {
    name: "Long random digits must NOT match phone",
    want: false,
    line: line("order 1234567890123456", [
      { text: "order", bbox: { x: 10, y: 260, w: 60, h: 24 } },
      { text: "1234567890123456", bbox: { x: 74, y: 260, w: 170, h: 24 } },
    ]),
  },
];

let pass = 0;
for (const c of cases) {
  const zones = detectSensitiveZones([c.line], { strictness: 2 });
  const got = zones.length > 0;
  const ok = got === c.want;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  → detected=${got} zones=${zones.length}`);
  for (const z of zones) console.log(`      ${z.severity} ${z.label}`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
