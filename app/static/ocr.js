// Turn OCR words into Tambola ticket grids, fully in the browser (no server, no AI service).
// Text recognition is done by Tesseract.js; this file holds the pure layout logic
// (testable in Node) plus a thin browser wrapper.
//
// Trick: a number's value fixes its column (47 -> 40s column), so only the row has to
// come from the photo. Words are grouped into text lines by vertical position, and
// lines are grouped into tickets of 3 by splitting at the largest vertical gaps.
(function (root) {
  "use strict";

  function colOf(n) {
    if (n <= 9) return 0;
    if (n >= 80) return 8;
    return Math.floor(n / 10);
  }

  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }

  // Rebuild numbers from single-digit symbols. Tesseract sometimes drops the space between
  // neighbouring cells ("45 61" -> "4561"); per-digit boxes let us split on the real gap.
  // symbols: [{ text, confidence, bbox }] -> words in the same shape buildTickets expects.
  function wordsFromSymbols(symbols) {
    const digits = symbols
      .filter((s) => /^\d$/.test(String(s.text || "").trim()))
      .map((s) => ({ d: s.text.trim(), c: s.confidence, b: s.bbox, h: s.bbox.y1 - s.bbox.y0 }));
    if (!digits.length) return [];
    const mh = median(digits.map((d) => d.h));
    digits.sort((a, b) => (Math.abs(a.b.y0 - b.b.y0) < mh * 0.5 ? a.b.x0 - b.b.x0 : a.b.y0 - b.b.y0));
    const words = [];
    let cur = null;
    for (const d of digits) {
      const sameLine = cur && Math.abs((d.b.y0 + d.b.y1) / 2 - (cur.bbox.y0 + cur.bbox.y1) / 2) < mh * 0.5;
      const close = cur && d.b.x0 - cur.bbox.x1 < mh * 0.45 && d.b.x0 >= cur.bbox.x0;
      if (sameLine && close && cur.text.length < 2) {
        cur.text += d.d;
        cur.confidence = Math.min(cur.confidence, d.c);
        cur.bbox = { x0: cur.bbox.x0, x1: Math.max(cur.bbox.x1, d.b.x1), y0: Math.min(cur.bbox.y0, d.b.y0), y1: Math.max(cur.bbox.y1, d.b.y1) };
      } else {
        cur = { text: d.d, confidence: d.c, bbox: Object.assign({}, d.b) };
        words.push(cur);
      }
    }
    return words;
  }

  // words: [{ text, confidence, bbox: { x0, y0, x1, y1 } }] from one photo.
  // Returns [3x9 grid] (0 = blank), top to bottom.
  function buildTickets(words) {
    let items = [];
    for (const w of words) {
      const t = String(w.text || "").trim();
      if (!/^\d{1,2}$/.test(t)) continue;
      const n = parseInt(t, 10);
      if (n < 1 || n > 90) continue;
      if (w.confidence != null && w.confidence < 30) continue;
      const b = w.bbox;
      items.push({ n, y: (b.y0 + b.y1) / 2, x: (b.x0 + b.x1) / 2, h: b.y1 - b.y0 });
    }
    if (!items.length) return [];

    // Drop specks and headings: keep words close to the typical digit height.
    const mh = median(items.map((i) => i.h));
    items = items.filter((i) => i.h > mh * 0.5 && i.h < mh * 1.8);

    // Group into lines by vertical centre.
    items.sort((a, b) => a.y - b.y);
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) < mh * 0.6) {
        last.items.push(it);
        last.y = last.items.reduce((s, i) => s + i.y, 0) / last.items.length;
      } else lines.push({ y: it.y, items: [it] });
    }
    // A real ticket row has several numbers; stray single hits are usually noise.
    const rows = lines.filter((l) => l.items.length >= 2);
    if (!rows.length) return [];

    // Split rows into tickets of ~3 at the largest gaps.
    const k = Math.max(1, Math.round(rows.length / 3));
    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push({ i, g: rows[i].y - rows[i - 1].y });
    const cuts = gaps.sort((a, b) => b.g - a.g).slice(0, k - 1).map((g) => g.i).sort((a, b) => a - b);
    const groups = [];
    let start = 0;
    for (const c of [...cuts, rows.length]) {
      groups.push(rows.slice(start, c));
      start = c;
    }

    return groups.map((g) => {
      const grid = [0, 1, 2].map(() => Array(9).fill(0));
      g.slice(0, 3).forEach((line, r) => {
        for (const it of line.items.sort((a, b) => a.x - b.x)) {
          const c = colOf(it.n);
          if (!grid[r][c]) grid[r][c] = it.n; // first reading wins; review screen flags gaps
        }
      });
      return grid;
    });
  }

  // ---- browser wrapper ----
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  let loading = null;
  function loadTesseract() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (!loading)
      loading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = TESSERACT_URL;
        s.onload = () => resolve(root.Tesseract);
        s.onerror = () => { loading = null; reject(new Error("Could not load the scanner. Check the internet connection.")); };
        document.head.appendChild(s);
      });
    return loading;
  }

  // Tesseract reads best when digits are mid-sized, so the photo is resized to a few
  // target widths (a ticket spans the photo's width) and the best reading wins.
  // Each photo is read in several variants (size x grid-line removal); the reading that
  // best fits the ticket rules wins, and a fully valid reading stops the search early.
  const VARIANTS = [
    [1000, false], [1000, true], [750, false], [750, true], [1400, false], [1400, true],
  ];

  // Grayscale + contrast stretch at a given width.
  function prepare(bmp, width, erase) {
    const scale = width / bmp.width;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = ((d[i] - lo) * 255) / span;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    if (erase) eraseGridLines(d, c.width, c.height);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Tesseract drops digits that touch ticket grid lines (single digits next to the left
  // border especially). Whiten long straight dark runs: a ticket cell is ~width/9 wide,
  // and digits are well under one cell long in either direction, so runs longer than
  // ~1.2 cells can only be lines. d is grayscale RGBA (value in the R channel).
  function eraseGridLines(d, w, h) {
    const minRun = Math.round((w / 9) * 1.2);
    const dark = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) dark[p] = d[p * 4] < 110 ? 1 : 0;
    const wipe = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x <= w; x++) {
        if (x < w && dark[y * w + x]) run++;
        else {
          if (run >= minRun) for (let k = x - run; k < x; k++) wipe[y * w + k] = 1;
          run = 0;
        }
      }
    }
    for (let x = 0; x < w; x++) {
      let run = 0;
      for (let y = 0; y <= h; y++) {
        if (y < h && dark[y * w + x]) run++;
        else {
          if (run >= minRun) for (let k = y - run; k < y; k++) wipe[k * w + x] = 1;
          run = 0;
        }
      }
    }
    // Wipe with a 1px margin so anti-aliased line edges don't survive as "1"-like slivers.
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (wipe[p] || wipe[p - 1] || wipe[p + 1] || wipe[p - w] || wipe[p + w])
          d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255;
      }
  }

  // Higher is better: numbers found, minus a penalty per broken ticket rule.
  function score(tickets) {
    const V = root.Tambola;
    let s = 0;
    for (const t of tickets) {
      s += t.flat().filter(Boolean).length;
      if (V) s -= 3 * V.validateTicket(t).errors.length;
    }
    return s;
  }
  function allValid(tickets) {
    const V = root.Tambola;
    return tickets.length > 0 && !!V && tickets.every((t) => V.validateTicket(t).errors.length === 0);
  }

  // files -> tickets (in photo order). onProgress(text) for status updates.
  async function scanFiles(files, onProgress) {
    onProgress("Loading the scanner (first time takes a few seconds)…");
    const T = await loadTesseract();
    const worker = await T.createWorker("eng");
    try {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789 ",
        tessedit_pageseg_mode: "11", // sparse text: numbers scattered in a grid
      });
      const tickets = [];
      for (let i = 0; i < files.length; i++) {
        onProgress(`Reading photo ${i + 1} of ${files.length}…`);
        const bmp = await createImageBitmap(files[i]);
        let best = [];
        for (const [w, erase] of VARIANTS) {
          const { data } = await worker.recognize(prepare(bmp, w, erase));
          const found = buildTickets(wordsFromSymbols(data.symbols || []));
          if (score(found) > score(best)) best = found;
          if (allValid(best)) break; // clean read, no need to try other sizes
        }
        tickets.push(...best);
      }
      return tickets;
    } finally {
      await worker.terminate();
    }
  }

  const api = { buildTickets, wordsFromSymbols, colOf, scanFiles };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TicketOCR = api;
})(typeof window !== "undefined" ? window : globalThis);
