// Pure Tambola logic: ticket validation, number lookup and "1 to go" alerts.
// A ticket is a 3x9 array of numbers, 0 = blank cell. Works in the browser
// (window.Tambola) and in Node (module.exports) for tests.
(function (root) {
  "use strict";

  const PRIZES = [
    { id: "early", label: "Early 7" },
    { id: "corners", label: "Four Corners" },
    { id: "top", label: "Top Line" },
    { id: "middle", label: "Middle Line" },
    { id: "bottom", label: "Bottom Line" },
    { id: "fh1", label: "Full House 1" },
    { id: "fh2", label: "Full House 2" },
    { id: "fh3", label: "Full House 3" },
  ];
  const FULL_HOUSES = ["fh1", "fh2", "fh3"];
  const ROW_NAMES = ["top row", "middle row", "bottom row"];

  const DEFAULT_SETTINGS = {
    earlyCount: 7, // Early 7 (set 5 for "Early 5")
    earlyGate: 7, // no Early alerts until this many numbers are called
    fullHouseGate: 15, // no Full House alerts until this many numbers are called
  };

  function colRange(c) {
    if (c === 0) return [1, 9];
    if (c === 8) return [80, 90];
    return [c * 10, c * 10 + 9];
  }

  function numbers(ticket) {
    const out = [];
    for (const row of ticket) for (const v of row) if (v) out.push(v);
    return out;
  }

  // Returns { errors: [text], bad: Set of "r,c" } for one ticket.
  function validateTicket(ticket) {
    const errors = [];
    const bad = new Set();
    const seen = new Map();
    for (let r = 0; r < 3; r++) {
      let count = 0;
      for (let c = 0; c < 9; c++) {
        const v = ticket[r][c];
        if (!v) continue;
        count++;
        const [lo, hi] = colRange(c);
        if (!Number.isInteger(v) || v < lo || v > hi) {
          errors.push(`${v} is in the wrong column (column ${c + 1} holds ${lo}–${hi})`);
          bad.add(`${r},${c}`);
        }
        if (seen.has(v)) {
          errors.push(`${v} appears twice`);
          bad.add(`${r},${c}`);
          bad.add(seen.get(v));
        } else seen.set(v, `${r},${c}`);
      }
      if (count !== 5) {
        errors.push(`${ROW_NAMES[r]} has ${count} numbers (should be 5)`);
        for (let c = 0; c < 9; c++) if (ticket[r][c]) bad.add(`${r},${c}`);
      }
    }
    for (let c = 0; c < 9; c++) {
      let prev = 0;
      for (let r = 0; r < 3; r++) {
        const v = ticket[r][c];
        if (!v) continue;
        if (v < prev) {
          errors.push(`column ${c + 1} is not in increasing order`);
          bad.add(`${r},${c}`);
        }
        prev = v;
      }
    }
    return { errors, bad };
  }

  // Where does n appear? -> [{ ticket: index, row: 0..2, col }]
  function whereIs(tickets, n) {
    const hits = [];
    tickets.forEach((t, i) => {
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 9; c++) if (t[r][c] === n) hits.push({ ticket: i, row: r, col: c });
    });
    return hits;
  }

  function rowNumbers(ticket, r) {
    return ticket[r].filter(Boolean);
  }

  function cornerNumbers(ticket) {
    const top = rowNumbers(ticket, 0);
    const bottom = rowNumbers(ticket, 2);
    return [top[0], top[top.length - 1], bottom[0], bottom[bottom.length - 1]].filter(Boolean);
  }

  // Target numbers per pattern prize (every one must be called).
  function targets(ticket, prizeId) {
    switch (prizeId) {
      case "corners":
        return cornerNumbers(ticket);
      case "top":
        return rowNumbers(ticket, 0);
      case "middle":
        return rowNumbers(ticket, 1);
      case "bottom":
        return rowNumbers(ticket, 2);
      case "full":
        return numbers(ticket);
    }
    return [];
  }

  // Compute "1 to go" alerts.
  //   tickets: [3x9], called: array of called numbers,
  //   enabled: { prizeId: bool } (missing = enabled), settings: see DEFAULT_SETTINGS.
  // Returns [{ prize, label, ticket, needs }]  (needs = number, or null for Early).
  function alerts(tickets, called, enabled, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const on = (id) => !enabled || enabled[id] !== false;
    const calledSet = new Set(called);
    const n = calledSet.size;
    const out = [];

    tickets.forEach((t, i) => {
      if (on("early") && n >= s.earlyGate) {
        const marked = numbers(t).filter((v) => calledSet.has(v)).length;
        if (marked === s.earlyCount - 1)
          out.push({ prize: "early", label: `Early ${s.earlyCount}`, ticket: i, needs: null });
      }
      for (const id of ["corners", "top", "middle", "bottom"]) {
        if (!on(id)) continue;
        const missing = targets(t, id).filter((v) => !calledSet.has(v));
        if (missing.length === 1)
          out.push({ prize: id, label: labelOf(id), ticket: i, needs: missing[0] });
      }
      const fh = FULL_HOUSES.find(on);
      if (fh && n >= s.fullHouseGate) {
        const missing = targets(t, "full").filter((v) => !calledSet.has(v));
        if (missing.length === 1)
          out.push({ prize: fh, label: labelOf(fh), ticket: i, needs: missing[0] });
      }
    });
    return out;
  }

  function labelOf(id) {
    const p = PRIZES.find((x) => x.id === id);
    return p ? p.label : id;
  }

  const api = { PRIZES, DEFAULT_SETTINGS, colRange, numbers, validateTicket, whereIs, targets, alerts, labelOf, ROW_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Tambola = api;
})(typeof window !== "undefined" ? window : globalThis);
