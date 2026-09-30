// Run: node --test tests/ocr.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTickets, wordsFromSymbols } = require("../app/static/ocr.js");
const T = require("../app/static/prizes.js");

const A = [
  [4, 0, 23, 0, 45, 0, 61, 0, 82],
  [0, 12, 0, 37, 48, 0, 65, 74, 0],
  [9, 0, 28, 0, 0, 55, 0, 79, 90],
];
const B = [
  [0, 15, 0, 31, 0, 52, 0, 71, 85],
  [2, 0, 24, 0, 43, 0, 66, 0, 88],
  [7, 19, 0, 39, 0, 0, 68, 0, 89],
];

// Fake OCR words for tickets stacked vertically, with a bigger gap between tickets.
function wordsFor(tickets, { jitter = 0, extra = [] } = {}) {
  const words = [];
  let y = 100;
  for (const t of tickets) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 9; c++) {
        const v = t[r][c];
        if (!v) continue;
        const dy = jitter ? ((c * 7) % 5) - 2 : 0;
        words.push({ text: String(v), confidence: 90, bbox: { x0: 50 + c * 60, x1: 80 + c * 60, y0: y + dy, y1: y + dy + 30 } });
      }
      y += 55;
    }
    y += 90; // gap between tickets
  }
  return words.concat(extra);
}

test("one ticket read back exactly", () => {
  assert.deepEqual(buildTickets(wordsFor([A])), [A]);
});

test("two stacked tickets split at the gap, with row jitter", () => {
  const out = buildTickets(wordsFor([A, B], { jitter: true }));
  assert.deepEqual(out, [A, B]);
  out.forEach((t) => assert.deepEqual(T.validateTicket(t).errors, []));
});

test("noise is ignored: non-numbers, out-of-range, low confidence, odd sizes", () => {
  const extra = [
    { text: "TICKET", confidence: 95, bbox: { x0: 0, x1: 100, y0: 20, y1: 50 } },
    { text: "123", confidence: 95, bbox: { x0: 0, x1: 50, y0: 20, y1: 50 } },
    { text: "91", confidence: 95, bbox: { x0: 0, x1: 50, y0: 100, y1: 130 } },
    { text: "33", confidence: 10, bbox: { x0: 200, x1: 230, y0: 100, y1: 130 } },
    { text: "5", confidence: 90, bbox: { x0: 700, x1: 710, y0: 400, y1: 404 } },
  ];
  assert.deepEqual(buildTickets(wordsFor([A], { extra })), [A]);
});

test("a missed number leaves a blank that validation flags", () => {
  const words = wordsFor([A]).filter((w) => w.text !== "45");
  const [t] = buildTickets(words);
  assert.equal(t[0][4], 0);
  assert.ok(T.validateTicket(t).errors.some((e) => e.includes("top row has 4")));
});

test("nothing readable -> no tickets", () => {
  assert.deepEqual(buildTickets([]), []);
});

test("digits are regrouped by gap, even when OCR merged the words", () => {
  // From a real Tesseract run on "4   23   45   61   82" (bold 40px), per-digit x ranges:
  const xs = [[41, 61, "4"], [97, 116, "2"], [120, 138, "3"], [174, 195, "4"], [198, 217, "5"],
              [253, 272, "6"], [277, 289, "1"], [331, 349, "8"], [352, 372, "2"]];
  const syms = xs.map(([x0, x1, t]) => ({ text: t, confidence: 90, bbox: { x0, x1, y0: 70, y1: 100 } }));
  assert.deepEqual(wordsFromSymbols(syms).map((w) => w.text), ["4", "23", "45", "61", "82"]);
});
