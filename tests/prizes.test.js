// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../app/static/prizes.js");

// Valid ticket: 5 per row, columns in range and ascending.
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

const find = (list, prize, ticket) => list.filter((a) => a.prize === prize && a.ticket === ticket);

test("valid tickets pass validation", () => {
  assert.deepEqual(T.validateTicket(A).errors, []);
  assert.deepEqual(T.validateTicket(B).errors, []);
});

test("validation flags wrong column, row count, duplicate, order", () => {
  const bad = A.map((r) => r.slice());
  bad[0][0] = 14; // column 1 holds 1-9
  let v = T.validateTicket(bad);
  assert.ok(v.bad.has("0,0"));
  const short = A.map((r) => r.slice());
  short[1][1] = 0;
  v = T.validateTicket(short);
  assert.ok(v.errors.some((e) => e.includes("middle row has 4")));
  const dup = A.map((r) => r.slice());
  dup[2][4] = 45; // also in top row, same column
  v = T.validateTicket(dup);
  assert.ok(v.errors.some((e) => e.includes("45 appears twice")));
  const order = A.map((r) => r.slice());
  order[0][2] = 29; // above 28 in same column
  v = T.validateTicket(order);
  assert.ok(v.errors.some((e) => e.includes("increasing order")));
});

test("whereIs names ticket and row", () => {
  assert.deepEqual(T.whereIs([A, B], 45), [{ ticket: 0, row: 0, col: 4 }]);
  assert.deepEqual(T.whereIs([A, B], 1), []);
});

test("line 1 to go names the missing number, clears on completion", () => {
  let a = T.alerts([A, B], [4, 23, 45, 61], {}, {});
  assert.deepEqual(find(a, "top", 0), [{ prize: "top", label: "Top Line", ticket: 0, needs: 82 }]);
  a = T.alerts([A, B], [4, 23, 45, 61, 82], {}, {});
  assert.equal(find(a, "top", 0).length, 0);
});

test("four corners 1 to go", () => {
  const a = T.alerts([A], [4, 82, 9], {}, {});
  assert.deepEqual(find(a, "corners", 0)[0].needs, 90);
});

test("several tickets 1 away at once", () => {
  // A top needs 82; B bottom needs 89
  const a = T.alerts([A, B], [4, 23, 45, 61, 7, 19, 39, 68], {}, {});
  assert.equal(find(a, "top", 0)[0].needs, 82);
  assert.equal(find(a, "bottom", 1)[0].needs, 89);
});

test("disabled prize produces no alert", () => {
  const a = T.alerts([A], [4, 23, 45, 61], { top: false }, {});
  assert.equal(find(a, "top", 0).length, 0);
});

test("undo (removing a called number) brings the alert back", () => {
  const called = [4, 23, 45, 61, 82];
  assert.equal(find(T.alerts([A], called, {}, {}), "top", 0).length, 0);
  called.pop();
  assert.equal(find(T.alerts([A], called, {}, {}), "top", 0).length, 1);
});

test("early 7 gated until 7 numbers called", () => {
  // 6 of A's numbers called, nothing else: gate (7) not reached
  const six = [4, 23, 45, 61, 82, 12];
  assert.equal(find(T.alerts([A], six, {}, {}), "early", 0).length, 0);
  // one non-matching number called -> 7 called, still 6 marked -> alert
  const a = find(T.alerts([A], [...six, 1], {}, {}), "early", 0);
  assert.deepEqual(a, [{ prize: "early", label: "Early 7", ticket: 0, needs: null }]);
  // 7th marked -> alert clears
  assert.equal(find(T.alerts([A], [...six, 1, 37], {}, {}), "early", 0).length, 0);
});

test("early count setting (Early 5)", () => {
  const a = T.alerts([A], [4, 23, 45, 61, 1, 3, 5], {}, { earlyCount: 5 });
  assert.equal(find(a, "early", 0)[0].label, "Early 5");
});

test("full house gated until 15 called, uses first enabled full house", () => {
  const all = T.numbers(A);
  const fourteen = all.slice(0, 14); // 14 called, 1 to go, but gate is 15
  assert.equal(T.alerts([A], fourteen, {}, {}).filter((x) => x.prize.startsWith("fh")).length, 0);
  let a = T.alerts([A], [...fourteen, 1], {}, {});
  assert.deepEqual(find(a, "fh1", 0)[0].needs, all[14]);
  a = T.alerts([A], [...fourteen, 1], { fh1: false }, {});
  assert.equal(find(a, "fh2", 0)[0].label, "Full House 2");
  a = T.alerts([A], [...fourteen, 1], { fh1: false, fh2: false, fh3: false }, {});
  assert.equal(a.filter((x) => x.prize.startsWith("fh")).length, 0);
});

test("simulated game: every alert's missing number is really missing and on that ticket", () => {
  const tickets = [A, B];
  const order = Array.from({ length: 90 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
  const called = [];
  for (const n of order) {
    called.push(n);
    for (const al of T.alerts(tickets, called, {}, {})) {
      if (al.needs == null) continue;
      assert.ok(!called.includes(al.needs));
      assert.ok(T.numbers(tickets[al.ticket]).includes(al.needs));
    }
  }
  assert.equal(T.alerts(tickets, called, {}, {}).length, 0);
});
