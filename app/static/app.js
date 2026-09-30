(function () {
  "use strict";
  const T = window.Tambola;
  const $ = (id) => document.getElementById(id);
  const KEY = "tambola.v1";

  const blankTicket = () => [0, 1, 2].map(() => Array(9).fill(0));

  const defaults = () => ({
    screen: "setup",
    tickets: [],
    called: [],
    enabled: {},
    settings: Object.assign({ autoSubmit: true, phoneKeyboard: false }, T.DEFAULT_SETTINGS),
  });

  let state = load();
  let lastAlertKeys = new Set(alertKeys());
  let justCalled = null;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.tickets)) {
        const d = defaults();
        return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings) });
      }
    } catch (_) {}
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  function show(screen) {
    state.screen = screen;
    save();
    for (const id of ["setup", "review", "play"]) $(id).hidden = id !== screen;
    if (screen === "review") renderReview();
    if (screen === "play") { renderPlay(); focusNum(); }
  }

  // ---------- scanning (on-device, Tesseract.js) ----------
  async function scan(files, statusEl) {
    files = Array.from(files).slice(0, 6);
    if (!files.length) return;
    try {
      const found = await window.TicketOCR.scanFiles(files, (msg) => { statusEl.textContent = msg; });
      if (!found.length) throw new Error("No tickets found. Try a clearer, straight-on photo with good light.");
      state.tickets.push(...found);
      statusEl.textContent = `Found ${found.length} ticket(s). Check them against the paper.`;
      show("review");
    } catch (e) {
      statusEl.textContent = e.message || "Scan failed.";
    }
  }

  $("scanInput").addEventListener("change", (e) => { scan(e.target.files, $("scanStatus")); e.target.value = ""; });
  $("scanMore").addEventListener("change", (e) => { scan(e.target.files, $("reviewStatus")); e.target.value = ""; });
  document.querySelectorAll("[data-blank]").forEach((b) =>
    b.addEventListener("click", () => {
      const n = Number(b.dataset.blank);
      for (let i = 0; i < n; i++) state.tickets.push(blankTicket());
      show("review");
    })
  );

  // ---------- review ----------
  function renderReview() {
    const list = $("reviewList");
    list.innerHTML = "";
    state.tickets.forEach((t, i) => {
      const v = T.validateTicket(t);
      const card = document.createElement("div");
      card.className = "review-card" + (v.errors.length ? " has-err" : "");
      const head = document.createElement("div");
      head.className = "review-card-head";
      head.innerHTML = `<span class="badge">T${i + 1}</span><span>Ticket ${i + 1}</span>`;
      const del = document.createElement("button");
      del.className = "btn small link";
      del.textContent = "Remove";
      del.onclick = () => {
        if (confirm(`Remove Ticket ${i + 1}? Later tickets will be renumbered.`)) {
          state.tickets.splice(i, 1);
          save();
          renderReview();
        }
      };
      head.appendChild(del);
      card.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "edit-grid";
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 9; c++) {
          const inp = document.createElement("input");
          inp.inputMode = "numeric";
          inp.maxLength = 2;
          inp.value = t[r][c] || "";
          if (v.bad.has(`${r},${c}`)) inp.classList.add("bad");
          inp.addEventListener("change", () => {
            const n = parseInt(inp.value, 10);
            t[r][c] = n >= 1 && n <= 90 ? n : 0;
            save();
            renderReview();
          });
          grid.appendChild(inp);
        }
      card.appendChild(grid);
      if (v.errors.length) {
        const ul = document.createElement("ul");
        ul.className = "errs";
        for (const e of [...new Set(v.errors)]) {
          const li = document.createElement("li");
          li.textContent = e;
          ul.appendChild(li);
        }
        card.appendChild(ul);
      }
      list.appendChild(card);
    });
    $("startGame").disabled = !state.tickets.length;
  }

  $("addBlank").onclick = () => { state.tickets.push(blankTicket()); save(); renderReview(); };
  $("startGame").onclick = () => {
    const bad = state.tickets.map((t, i) => (T.validateTicket(t).errors.length ? `T${i + 1}` : null)).filter(Boolean);
    if (bad.length && !confirm(`${bad.join(", ")} still have problems. Start anyway?`)) return;
    lastAlertKeys = new Set(alertKeys());
    show("play");
  };

  // ---------- play ----------
  const numEl = $("num");

  function focusNum() {
    numEl.inputMode = state.settings.phoneKeyboard ? "numeric" : "none";
    numEl.focus({ preventScroll: true });
  }

  function currentAlerts() {
    return T.alerts(state.tickets, state.called, state.enabled, state.settings);
  }
  function alertKeys() {
    return currentAlerts().map((a) => `${a.prize}|${a.ticket}|${a.needs}`);
  }

  function setWhere(text, cls) {
    const w = $("where");
    w.textContent = text;
    w.className = "where" + (cls ? " " + cls : "");
  }

  function submit() {
    const raw = numEl.value.trim();
    numEl.value = "";
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (!(n >= 1 && n <= 90)) return setWhere(`${raw} is not a Tambola number (1–90)`, "warn");
    if (state.called.includes(n)) return setWhere(`${n} was already called`, "warn");
    state.called.push(n);
    justCalled = n;
    save();
    const hits = T.whereIs(state.tickets, n);
    if (hits.length)
      setWhere(`${n} → ` + hits.map((h) => `T${h.ticket + 1} (${T.ROW_NAMES[h.row]})`).join(", "), "hit");
    else setWhere(`${n} – not on your tickets`, "miss");
    renderPlay();
  }

  numEl.addEventListener("input", () => {
    numEl.value = numEl.value.replace(/\D/g, "").slice(0, 2);
    if (state.settings.autoSubmit && numEl.value.length === 2) submit();
  });
  numEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });

  $("keypad").addEventListener("pointerdown", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault(); // keep focus in the number box
    const k = b.dataset.k;
    if (k === "enter") submit();
    else if (k === "back") numEl.value = numEl.value.slice(0, -1);
    else if (numEl.value.length < 2) {
      numEl.value += k;
      numEl.dispatchEvent(new Event("input"));
    }
    numEl.focus({ preventScroll: true });
  });

  $("undo").onclick = () => {
    const n = state.called.pop();
    if (n == null) return;
    justCalled = null;
    save();
    setWhere(`Undid ${n}`, "warn");
    renderPlay();
    focusNum();
  };

  function renderPlay() {
    const alerts = currentAlerts();

    // Vibrate once when a new "1 to go" appears.
    const keys = new Set(alerts.map((a) => `${a.prize}|${a.ticket}|${a.needs}`));
    const fresh = [...keys].some((k) => !lastAlertKeys.has(k));
    lastAlertKeys = keys;
    if (fresh && navigator.vibrate) navigator.vibrate(150);

    // Alert strip, grouped by prize.
    const strip = $("alertStrip");
    strip.innerHTML = "";
    const byPrize = new Map();
    for (const a of alerts) {
      if (!byPrize.has(a.label)) byPrize.set(a.label, []);
      byPrize.get(a.label).push(a);
    }
    for (const [label, list] of byPrize) {
      const div = document.createElement("div");
      div.className = "alert";
      const parts = list.map((a) => `T${a.ticket + 1} ${a.needs == null ? "(any 1 more)" : `(needs ${a.needs})`}`);
      div.innerHTML = `<b>${label}</b> – 1 to go: ${parts.join(", ")}`;
      strip.appendChild(div);
    }
    strip.hidden = !alerts.length;

    // Count + recent.
    $("calledCount").textContent = `${state.called.length} called`;
    $("recent").innerHTML = state.called.slice(-5).reverse()
      .map((n, i) => `<span class="${i === 0 ? "latest" : ""}">${n}</span>`).join("");

    // Prize chips.
    const chips = $("prizeChips");
    chips.innerHTML = "";
    for (const p of T.PRIZES) {
      const b = document.createElement("button");
      const on = state.enabled[p.id] !== false;
      const count = alerts.filter((a) => a.prize === p.id).length;
      const label = p.id === "early" ? `Early ${state.settings.earlyCount}` : p.label;
      b.className = "chip" + (on ? "" : " off") + (count ? " hot" : "");
      b.innerHTML = `${label}${count ? ` <em>${count}×1 to go</em>` : ""}`;
      b.title = on ? "Tap to disable (already claimed)" : "Tap to enable";
      b.onclick = () => { state.enabled[p.id] = !on; save(); renderPlay(); focusNum(); };
      chips.appendChild(b);
    }

    // Tickets.
    const calledSet = new Set(state.called);
    const box = $("tickets");
    const n = state.tickets.length;
    const cols = n <= 3 ? 1 : n <= 8 ? 2 : 3;
    box.style.setProperty("--cols", cols);
    box.style.setProperty("--rows", Math.ceil(n / cols));
    box.classList.toggle("has-contender", alerts.length > 0);
    box.innerHTML = "";
    state.tickets.forEach((t, i) => {
      const mine = alerts.filter((a) => a.ticket === i);
      const needs = new Set(mine.map((a) => a.needs).filter((x) => x != null));
      const el = document.createElement("div");
      el.className = "ticket" + (mine.length ? " contender" : "");
      const labels = [...new Set(mine.map((a) => a.label))].join(" · ");
      const marked = T.numbers(t).filter((v) => calledSet.has(v)).length;
      el.innerHTML = `<div class="t-head"><span class="badge">T${i + 1}</span>` +
        `<span class="t-tags">${labels ? labels + " – 1 to go" : ""}</span><span class="t-count">${marked}/15</span></div>`;
      const g = document.createElement("div");
      g.className = "t-grid";
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 9; c++) {
          const v = t[r][c];
          const cell = document.createElement("div");
          let cls = "cell";
          if (!v) cls += " blank";
          else if (calledSet.has(v)) cls += v === justCalled ? " marked just" : " marked";
          else if (needs.has(v)) cls += " need";
          cell.className = cls;
          cell.textContent = v || "";
          g.appendChild(cell);
        }
      el.appendChild(g);
      box.appendChild(el);
    });
  }

  // ---------- menu ----------
  const menu = $("menu");
  $("menuBtn").onclick = () => {
    $("setEarly").value = state.settings.earlyCount;
    $("setEarlyGate").value = state.settings.earlyGate;
    $("setFhGate").value = state.settings.fullHouseGate;
    $("setAuto").checked = state.settings.autoSubmit;
    $("setKbd").checked = state.settings.phoneKeyboard;
    menu.showModal();
  };
  menu.addEventListener("close", () => {
    const s = state.settings;
    s.earlyCount = Number($("setEarly").value);
    s.earlyGate = clampInt($("setEarlyGate").value, s.earlyGate);
    s.fullHouseGate = clampInt($("setFhGate").value, s.fullHouseGate);
    s.autoSubmit = $("setAuto").checked;
    s.phoneKeyboard = $("setKbd").checked;
    save();
    if (state.screen === "play") { renderPlay(); focusNum(); }
  });
  function clampInt(v, fallback) {
    const n = parseInt(v, 10);
    return n >= 0 && n <= 90 ? n : fallback;
  }
  $("editTickets").onclick = () => { menu.close(); show("review"); };
  $("logoutBtn").onclick = () => {
    const f = document.createElement("form");
    f.method = "post";
    f.action = "/logout";
    document.body.appendChild(f);
    f.submit();
  };
  $("resetBtn").onclick = () => { menu.close(); $("confirmReset").showModal(); };
  $("confirmReset").addEventListener("close", () => {
    if ($("confirmReset").returnValue !== "reset") return;
    state = defaults();
    lastAlertKeys = new Set();
    justCalled = null;
    save();
    setWhere("Type the called number");
    show("setup");
  });

  // Tapping empty space on the play screen returns focus to the number box.
  $("play").addEventListener("click", (e) => {
    if (!e.target.closest("button, input, select, dialog")) focusNum();
  });

  show(state.tickets.length ? state.screen : "setup");
})();
