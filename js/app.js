/* The screens: drop files -> Gemini reads -> check and fix -> make the sheet. */
(function (EO) {
  "use strict";
  const { $, el, str, int } = EO;

  let order = null;        // the order on screen
  let files = [];          // files waiting on the intake screen
  let abortCtl = null;     // stops a running read
  let lastPdf = null;      // the sheet on screen, as a PDF blob
  let busy = false;

  const persist = EO.debounce(() => { if (order) EO.saveOrder(order); }, 500);
  function touched() {
    if (!order) return;
    order.updatedAt = Date.now();
    if (order.issuedAt) order.changedSinceIssue = true;
    persist();
    refreshSums();
    refreshChecksSoon();
  }

  /* ======================= navigation ======================= */
  const VIEWS = ["home", "review", "sheet", "orders"];
  function show(name) {
    VIEWS.forEach(v => { $("#view-" + v).hidden = v !== name; });
    $("#actionbar").hidden = name !== "review";
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }
  async function goHome() {
    persist.flush();
    show("home");
    renderSetup();
    renderUsage();
    await renderRecent();
  }
  // Google's free allowance is per key per day; everyone sharing the key shares it.
  function renderUsage() {
    const u = EO.usageToday();
    $("#usageLine").textContent = u.reads
      ? "Today on this computer: " + u.reads + (u.reads === 1 ? " order" : " orders") + " read, " + u.tokens.toLocaleString() + " tokens. The free daily limit is shared by everyone using the same key."
      : "";
  }

  function icon(name) {
    const paths = {
      up: "M8 3l5 6H3z", down: "M8 13L3 7h10z", copy: "M5 2h8v9H5zM3 5v9h8",
      x: "M4 4l8 8M12 4l-8 8", plus: "M8 3v10M3 8h10",
      cal: "M3 4h10v9H3zM3 7h10M6 2v3M10 2v3"
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", paths[name]);
    p.setAttribute("fill", name === "up" || name === "down" ? "currentColor" : "none");
    p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.6"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
    return svg;
  }
  const iconBtn = (name, label, onclick, extra) => el("button", { type: "button", class: "iconbtn" + (extra ? " " + extra : ""), "aria-label": label, title: label, onclick }, icon(name));

  /* ======================= setup ======================= */
  function renderWho() {
    const s = EO.settings();
    $("#who").textContent = s.name ? s.name + (s.initials ? " · " + EO.cleanInitials(s.initials) : "") : "";
  }
  function renderSetup() {
    const s = EO.settings();
    const need = !EO.isSetUp();
    $("#setupPanel").hidden = !need;
    if (!need) return;
    if (!$("#suName").value) $("#suName").value = s.name;
    if (!$("#suIni").value) $("#suIni").value = s.initials;
    const prot = EO.vault.isProtected();
    const hasCompany = prot && !!EO.vault.secrets().companyKey;
    $("#suChoice").hidden = !hasCompany;
    $("#suOwnWrap").hidden = !s.allowOwnKey;
    if (!s.allowOwnKey) $("#suCompany").checked = true;
    const own = !hasCompany || $("#suOwn").checked;
    $("#suKey").hidden = !own;
    if (!prot && !$("#suKey").value) $("#suKey").value = s.apiKey;
    $("#suKeyHelp").textContent = hasCompany
      ? (own ? "Your own free key from aistudio.google.com/apikey. Orders you read then use your own daily allowance." : "The company key came with your link: nothing to paste.")
      : (s.apiKey ? "Key already added from the setup link." : "Paste a free key from aistudio.google.com/apikey.");
    $("#suIniPrev").textContent = EO.cleanInitials($("#suIni").value) || "AA";
  }
  ["#suCompany", "#suOwn"].forEach(id => $(id).addEventListener("change", renderSetup));
  $("#suIni").addEventListener("input", () => { $("#suIniPrev").textContent = EO.cleanInitials($("#suIni").value) || "AA"; });
  $("#suSave").addEventListener("click", async () => {
    const name = str($("#suName").value), ini = EO.cleanInitials($("#suIni").value), key = str($("#suKey").value);
    const prot = EO.vault.isProtected(), sec = EO.vault.secrets();
    const useOwn = !prot || !sec.companyKey || $("#suOwn").checked;
    if (!name || !ini) { $("#suMsg").textContent = "Type your name and initials."; return; }
    if (useOwn && !key && !(prot && sec.ownKey)) { $("#suMsg").textContent = "Paste your Gemini key (or open the worker link you were sent)."; return; }
    if (prot) {
      await EO.vault.setSecrets({ useOwn, ownKey: useOwn && key ? key : sec.ownKey });
      EO.saveSettings({ name, initials: ini });
    } else EO.saveSettings({ name, initials: ini, apiKey: key });
    $("#suMsg").textContent = "Checking the key…";
    try { const m = await EO.testKey(EO.settings().apiKey); EO.toast("All set. Gemini (" + m + ") is ready."); }
    catch (e) { EO.toast("Saved, but the key test failed: " + EO.geminiFriendly(e), "bad"); }
    $("#suMsg").textContent = "";
    renderWho();
    renderSetup();
  });

  /* ---------- lock screen and password prompts ---------- */
  // Shows the full-screen lock until check(password) returns true; any string it returns is shown as the error.
  function showLock(title, msg, check) {
    return new Promise(resolve => {
      document.body.classList.add("locked");
      $("#lock").hidden = false;
      $("#lockTitle").textContent = title;
      $("#lockMsg").textContent = msg;
      $("#lockErr").textContent = "";
      $("#lockPw").value = "";
      setTimeout(() => $("#lockPw").focus(), 50);
      $("#lockForm").onsubmit = async e => {
        e.preventDefault();
        const pw = $("#lockPw").value;
        if (!pw) return;
        $("#lockGo").disabled = true;
        $("#lockErr").textContent = "Checking…";
        let res;
        try { res = await check(pw); } catch (err) { res = err && err.message ? err.message : "Something went wrong."; }
        if (res === true) {
          $("#lock").hidden = true;
          document.body.classList.remove("locked");
          $("#lockGo").disabled = false;
          resolve();
          return;
        }
        $("#lockErr").textContent = res || "That password isn't right.";
        $("#lockPw").select();
        setTimeout(() => { $("#lockGo").disabled = false; }, 900); // slows down guessing
      };
    });
  }
  function askPassword(title, msg) {
    return new Promise(resolve => {
      const d = $("#pwDialog");
      $("#pwTitle").textContent = title;
      $("#pwMsg").textContent = msg;
      $("#pwInput").value = "";
      d.onclose = () => resolve(d.returnValue === "ok" ? $("#pwInput").value : null);
      d.returnValue = "";
      d.showModal();
      $("#pwInput").focus();
    });
  }
  $("#pwInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#pwDialog").close("ok"); } });

  // A worker opened the link: unlock its settings with the company password and set this computer up.
  async function joinFlow(packed) {
    await showLock("Welcome to the Ennoble Order Sheet", "Type the company password your manager gave you. You only do this once on this computer.", async pw => {
      const cfg = await EO.vault.readJoin(packed, pw);
      if (!cfg) return "That password doesn't open this link.";
      const before = EO.settings();
      if (EO.vault.isProtected()) {
        if (!(await EO.vault.unlock(pw))) {
          const old = await askPassword("Old company password", "This computer was set up with a different company password. Type the old one to keep its saved orders, or press Cancel to continue without them.");
          if (old && await EO.vault.unlock(old)) await EO.vault.changePassword(pw);
          else {
            EO.vault.destroy();
            await EO.vault.create(pw, {});
            for (const r of await EO.rawOrders()) if (r.enc) await EO.deleteOrder(r.id); // unreadable without the old password
          }
        }
      } else {
        await EO.vault.create(pw, { ownKey: before.apiKey || "" });
      }
      const sec = EO.vault.secrets();
      await EO.vault.setSecrets({ companyKey: cfg.key || "", useOwn: cfg.key ? (cfg.own !== false && sec.useOwn && !!sec.ownKey) : true });
      EO.saveSettings({
        companyName: cfg.co || before.companyName,
        companyTagline: cfg.tg != null ? cfg.tg : before.companyTagline,
        admin: cfg.admin || null,
        allowOwnKey: cfg.own !== false
      });
      await EO.encryptOrders();
      EO.toast("You're in. Type your name and initials to finish.");
      return true;
    });
  }
  function unlockFlow() {
    return showLock("Enter the company password", "This tool is locked. Ask your manager for the password.",
      async pw => ((await EO.vault.unlock(pw)) ? true : "That password isn't right."));
  }
  function renderNav() { $("#navLock").hidden = !EO.vault.isProtected(); }
  $("#navLock").addEventListener("click", async () => {
    if (order) await EO.saveOrder(order);
    EO.vault.lock();
    location.reload();
  });

  // A colleague opened the setup link: take the key out of the address and keep it in this browser.
  function readSetupLink() {
    const m = /[#&]setup=([A-Za-z0-9_-]+)/.exec(location.hash || "");
    if (!m) return false;
    try {
      const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const data = JSON.parse(decodeURIComponent(escape(atob(b64))));
      const patch = {};
      if (data.k) patch.apiKey = String(data.k);
      if (data.co) patch.companyName = String(data.co);
      if (data.tg) patch.companyTagline = String(data.tg);
      EO.saveSettings(patch);
      EO.toast("Gemini key added. Now type your name and initials.");
    } catch (e) {
      EO.toast("That setup link is damaged. Ask for a new one.", "bad");
    }
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  function setupLink() {
    const s = EO.settings();
    const json = JSON.stringify({ k: s.apiKey, co: s.companyName, tg: s.companyTagline });
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return location.origin + location.pathname + "#setup=" + b64;
  }

  /* ======================= intake ======================= */
  function renderChips() {
    const host = $("#chips");
    host.replaceChildren(...files.map((f, i) => el("span", { class: "chip" },
      el("span", { text: f.name + (f.size ? "  (" + Math.max(1, Math.round(f.size / 1024)) + " KB)" : "") }),
      el("button", { type: "button", "aria-label": "Remove " + f.name, text: "✕", onclick: () => { files.splice(i, 1); renderChips(); } })
    )));
  }
  function addFiles(list) {
    for (const f of Array.from(list || [])) {
      if (!files.some(x => x.name === f.name && x.size === f.size)) files.push(f);
    }
    renderChips();
    $("#intakeNote").replaceChildren();
  }
  $("#drop").addEventListener("click", () => $("#fileIn").click());
  $("#fileIn").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  ["dragenter", "dragover"].forEach(t => $("#drop").addEventListener(t, e => { e.preventDefault(); $("#drop").classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => $("#drop").addEventListener(t, () => $("#drop").classList.remove("over")));
  // Files dropped anywhere on the home screen count; elsewhere the browser must not navigate away.
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => {
    e.preventDefault();
    if (document.body.dataset.view === "home" && e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  // Ctrl+V a screenshot (WhatsApp, email) straight onto the page.
  document.addEventListener("paste", e => {
    if (document.body.dataset.view !== "home") return;
    const fl = e.clipboardData && e.clipboardData.files;
    if (fl && fl.length) {
      e.preventDefault();
      const named = Array.from(fl).map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : "pasted-picture-" + (files.length + i + 1) + ".png", { type: f.type }));
      addFiles(named);
      EO.toast("Picture added.");
    }
  });

  function setBusy(on, msg) {
    busy = on;
    $("#progress").hidden = !on;
    $("#btnRead").disabled = on;
    $("#btnBlank").disabled = on;
    if (msg) $("#progressMsg").textContent = msg;
  }
  $("#btnStop").addEventListener("click", () => { if (abortCtl) abortCtl.abort(); });

  function intakeNote(kind, text, extra) {
    const n = el("div", { class: "note " + kind }, el("div", { text }));
    if (extra) n.append(extra);
    $("#intakeNote").replaceChildren(n);
  }

  async function readOrder() {
    if (busy) return;
    const s = EO.settings();
    if (!s.apiKey) { EO.toast("Add the Gemini key first (Settings).", "bad"); openSettings(); return; }
    const text = $("#paste").value;
    if (!files.length && !text.trim()) { EO.toast("Drop the customer's file or paste the order text first."); return; }
    $("#intakeNote").replaceChildren();
    setBusy(true, "Opening the files…");
    abortCtl = new AbortController();
    let input = null;
    try {
      input = await EO.readInputs(files, text, m => { $("#progressMsg").textContent = m; });
      if (!input.hasContent) throw new Error("Nothing readable was found in " + (files.length === 1 ? "that file" : "those files") + ".");
      const res = await EO.extractOrder(input, m => { $("#progressMsg").textContent = m; }, abortCtl.signal);
      $("#progressMsg").textContent = "Building the sheet…";
      const o = EO.orderFromAI(res.data, input.pictures, input.sources, input.sourceText);
      if (input.artworkFiles.length) {
        const missing = input.artworkFiles.filter(n => o.artwork.files.indexOf(n) === -1);
        if (missing.length) o.artwork.files = [o.artwork.files, missing.join(", ")].filter(Boolean).join("; ");
      }
      // Gemini sometimes turns a player table into size counts only: rebuild the list from the table.
      if (!o.items.some(it => it.roster.length)) {
        const found = EO.findPlayerTable(input.sourceText);
        if (found && o.items.length === 1) {
          const it = o.items[0];
          it.roster = found.players;
          it.rosterCols = found.cols;
          if (!EO.gridTotal(it)) EO.gridFromRoster(it);
          o.checks.unshift({ id: EO.uid(), text: "The player list was filled in from the customer's table (" + found.players.length + " rows): check names, numbers and sizes.", resolved: false });
        } else if (found) {
          o.checks.unshift({ id: EO.uid(), text: "The order has a player table (" + found.players.length + " rows) but no player list was read: add it under Players on the right item.", resolved: false });
        }
      }
      if (res.truncated) o.checks.unshift({ id: EO.uid(), text: "Gemini's answer was cut short: compare the last items with the customer's order.", resolved: false });
      if (!o.items.length) o.items.push(EO.blankItem());
      o.readBy = res.model;
      o.aiUsage = res.usage;
      o.warnings = input.warnings;
      order = o;
      await EO.saveOrder(order);
      files = []; $("#paste").value = ""; renderChips();
      openReview();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const manual = el("div", { class: "btnrow", style: "margin-top:8px" },
        el("button", { type: "button", class: "btn small", text: "Try again", onclick: readOrder }),
        el("button", { type: "button", class: "btn small", text: "Fill it in by hand instead", onclick: () => startManual(input) }));
      intakeNote(msg === "Stopped." ? "" : "bad", msg, manual);
    } finally {
      setBusy(false);
      abortCtl = null;
    }
  }
  $("#btnRead").addEventListener("click", readOrder);

  // No AI: a blank sheet, keeping whatever the files gave us (pictures, text) for reference.
  function startManual(input) {
    order = EO.blankOrder();
    order.items.push(EO.blankItem());
    if (input) {
      order.pictures = input.pictures.map(p => ({ id: EO.uid(), dataUrl: p.dataUrl, w: p.w, h: p.h, caption: p.name, item: "" }));
      order.sources = input.sources;
      order.sourceText = input.sourceText;
      if (input.artworkFiles.length) order.artwork.files = input.artworkFiles.join(", ");
    }
    files = []; $("#paste").value = ""; renderChips();
    $("#intakeNote").replaceChildren();
    EO.saveOrder(order);
    openReview();
  }
  $("#btnBlank").addEventListener("click", () => {
    const pending = files.length || $("#paste").value.trim();
    if (pending) {
      setBusy(true, "Opening the files…");
      EO.readInputs(files, $("#paste").value, m => { $("#progressMsg").textContent = m; })
        .then(startManual).catch(() => startManual(null)).finally(() => setBusy(false));
    } else startManual(null);
  });

  /* ======================= recent / saved orders ======================= */
  function orderRow(o, opts) {
    const pcs = EO.orderTotal(o);
    const products = o.items.map(i => str(i.product)).filter(Boolean).slice(0, 4).join(", ");
    const when = new Date(o.updatedAt || o.createdAt || Date.now());
    const li = el("li", null,
      el("span", { class: "ono" + (o.orderNo ? "" : " draft"), text: o.orderNo ? o.orderNo + (o.rev > 1 ? " R" + o.rev : "") : "Draft" }),
      el("div", { class: "who2" },
        el("b", { text: [str(o.customer.name), str(o.customer.team)].filter(Boolean).join(" · ") || "Customer not named" }),
        el("span", { text: pcs + " pcs · " + o.items.length + (o.items.length === 1 ? " item" : " items") + (products ? " · " + products : "") + " · " + when.toLocaleDateString() })),
      el("div", { class: "btnrow" },
        el("button", { type: "button", class: "btn small", text: "Open", onclick: () => openOrder(o.id) }),
        opts && opts.full ? el("button", { type: "button", class: "btn small", text: "Copy as new", title: "Start a repeat order from this one", onclick: () => copyOrder(o.id) }) : null,
        opts && opts.full ? el("button", { type: "button", class: "btn small danger", text: "Delete", onclick: () => removeOrder(o) }) : null));
    return li;
  }
  async function renderRecent() {
    const all = await EO.listOrders();
    const host = $("#recent");
    if (!all.length) {
      host.replaceChildren(el("li", { class: "empty", style: "display:block" }, el("b", { text: "No orders yet" }), "Every order you read or fill in is saved here automatically."));
      return;
    }
    host.replaceChildren(...all.slice(0, 6).map(o => orderRow(o)));
  }
  async function renderOrders() {
    const all = await EO.listOrders();
    const q = str($("#ordersSearch").value).toLowerCase();
    const hit = o => !q || [o.orderNo, o.customer.name, o.customer.team, o.customerPo].concat(o.items.map(i => i.product + " " + i.styleRef))
      .join(" ").toLowerCase().indexOf(q) > -1;
    const list = all.filter(hit);
    $("#ordersCount").textContent = list.length + " of " + all.length;
    $("#ordersList").replaceChildren(...(list.length ? list.map(o => orderRow(o, { full: true })) :
      [el("li", { class: "empty", style: "display:block" }, el("b", { text: all.length ? "Nothing matches" : "No orders yet" }))]));
  }
  $("#ordersSearch").addEventListener("input", EO.debounce(renderOrders, 150));
  async function openOrder(id) {
    const o = await EO.getOrder(id);
    if (!o) { EO.toast("That order is gone.", "bad"); return; }
    order = EO.upgradeOrder(o);
    openReview();
  }
  async function copyOrder(id) {
    const o = await EO.getOrder(id);
    if (!o) return;
    const c = EO.upgradeOrder(JSON.parse(JSON.stringify(o)));
    Object.assign(c, { id: EO.uid(), orderNo: "", rev: 0, issuedAt: 0, issuedDate: "", sharedRev: 0, changedSinceIssue: false, createdAt: Date.now(), updatedAt: Date.now(), orderDate: EO.todayISO(), shipBy: "", customerPo: "", readBy: "", aiUsage: null, warnings: [] });
    c.preparedBy = EO.settings().name || c.preparedBy;
    c.schedule = { cutting: "", stitching: "", qc: "", dispatch: "" };
    c.checks = []; c.resolvedAuto = [];
    order = c;
    await EO.saveOrder(order);
    EO.toast("Copied. Change what's different for this order.");
    openReview();
  }
  async function removeOrder(o) {
    if (!confirm("Delete " + (o.orderNo || "this draft") + (o.customer.name ? " for " + o.customer.name : "") + "? This can't be undone.")) return;
    await EO.deleteOrder(o.id);
    renderOrders();
  }
  // Orders saved before contact details were dropped: rewrite them without phone, email or address.
  async function scrubSaved() {
    for (const o of await EO.listOrders()) {
      const c = o.customer || {};
      if (c.contact || c.phone || c.email || c.shipTo) await EO.saveOrder(EO.upgradeOrder(o));
    }
  }

  /* ======================= review ======================= */
  let refreshChecksSoon = () => {};
  function field(label, obj, key, o) {
    o = o || {};
    const id = "f" + EO.uid();
    const wrap = el("div", { class: "f" + (o.cls ? " " + o.cls : "") }, el("label", { for: id, text: label }));
    let input;
    if (o.type === "area") input = el("textarea", { id, rows: o.rows || 3 });
    else if (o.type === "select") {
      input = el("select", { id });
      const opts = o.options.slice();
      if (obj[key] && !opts.includes(obj[key])) opts.push(obj[key]);
      opts.forEach(v => input.append(el("option", { value: v, text: v })));
    } else input = el("input", { id, type: "text" });
    if (o.mono) input.classList.add("mono");
    if (o.ph) input.placeholder = o.ph;
    input.value = obj[key] == null ? "" : obj[key];
    input.addEventListener(o.type === "select" ? "change" : "input", () => {
      obj[key] = o.number ? (input.value === "" ? null : EO.intOrNull(input.value)) : input.value;
      touched();
      if (o.onInput) o.onInput(input.value);
    });
    if (o.type === "date") {
      const human = el("span", { class: "help", text: EO.isISODate(obj[key]) ? EO.humanDate(obj[key]) : "" });
      const picker = el("input", { type: "date", tabindex: "-1", "aria-hidden": "true", style: "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" });
      picker.addEventListener("change", () => {
        if (!picker.value) return;
        input.value = picker.value; obj[key] = picker.value; human.textContent = EO.humanDate(picker.value); touched();
      });
      input.placeholder = o.ph || "YYYY-MM-DD";
      input.addEventListener("input", () => { human.textContent = EO.isISODate(input.value) ? EO.humanDate(input.value) : ""; });
      const btn = el("button", { type: "button", class: "btn small", "aria-label": "Pick a date for " + label, title: "Pick a date", onclick: () => {
        picker.value = EO.isISODate(input.value) ? input.value : "";
        try { picker.showPicker(); } catch (e) { picker.style.pointerEvents = "auto"; picker.focus(); picker.click(); }
      } }, icon("cal"));
      wrap.append(el("div", { class: "datewrap", style: "position:relative" }, input, btn, picker), human);
      return wrap;
    }
    wrap.append(input);
    if (o.help) wrap.append(el("span", { class: "help", text: o.help }));
    return wrap;
  }
  // Rows of short fields (colour specs, construction lines) with add and remove.
  function listEditor(list, cols, addLabel) {
    const host = el("div", { style: "display:flex;flex-direction:column;gap:8px" });
    const draw = () => {
      const rows = list.map((row, i) => el("tr", null,
        cols.map(c => {
          const tag = c.area ? "textarea" : "input";
          const x = el(tag, { value: row[c.key] || "", placeholder: c.ph || "", "aria-label": c.label, rows: c.area ? 2 : null, class: c.mono ? "mono" : "" });
          x.addEventListener("input", () => { row[c.key] = x.value; touched(); });
          return el("td", { style: c.width ? "width:" + c.width : "" }, x);
        }),
        el("td", { style: "width:34px" }, iconBtn("x", "Remove", () => { list.splice(i, 1); touched(); draw(); }, "danger"))));
      host.replaceChildren(...[
        list.length ? el("div", { style: "overflow-x:auto" }, el("table", { class: "roster" },
          el("thead", null, el("tr", null, cols.map(c => el("th", { text: c.label })), el("th"))),
          el("tbody", null, rows))) : null,
        el("div", { class: "btnrow" }, el("button", { type: "button", class: "btn small", onclick: () => {
          const row = { id: EO.uid() };
          cols.forEach(c => { row[c.key] = ""; });
          list.push(row); touched(); draw();
          const ins = host.querySelectorAll("tbody tr:last-child input, tbody tr:last-child textarea");
          if (ins[0]) ins[0].focus();
        } }, icon("plus"), addLabel))].filter(Boolean));
    };
    draw();
    return host;
  }

  function panel(title, hint, body, attrs) {
    return el("div", Object.assign({ class: "panel" }, attrs || {}),
      el("header", null, el("h2", { text: title }), hint ? el("span", { class: "hint", text: hint }) : null),
      el("div", { class: "panel-body" }, body));
  }

  function openReview() {
    lastPdf = null;
    renderReview();
    show("review");
  }

  function renderReview() {
    const v = $("#view-review");
    const s = EO.settings();
    const top = el("div", { class: "reviewbar", id: "reviewbar" });
    const parts = [top];

    if (order.readBy || (order.warnings && order.warnings.length)) {
      const used = order.aiUsage && order.aiUsage.total ? " It used " + order.aiUsage.total.toLocaleString() + " tokens." : "";
      const n = el("div", { class: "note good" },
        el("div", { text: order.readBy ? "Read by Gemini (" + order.readBy + ")." + used + " Check every quantity against the customer's order before you make the sheet." : "Check every quantity against the customer's order." }));
      if (order.warnings && order.warnings.length) n.append(el("ul", null, order.warnings.map(w => el("li", { text: w }))));
      parts.push(n);
    }

    parts.push(el("div", { id: "checksHost" }));

    const nextNo = EO.peekNextNumber().text;
    parts.push(panel("Order", null, el("div", { class: "grid" },
      field("Our order no.", order, "orderNo", { mono: true, ph: nextNo, help: order.orderNo ? "" : "Given automatically when you make the sheet." }),
      field("Customer order code", order, "customerPo", { mono: true, ph: "e.g. BP 347" }),
      field("Order received", order, "orderDate", { type: "date" }),
      field("Ship by", order, "shipBy", { type: "date", ph: "date or e.g. ASAP" }),
      field("Priority", order, "priority", { type: "select", options: EO.PRIORITIES }),
      field("Prepared by", order, "preparedBy", { ph: s.name }),
      field("Mock / design ref", order, "mockRef", { mono: true, ph: "e.g. C-53462" }),
      field("Size chart", order, "sizeChart", { ph: "e.g. Bibs, Soccer" }),
      field("Repeat of / based on", order, "repeatOf", { cls: "full", ph: "e.g. Same as BB:38, 504 except colours in Pantone PC" })
    )));

    const c = order.customer;
    parts.push(panel("Customer & team", "Contact details and addresses are never kept", el("div", { class: "grid" },
      field("Customer / brand", c, "name", { cls: "s2", onInput: refreshSums, ph: "e.g. NuOla" }),
      field("Team / design", c, "team", { cls: "s2", onInput: refreshSums, ph: "e.g. Augsburg Lions" })
    )));

    parts.push(panel("Production notes", "Printed first on the sheet, in a box workers can't miss", el("div", { class: "grid" },
      field("Notes for production", order, "notes", { type: "area", cls: "full", rows: 4, ph: "e.g. URGENT. Make sure all are perfect and free of defects." })
    )));

    const ap = order.approvals;
    parts.push(panel("Approvals before production", "Yes, No, or details", el("div", { class: "grid" },
      field("Graphic mock-up of every jersey", ap, "mockup", { ph: "Yes / No" }),
      field("Pre-print / strike-off test", ap, "prePrint", { ph: "Yes / No" }),
      field("Customer confirmation first", ap, "confirmation", { ph: "Yes / No" }),
      field("Pre-production sample", ap, "sample", { ph: "Yes / No / details" })
    )));

    parts.push(panel("Colour specifications", "Pantone and CMYK codes for printing", listEditor(order.colourSpecs, [
      { key: "name", label: "Colour", ph: "e.g. Royal Blue" },
      { key: "pantone", label: "Pantone", ph: "e.g. Pantone 2738 PC", mono: true },
      { key: "cmyk", label: "CMYK / values", ph: "e.g. C100 M84 Y0 K2", mono: true }
    ], "Colour")));

    const itemsHost = el("div", { id: "itemsHost", style: "display:flex;flex-direction:column;gap:14px" });
    parts.push(panel("Items", "One card per garment. Colours down, sizes across.", [
      itemsHost,
      el("div", { class: "btnrow" }, el("button", { type: "button", class: "btn", onclick: () => { order.items.push(EO.blankItem()); touched(); renderItems(); } }, icon("plus"), "Add item"))
    ]));

    const a = order.artwork;
    parts.push(panel("Artwork & decoration", null, el("div", { class: "grid" },
      field("Files received", a, "files", { cls: "s2", ph: "logo files, mockups, what's still missing" }),
      field("Names & numbers", a, "namesNumbers", { cls: "s2", ph: "e.g. Names and numbers on back, custom style" }),
      field("Fonts", a, "fonts", { cls: "s2", ph: "e.g. As per mock" }),
      field("Logos", a, "logos", { cls: "s2", ph: "e.g. NuOla logo centred with team logo" }),
      field("Artwork notes", a, "notes", { type: "area", cls: "full", rows: 2 })
    )));

    const picsHost = el("div", { id: "picsHost" });
    const picIn = el("input", { type: "file", accept: "image/*,.pdf", multiple: true, hidden: true, onchange: e => { addPictureFiles(e.target.files); e.target.value = ""; } });
    parts.push(panel("Pictures", "An item's pictures print under that item; general ones (size charts) at the end", [
      picsHost,
      el("div", { class: "btnrow" }, el("button", { type: "button", class: "btn", onclick: () => picIn.click() }, icon("plus"), "Add pictures"), picIn)
    ]));

    const sc = order.schedule;
    parts.push(panel("Production schedule", "Optional: fill in if you plan dates now", el("div", { class: "grid" },
      field("Cutting", sc, "cutting", { type: "date" }),
      field("Stitching", sc, "stitching", { type: "date" }),
      field("QC / finishing", sc, "qc", { type: "date" }),
      field("Dispatch", sc, "dispatch", { type: "date" })
    )));

    const p = order.packing;
    parts.push(panel("Packing & dispatch", null, el("div", { class: "grid" },
      field("Packing", p, "packing", { type: "area", cls: "full", rows: 2, ph: "polybags, fold, pack per size / per player, cartons" }),
      field("Labels & tags", p, "labels", { cls: "s2" }),
      field("Shipping method", p, "shipping", { cls: "s2" })
    )));

    if (order.sourceText || (order.sources && order.sources.length)) {
      const det = el("details", { class: "sub" },
        el("summary", { text: "What the customer sent (for reference)" }),
        el("div", null,
          order.sources && order.sources.length ? el("div", { class: "help", text: "Files: " + order.sources.map(x => x.name).join(", ") }) : null,
          order.sourceText ? el("pre", { style: "white-space:pre-wrap;font:13px/1.45 var(--font-mono);margin:0;max-height:420px;overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:10px", text: order.sourceText }) : null));
      if (!order.readBy) det.open = true;
      parts.push(det);
    }

    v.replaceChildren(...parts);
    renderItems();
    renderPictures();
    renderChecks();
    refreshSums();
  }

  /* ---------- checks ---------- */
  function renderChecks() {
    const host = $("#checksHost");
    if (!host) return;
    const auto = EO.autoChecks(order);
    order.resolvedAuto = order.resolvedAuto.filter(t => auto.includes(t));
    const list = el("ul", { class: "checks" });
    order.checks.forEach((c, i) => {
      const txt = el("input", { type: "text", value: c.text, "aria-label": "Check text" });
      txt.addEventListener("input", () => { c.text = txt.value; touched(); });
      const cb = el("input", { type: "checkbox", checked: c.resolved, "aria-label": "Confirmed" });
      cb.addEventListener("change", () => { c.resolved = cb.checked; li.classList.toggle("done", cb.checked); touched(); });
      const li = el("li", { class: c.resolved ? "done" : "" }, cb, el("span", { class: "txt" }, txt),
        iconBtn("x", "Remove this check", () => { order.checks.splice(i, 1); touched(); renderChecks(); }, "danger"));
      list.append(li);
    });
    auto.forEach(t => {
      const done = order.resolvedAuto.includes(t);
      const cb = el("input", { type: "checkbox", checked: done, "aria-label": "Checked, it's right" });
      const li = el("li", { class: done ? "done" : "" }, cb, el("span", { class: "txt", text: t }), el("span", { class: "tag", text: "AUTO" }));
      cb.addEventListener("change", () => {
        if (cb.checked) { if (!order.resolvedAuto.includes(t)) order.resolvedAuto.push(t); }
        else order.resolvedAuto = order.resolvedAuto.filter(x => x !== t);
        li.classList.toggle("done", cb.checked);
        touched();
      });
      list.append(li);
    });
    const add = el("input", { class: "in", placeholder: "Add something to confirm with the customer…" });
    const addIt = () => { if (!str(add.value)) return; order.checks.push({ id: EO.uid(), text: str(add.value), resolved: false }); touched(); renderChecks(); };
    add.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
    const open = EO.openChecks(order).length;
    const body = [
      el("p", { class: "lead", text: open ? "Unticked lines print in a red box at the top of the sheet. Tick a line once it's confirmed or fixed." : "Nothing open. Add anything you still need to confirm." }),
      order.checks.length || auto.length ? list : null,
      el("div", { class: "quick" }, add, el("button", { type: "button", class: "btn", text: "Add", onclick: addIt }))
    ];
    host.replaceChildren(panel("Check before production", open ? open + " open" : "all clear", body));
  }
  refreshChecksSoon = EO.debounce(() => {
    const a = document.activeElement;
    if (a && $("#checksHost") && $("#checksHost").contains(a)) return; // don't yank the box someone is typing in
    renderChecks();
  }, 700);

  /* ---------- sums ---------- */
  function refreshSums() {
    if (!order) return;
    const pcs = EO.orderTotal(order), n = order.items.length, open = EO.openChecks(order).length;
    const bar = $("#reviewbar");
    if (bar) {
      bar.replaceChildren(
        el("span", { class: "ono" + (order.orderNo ? "" : " draft"), text: order.orderNo ? order.orderNo + (order.rev > 1 ? " R" + order.rev : "") : "Draft" }),
        el("div", { class: "t" }, el("b", { text: [str(order.customer.name), str(order.customer.team)].filter(Boolean).join(" · ") || "Customer not named yet" }),
          el("span", { text: pcs + " pcs · " + n + (n === 1 ? " item" : " items") + (order.customerPo ? " · PO " + order.customerPo : "") })));
    }
    $("#actionSum").replaceChildren(el("b", { text: String(pcs) }), " pcs · " + n + (n === 1 ? " item" : " items") + " · ",
      open ? el("span", { style: "color:var(--signal)", text: open + (open === 1 ? " check open" : " checks open") }) : "no open checks");
    order.items.forEach((it, i) => {
      const pc = document.getElementById("pcs-" + it.id);
      if (pc) pc.textContent = EO.itemTotal(it) + " pcs";
      const no = document.getElementById("no-" + it.id);
      if (no) no.textContent = "ITEM " + EO.pad(i + 1, 2);
    });
  }

  /* ---------- items ---------- */
  function renderItems() {
    const host = $("#itemsHost");
    if (!host) return;
    host.replaceChildren(...order.items.map((it, i) => itemCard(it, i)));
    if (!order.items.length) host.append(el("div", { class: "empty" }, el("b", { text: "No items" }), "Add one for each garment on the order."));
    renderPictures();
  }

  function itemCard(it, i) {
    const n = order.items.length;
    const move = d => { const j = i + d; if (j < 0 || j >= n) return; order.items.splice(j, 0, order.items.splice(i, 1)[0]); touched(); renderItems(); };
    const prod = el("input", { class: "in prod", value: it.product, placeholder: "Product, e.g. Cropped Hoodie", "aria-label": "Product" });
    prod.addEventListener("input", () => { it.product = prod.value; touched(); });
    const grp = el("input", { class: "in grp", value: it.group, placeholder: "Range (Women's…)", "aria-label": "Range or group" });
    grp.addEventListener("input", () => { it.group = grp.value; touched(); });
    const head = el("header", null,
      el("span", { class: "no", id: "no-" + it.id, text: "ITEM " + EO.pad(i + 1, 2) }),
      grp, prod,
      el("span", { class: "pcs", id: "pcs-" + it.id, text: EO.itemTotal(it) + " pcs" }),
      iconBtn("up", "Move up", () => move(-1)),
      iconBtn("down", "Move down", () => move(1)),
      iconBtn("copy", "Duplicate item", () => {
        const c = JSON.parse(JSON.stringify(it));
        c.id = EO.uid(); c.rows.forEach(r => { r.id = EO.uid(); }); c.roster.forEach(p => { p.id = EO.uid(); });
        order.items.splice(i + 1, 0, c); touched(); renderItems();
      }),
      iconBtn("x", "Delete item", () => {
        if (EO.itemTotal(it) && !confirm("Delete item " + (i + 1) + " (" + (it.product || "untitled") + ")?")) return;
        order.items.splice(i, 1);
        order.pictures.forEach(p => { if (p.item === it.id) p.item = ""; });
        touched(); renderItems();
      }, "danger"));

    const coloursField = field("Colours", it, "colours", { cls: "s2", ph: "From the rows below: " + (EO.itemColours(Object.assign({}, it, { colours: "" })) || "e.g. Navy, White") });
    const specs = el("div", { class: "grid" },
      field("Style / mock ref", it, "styleRef", { mono: true }),
      field("Print method", it, "decoration", { ph: "Sublimation, Embroidery, DTF…" }),
      field("Fabric", it, "fabric", { cls: "s2", ph: "e.g. Standard Jacquard, Interlock, Fleece 320 gsm" }),
      coloursField,
      field("Cut / fit", it, "fit", { ph: "e.g. Male, fitted" }),
      field("Single / reversible", it, "sides", { ph: "Single or Reversible" }),
      field("Logos & placements", it, "placements", { cls: "s2", ph: "e.g. Left chest 8 cm, number on back" }),
      field("Trims & labels", it, "trims", { cls: "s2", ph: "neck and arm trims, hood, zips, labels…" }),
      field("Item notes", it, "notes", { type: "area", cls: "full", rows: 2 }));
    const specLines = el("div", { style: "display:flex;flex-direction:column;gap:6px" },
      el("span", { class: "flabel", text: "Construction & design details" }),
      listEditor(it.specs, [
        { key: "label", label: "Part", ph: "e.g. Neck, Hood, Side 1 front", width: "28%" },
        { key: "value", label: "Instruction", ph: "e.g. Curved V-neck, white trim from a separate piece", area: true }
      ], "Detail"));

    const gridHost = el("div");
    const drawGrid = () => gridHost.replaceChildren(qtyEditor(it, drawGrid));
    drawGrid();

    const stated = field("Customer's own total", it, "statedTotal", { mono: true, number: true, ph: "if they wrote one", help: "Only used to check the sizes add up." });
    stated.style.maxWidth = "220px";

    return el("div", { class: "item" }, head, el("div", { class: "item-body" }, specs, specLines, gridHost, stated, rosterEditor(it, drawGrid)));
  }

  function parseQuick(line) {
    let colour = "", rest = line;
    const m = /^\s*([^:]+?)\s*:\s*(.+)$/.exec(line);
    if (m) { colour = m[1].trim(); rest = m[2]; }
    const pairs = [];
    const re = /([A-Za-z0-9/]+(?:[ -](?:SMALL|MEDIUM|LARGE|Small|Medium|Large|small|medium|large))?)\s*[-:x×=]?\s*(\d{1,4})(?![\d])/g;
    let p;
    while ((p = re.exec(rest))) {
      const size = EO.normSize(p[1]);
      if (size) pairs.push([size, int(p[2])]);
    }
    return { colour, pairs };
  }

  function qtyEditor(it, redraw) {
    const sizes = it.sizes;
    const table = el("table", { class: "qty" });
    const totals = {};
    const thead = el("thead", null, el("tr", null,
      el("th", { class: "colour", scope: "col", text: "Colour" }),
      sizes.map((s, k) => {
        const inp = el("input", { value: s, size: 4, "aria-label": "Size label", title: "Rename size" });
        inp.addEventListener("change", () => {
          const nv = EO.normSize(inp.value);
          if (!nv) { inp.value = s; return; }
          if (nv !== s && sizes.includes(nv)) { EO.toast("There's already a " + nv + " column.", "bad"); inp.value = s; return; }
          it.rows.forEach(r => { if (s in r.q) { r.q[nv] = r.q[s]; delete r.q[s]; } });
          it.sizes[k] = nv; touched(); redraw();
        });
        return el("th", { scope: "col" }, el("div", { class: "sz" }, inp, iconBtn("x", "Remove size " + s, () => {
          if (EO.sizeTotal(it, s) && !confirm("Remove size " + s + " and its quantities?")) return;
          it.sizes.splice(k, 1); it.rows.forEach(r => { delete r.q[s]; }); touched(); redraw();
        })));
      }),
      el("th", { scope: "col", class: "tot", text: "Total" }),
      el("th", { class: "act" })));
    const tbody = el("tbody");
    const tfootCells = {};
    const grand = el("td", { class: "tot" });
    const refresh = () => {
      sizes.forEach(s => { if (tfootCells[s]) tfootCells[s].textContent = EO.sizeTotal(it, s); });
      grand.textContent = EO.gridTotal(it);
      it.rows.forEach(r => { if (totals[r.id]) totals[r.id].textContent = EO.rowTotal(it, r); });
    };
    it.rows.forEach((r, ri) => {
      const col = el("input", { value: r.colour, size: 14, placeholder: "Colour", "aria-label": "Colour" });
      col.addEventListener("input", () => { r.colour = col.value; touched(); });
      totals[r.id] = el("td", { class: "tot", text: EO.rowTotal(it, r) });
      tbody.append(el("tr", null,
        el("td", { class: "colour" }, col),
        sizes.map(s => {
          const q = int(r.q[s]);
          const inp = el("input", { value: q ? String(q) : "", size: 3, inputmode: "numeric", class: q ? "has" : "", "aria-label": (r.colour || "Row " + (ri + 1)) + " size " + s });
          inp.addEventListener("input", () => {
            const n = int(inp.value);
            if (n) r.q[s] = n; else delete r.q[s];
            inp.classList.toggle("has", !!n);
            refresh(); touched();
          });
          return el("td", null, inp);
        }),
        totals[r.id],
        el("td", { class: "act" }, iconBtn("x", "Remove this colour row", () => {
          if (EO.rowTotal(it, r) && !confirm("Remove the " + (r.colour || "colour") + " row?")) return;
          it.rows.splice(ri, 1); touched(); redraw();
        }, "danger"))));
    });
    table.append(thead, tbody);
    if (it.rows.length > 1 || !it.rows.length) {
      table.append(el("tfoot", null, el("tr", null,
        el("td", { class: "colour", text: "TOTAL" }),
        sizes.map(s => (tfootCells[s] = el("td", { text: EO.sizeTotal(it, s) }))),
        grand, el("td", { class: "act" }))));
    }
    refresh();

    const quick = el("input", { class: "in", placeholder: "Quick add a row: Navy: S 10, M 14, L 8, XL 4", "aria-label": "Quick add a colour row" });
    const doQuick = () => {
      const lines = quick.value.split(/\n|;(?=\s*[^:;]+:)/).map(x => x.trim()).filter(Boolean);
      let added = 0;
      for (const line of lines) {
        const { colour, pairs } = parseQuick(line);
        if (!pairs.length) continue;
        const row = EO.blankRow(colour);
        for (const [s, q] of pairs) { if (!it.sizes.includes(s)) it.sizes.push(s); row.q[s] = int(row.q[s]) + q; }
        it.rows.push(row); added++;
      }
      if (!added) { EO.toast("Couldn't find sizes and quantities in that. Example: Navy: S 10, M 14"); return; }
      it.sizes = EO.sortSizes(it.sizes);
      quick.value = ""; touched(); redraw();
    };
    quick.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doQuick(); } });

    return el("div", { style: "display:flex;flex-direction:column;gap:8px" },
      el("span", { class: "flabel", text: "Quantities: colour × size" }),
      sizes.length || it.rows.length ? el("div", { class: "qtywrap" }, table) : el("div", { class: "help", text: "No sizes yet. Add a size and a colour row, or use quick add." }),
      el("div", { class: "btnrow" },
        el("button", { type: "button", class: "btn small", onclick: () => { it.rows.push(EO.blankRow("")); touched(); redraw(); } }, icon("plus"), "Colour row"),
        el("button", { type: "button", class: "btn small", onclick: () => {
          const label = prompt("New size label (for example 3XL, YM, 32, One Size):");
          const s = EO.normSize(label);
          if (!s) return;
          if (it.sizes.includes(s)) { EO.toast(s + " is already there."); return; }
          it.sizes.push(s); it.sizes = EO.sortSizes(it.sizes);
          if (!it.rows.length) it.rows.push(EO.blankRow(""));
          touched(); redraw();
        } }, icon("plus"), "Size")),
      el("div", { class: "quick" }, quick, el("button", { type: "button", class: "btn small", text: "Add row", onclick: doQuick })));
  }

  function parseRosterLine(line) {
    let toks = line.split(/\t|\s*[,;|]\s*|\s{2,}/).map(x => x.trim()).filter(Boolean);
    if (toks.length === 1) toks = toks[0].split(/\s+/); // "#23 Bilal Khan XL"
    const p = EO.blankPlayer();
    const nameParts = [];
    for (const t of toks) {
      const ns = EO.normSize(t);
      if (!p.size && /^(Y?(X{0,5}S|M|X{0,5}L|\dX?S|\dXL)|ONE SIZE|\d{1,2}-\d{1,2}Y?)$/.test(ns)) p.size = ns;
      else if (!p.number && /^#?\d{1,3}$/.test(t)) p.number = t.replace("#", "");
      else if (p.number && p.size && /^\d{1,3}$/.test(t) && p.qty === "") p.qty = int(t);
      else nameParts.push(t);
    }
    p.name = nameParts.join(" ");
    return p;
  }

  function rosterEditor(it, redrawGrid) {
    const det = el("details", { class: "sub" });
    if (it.roster.length) det.open = true;
    const body = el("div");
    const label = () => "Players: names, numbers & sizes (" + it.roster.length + ")";
    const draw = () => {
      const cols = it.rosterCols;
      const rows = it.roster.map((p, i) => {
        const inp = (k, w, ph) => {
          const x = el("input", { value: p[k] == null ? "" : p[k], placeholder: ph || "", style: w ? "width:" + w : "", "aria-label": k });
          x.addEventListener("input", () => { p[k] = k === "qty" ? (x.value === "" ? "" : int(x.value)) : x.value; touched(); });
          return el("td", null, x);
        };
        const extra = k => {
          const x = el("input", { value: (p.extra && p.extra[k]) || "", "aria-label": k, style: "min-width:90px" });
          x.addEventListener("input", () => { p.extra = p.extra || {}; p.extra[k] = x.value; touched(); });
          return el("td", null, x);
        };
        return el("tr", null, el("td", { class: "mono", style: "color:var(--muted);width:30px", text: String(i + 1) }),
          inp("name", "170px", "Name"), inp("number", "70px", "No."), inp("size", "70px", "Size"), inp("qty", "60px", "1"),
          cols.map(extra), inp("notes", "", ""),
          el("td", null, iconBtn("x", "Remove player", () => { it.roster.splice(i, 1); touched(); draw(); }, "danger")));
      });
      const colHead = k => el("th", null, el("span", { text: k + " " }), iconBtn("x", "Remove column " + k, () => {
        if (!confirm("Remove the " + k + " column?")) return;
        it.rosterCols = it.rosterCols.filter(x => x !== k);
        it.roster.forEach(p => { if (p.extra) delete p.extra[k]; });
        touched(); draw();
      }));
      const paste = el("textarea", { class: "in", rows: 3, placeholder: "Paste a list, one player per line: Name, Number, Size (Excel columns work too)" });
      body.replaceChildren(
        it.roster.length ? el("div", { style: "overflow-x:auto" }, el("table", { class: "roster" },
          el("thead", null, el("tr", null, ["#", "Name", "Number", "Size", "Qty"].map(h => el("th", { text: h })), cols.map(colHead), el("th", { text: "Notes" }), el("th"))),
          el("tbody", null, rows))) : el("div", { class: "help", text: "For team orders: player names, numbers and sizes. Leave empty if there's none." }),
        el("div", { class: "btnrow" },
          el("button", { type: "button", class: "btn small", onclick: () => { it.roster.push(EO.blankPlayer()); touched(); draw(); } }, icon("plus"), "Player"),
          el("button", { type: "button", class: "btn small", onclick: () => {
            const k = str(prompt("Name of the new column (e.g. Length, Chest, Tailored, Sleeves):"));
            if (!k || it.rosterCols.some(x => x.toLowerCase() === k.toLowerCase())) return;
            it.rosterCols.push(k); touched(); draw();
          } }, icon("plus"), "Column"),
          it.roster.length ? el("button", { type: "button", class: "btn small", text: "Count roster into the size grid", onclick: () => {
            if (EO.gridTotal(it) && !confirm("Replace the size grid with the roster's counts?")) return;
            EO.gridFromRoster(it); touched(); redrawGrid();
          } }) : null),
        paste,
        el("div", { class: "btnrow" }, el("button", { type: "button", class: "btn small", text: "Add players from the list", onclick: () => {
          const lines = paste.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
          const added = lines.map(parseRosterLine).filter(p => p.name || p.number);
          if (!added.length) { EO.toast("No players found in that list."); return; }
          it.roster.push(...added); touched(); draw();
        } })));
      sum.textContent = label();
    };
    const sum = el("summary");
    det.append(sum, body);
    draw();
    return det;
  }

  /* ---------- pictures ---------- */
  function renderPictures() {
    const host = $("#picsHost");
    if (!host) return;
    if (!order.pictures.length) {
      host.replaceChildren(el("div", { class: "empty" }, el("b", { text: "No pictures" }), "Pictures inside the customer's files appear here by themselves. Add mockups, logos or reference photos."));
      return;
    }
    const opts = [["", "General (whole order)"]].concat(order.items.map((it, i) => [it.id, "Item " + EO.pad(i + 1, 2) + (it.product ? ": " + it.product : "")]));
    host.replaceChildren(el("div", { class: "pics" }, order.pictures.map((p, i) => {
      const cap = el("input", { class: "in", value: p.caption || "", placeholder: "What it shows", "aria-label": "Caption" });
      cap.addEventListener("input", () => { p.caption = cap.value; touched(); });
      const sel = el("select", { class: "in", "aria-label": "Belongs to" }, opts.map(([v, t]) => el("option", { value: v, text: t })));
      sel.value = order.items.some(it => it.id === p.item) ? p.item : "";
      sel.addEventListener("change", () => { p.item = sel.value; touched(); });
      return el("div", { class: "pic" },
        el("img", { src: p.dataUrl, alt: p.caption || "Reference picture " + (i + 1) }),
        cap, sel,
        el("div", { class: "btnrow" }, el("button", { type: "button", class: "btn small danger", text: "Remove", onclick: () => { order.pictures.splice(i, 1); touched(); renderPictures(); } })));
    })));
  }
  async function addPictureFiles(list) {
    let added = 0;
    for (const f of Array.from(list)) {
      try {
        if (EO.fileExt(f.name) === "pdf" || f.type === "application/pdf") {
          const pdf = await EO.openPdf(await f.arrayBuffer());
          for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
            const page = await pdf.getPage(p);
            const vp0 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: Math.min(2, 1400 / vp0.width) });
            const cv = el("canvas", { width: Math.round(vp.width), height: Math.round(vp.height) });
            await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
            order.pictures.push({ id: EO.uid(), dataUrl: cv.toDataURL("image/jpeg", 0.85), w: cv.width, h: cv.height, caption: f.name + " page " + p, item: "" });
            added++;
          }
        } else {
          const pic = await EO.imageToJpeg(f, 1600);
          order.pictures.push({ id: EO.uid(), dataUrl: pic.dataUrl, w: pic.w, h: pic.h, caption: f.name.replace(/\.[^.]+$/, ""), item: "" });
          added++;
        }
      } catch (e) { EO.toast("Couldn't add " + f.name + ".", "bad"); }
    }
    if (added) { touched(); renderPictures(); }
  }

  /* ======================= the sheet ======================= */
  async function makeSheet() {
    const s = EO.settings();
    if (!order.items.length) { EO.toast("Add at least one item first.", "bad"); return; }
    if (!str(order.orderNo) && !EO.cleanInitials(s.initials)) { EO.toast("Add your initials in Settings first; they go in the order number.", "bad"); openSettings(); return; }
    order.orderNo = str(order.orderNo);
    if (!order.orderNo) { order.orderNo = EO.takeNextNumber(); order.rev = 1; }
    else if (!order.rev) order.rev = 1;
    else if (order.changedSinceIssue && order.sharedRev === order.rev) order.rev++; // the old version already left the tool
    order.changedSinceIssue = false;
    order.issuedAt = Date.now();
    order.issuedDate = EO.todayISO();
    if (!str(order.preparedBy)) order.preparedBy = s.name || "";
    order.updatedAt = Date.now();
    await EO.saveOrder(order);

    show("sheet");
    $("#sheetNo").textContent = order.orderNo + (order.rev > 1 ? " R" + order.rev : "");
    const open = EO.openChecks(order);
    $("#sheetNote").replaceChildren(open.length
      ? el("div", { class: "note" }, open.length + (open.length === 1 ? " thing is" : " things are") + " still to confirm with the customer. " + (open.length === 1 ? "It's" : "They're") + " printed in the red box at the top of the sheet.")
      : el("div", { class: "note good", text: "Everything is confirmed. Download the PDF for production, or print it." }));
    const prev = $("#preview");
    prev.replaceChildren(el("div", { class: "progress", style: "width:100%;max-width:820px" }, el("div", { class: "spin" }), el("div", { class: "msg", text: "Drawing the sheet and fitting the pictures onto as few pages as possible…" })));
    ["#btnPdf", "#btnXlsx", "#btnPrint"].forEach(b => { $(b).disabled = true; });
    try {
      lastPdf = await EO.makeSheetPdf(order);
      await drawPreview(lastPdf);
    } catch (e) {
      prev.replaceChildren(el("div", { class: "note bad", text: "The sheet couldn't be drawn: " + (e && e.message ? e.message : e) }));
    } finally {
      ["#btnPdf", "#btnXlsx", "#btnPrint"].forEach(b => { $(b).disabled = false; });
    }
  }
  async function drawPreview(blob) {
    const prev = $("#preview");
    const pdf = await EO.openPdf(await blob.arrayBuffer());
    const canvases = [];
    const width = Math.min(820, prev.clientWidth - 32 || 820);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width * dpr) / vp0.width });
      const cv = el("canvas", { width: Math.round(vp.width), height: Math.round(vp.height), "aria-label": "Page " + p });
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      canvases.push(cv);
    }
    prev.replaceChildren(...canvases);
  }
  const sheetName = ext => EO.safeFilename((order.orderNo || "DRAFT") + (order.rev > 1 ? " R" + order.rev : "") + " " + (order.customer.name || "")) + "." + ext;
  function markShared() { order.sharedRev = order.rev; EO.saveOrder(order); }

  $("#btnPdf").addEventListener("click", () => { if (!lastPdf) return; EO.downloadBlob(lastPdf, sheetName("pdf")); markShared(); });
  $("#btnXlsx").addEventListener("click", async () => {
    const b = $("#btnXlsx");
    b.disabled = true;
    try { EO.downloadBlob(await EO.makeSheetXlsx(order), sheetName("xlsx")); markShared(); }
    catch (e) { EO.toast("The Excel file couldn't be made: " + (e && e.message ? e.message : e), "bad"); }
    finally { b.disabled = false; }
  });
  $("#btnPrint").addEventListener("click", () => {
    if (!lastPdf) return;
    markShared();
    const url = URL.createObjectURL(lastPdf);
    const old = $("#printFrame");
    if (old) old.remove();
    const fr = el("iframe", { id: "printFrame", src: url, style: "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0", title: "Print" });
    fr.onload = () => {
      setTimeout(() => {
        try { fr.contentWindow.focus(); fr.contentWindow.print(); }
        catch (e) { window.open(url, "_blank"); }
      }, 300);
    };
    document.body.appendChild(fr);
  });
  $("#btnMake").addEventListener("click", () => { persist.flush(); makeSheet(); });
  $("#btnEdit").addEventListener("click", () => openReview());
  $("#btnBackHome").addEventListener("click", goHome);

  /* ======================= settings ======================= */
  let nextEdited = false;
  // Who may change what: without an admin password everyone may; with one, only after unlocking.
  function applyAccess() {
    const prot = EO.vault.isProtected();
    const admin = EO.vault.isAdmin();
    $("#stAdminBar").hidden = admin;
    EO.$$("#settings fieldset.admin-only").forEach(f => { f.disabled = !admin; });
    $("#stAccessFs").hidden = $("#stShareFs").hidden = !admin; // the admin's business only
    $("#stCompanyWrap").hidden = !(prot && admin);
    $("#stRestore").hidden = !admin;
    $("#stProtOff").hidden = prot;
    $("#stProtOn").hidden = !prot;
    $("#stLinkOn").hidden = !prot;
    $("#stLinkOff").hidden = prot;
    keyState();
  }
  function keyState() {
    const prot = EO.vault.isProtected();
    const s = EO.settings();
    const hasCompany = prot && !!EO.vault.secrets().companyKey;
    $("#stChoice").hidden = !hasCompany;
    $("#stOwnWrap").hidden = !(s.allowOwnKey || EO.vault.isAdmin());
    const own = !hasCompany || $("#stUseOwn").checked;
    $("#stKeyRow").hidden = !own;
    $("#stKeyMsg").replaceChildren(...(hasCompany && !own
      ? ["Orders are read with the company key."]
      : ["Free key from ", el("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener", text: "aistudio.google.com/apikey" }), ". It stays in this browser only" + (prot ? ", encrypted." : ".")]));
  }
  ["#stUseCompany", "#stUseOwn"].forEach(id => $(id).addEventListener("change", keyState));
  function openSettings() {
    const s = EO.settings();
    const prot = EO.vault.isProtected(), sec = EO.vault.secrets();
    $("#stName").value = s.name; $("#stIni").value = s.initials;
    if (prot) {
      $("#stUseCompany").checked = !sec.useOwn || !sec.ownKey;
      $("#stUseOwn").checked = !$("#stUseCompany").checked;
      $("#stKey").value = sec.ownKey;
      $("#stKey").placeholder = "Paste your own key";
      $("#stCompanyKey").value = sec.companyKey;
    } else {
      $("#stKey").value = s.apiKey;
      $("#stKey").placeholder = "Paste the key";
    }
    $("#stKey").type = "password"; $("#stKeyShow").textContent = "Show";
    $("#stCo").value = s.companyName; $("#stTag").value = s.companyTagline;
    const p = EO.peekNextNumber();
    $("#stNext").value = p.n; nextEdited = false;
    $("#stNextPrev").textContent = p.text;
    ["#stLinkMsg", "#stJoinMsg", "#stProtMsg", "#stProtMsg2", "#stAdminMsg"].forEach(id => { $(id).textContent = ""; });
    ["#stPw1", "#stPw2", "#stAd1", "#stAd2", "#stNewPw", "#stNewAd", "#stAdminPw"].forEach(id => { $(id).value = ""; });
    $("#stAllowOwn").checked = s.allowOwnKey !== false;
    $("#stIncKey").checked = true;
    setLogo(s.logo);
    applyAccess();
    if (!$("#settings").open) $("#settings").showModal();
  }
  $("#stAdminUnlock").addEventListener("click", async () => {
    $("#stAdminMsg").textContent = "Checking…";
    if (await EO.vault.checkAdmin($("#stAdminPw").value)) { $("#stAdminMsg").textContent = ""; applyAccess(); }
    else $("#stAdminMsg").textContent = "That isn't the admin password.";
  });
  $("#stAdminPw").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#stAdminUnlock").click(); } });
  let pendingLogo = null;
  function setLogo(d) {
    pendingLogo = d || "";
    $("#stLogoPrev").hidden = !pendingLogo;
    if (pendingLogo) $("#stLogoPrev").src = pendingLogo;
    $("#stLogoDel").hidden = !pendingLogo;
    $("#stLogoBtn").textContent = pendingLogo ? "Change logo" : "Add logo";
  }
  function nextPreview() {
    const ini = EO.cleanInitials($("#stIni").value) || "XX";
    if (!nextEdited) $("#stNext").value = EO.peekNextNumber(ini).n; // each set of initials has its own series
    const yy = String(new Date().getFullYear()).slice(-2);
    $("#stNextPrev").textContent = "EI-" + yy + "-" + ini + "-" + EO.pad(Math.max(1, int($("#stNext").value) || 1), 4);
  }
  $("#stIni").addEventListener("input", nextPreview);
  $("#stNext").addEventListener("input", () => { nextEdited = true; nextPreview(); });
  $("#stKeyShow").addEventListener("click", () => {
    const k = $("#stKey"); k.type = k.type === "password" ? "text" : "password";
    $("#stKeyShow").textContent = k.type === "password" ? "Show" : "Hide";
  });
  $("#stKeyTest").addEventListener("click", async () => {
    const key = str($("#stKey").value);
    if (!key) { $("#stKeyMsg").textContent = "Paste a key first."; return; }
    $("#stKeyMsg").textContent = "Testing…";
    try { const m = await EO.testKey(key); $("#stKeyMsg").textContent = "The key works. Orders will be read by " + m + "."; }
    catch (e) { $("#stKeyMsg").textContent = EO.geminiFriendly(e); }
  });

  /* ---------- password protection (admin) ---------- */
  $("#stProtect").addEventListener("click", async () => {
    const p1 = $("#stPw1").value, p2 = $("#stPw2").value, a1 = $("#stAd1").value, a2 = $("#stAd2").value;
    const say = t => { $("#stProtMsg").textContent = t; };
    if (p1.length < 8 || a1.length < 8) return say("Use at least 8 characters for both passwords.");
    if (p1 !== p2) return say("The two company passwords don't match.");
    if (a1 !== a2) return say("The two admin passwords don't match.");
    if (a1 === p1) return say("Use a different admin password from the company password.");
    const key = str($("#stKey").value) || EO.settings().apiKey;
    say("Turning on…");
    await EO.vault.create(p1, { companyKey: key, ownKey: "", useOwn: false });
    EO.saveSettings({ admin: await EO.vault.makeAdmin(a1), allowOwnKey: true });
    await EO.vault.checkAdmin(a1);
    await EO.encryptOrders();
    renderNav();
    openSettings();
    EO.toast("Password protection is on. Copy the worker link below for your team.");
  });
  $("#stChangePw").addEventListener("click", async () => {
    const pw = $("#stNewPw").value;
    if (pw.length < 8) { $("#stProtMsg2").textContent = "Use at least 8 characters."; return; }
    await EO.vault.changePassword(pw);
    $("#stNewPw").value = "";
    $("#stProtMsg2").textContent = "Changed on this computer. Copy a new worker link and tell workers the new password. People who know the old password and kept the old link can still read the key in it: if that worries you, also make a new Gemini key.";
  });
  $("#stChangeAd").addEventListener("click", async () => {
    const pw = $("#stNewAd").value;
    if (pw.length < 8) { $("#stProtMsg2").textContent = "Use at least 8 characters."; return; }
    EO.saveSettings({ admin: await EO.vault.makeAdmin(pw) });
    await EO.vault.checkAdmin(pw);
    $("#stNewAd").value = "";
    $("#stProtMsg2").textContent = "Admin password changed on this computer. New worker links carry it; computers set up with older links keep the old one until they open a new link.";
  });
  $("#stUnprotect").addEventListener("click", async () => {
    if (!confirm("Turn off the password on this computer? Saved orders here will be stored unencrypted again.")) return;
    const sec = EO.vault.secrets();
    await EO.rewriteOrders();
    EO.vault.destroy();
    EO.saveSettings({ admin: null, apiKey: sec.useOwn && sec.ownKey ? sec.ownKey : sec.companyKey });
    renderNav();
    openSettings();
    EO.toast("Password turned off on this computer.");
  });
  $("#stCopyJoin").addEventListener("click", async () => {
    const s = EO.settings();
    const companyKey = str($("#stCompanyKey").value) || EO.vault.secrets().companyKey;
    const includeKey = $("#stIncKey").checked;
    if (includeKey && !companyKey) { $("#stJoinMsg").textContent = "Add the company key above first."; return; }
    const pw = await askPassword("Company password", "Type the company password. The link is locked with it, so a link on its own is useless.");
    if (!pw) return;
    const allowOwn = $("#stAllowOwn").checked;
    try {
      const link = await EO.vault.makeJoinLink(pw, {
        v: 1, key: includeKey ? companyKey : "", co: str($("#stCo").value) || s.companyName,
        tg: $("#stTag").value, admin: s.admin, own: allowOwn || !includeKey
      });
      EO.saveSettings({ allowOwnKey: allowOwn });
      try { await navigator.clipboard.writeText(link); $("#stJoinMsg").textContent = "Copied. Send the link, and tell them the password separately."; }
      catch (e) { prompt("Copy this worker link:", link); }
    } catch (e) { $("#stJoinMsg").textContent = e.message; }
  });
  $("#stCopyLink").addEventListener("click", async () => {
    const key = str($("#stKey").value);
    if (!key) { $("#stLinkMsg").textContent = "Add the key first."; return; }
    EO.saveSettings({ apiKey: key, companyName: str($("#stCo").value) || "Ennoble International", companyTagline: $("#stTag").value });
    const link = setupLink();
    try { await navigator.clipboard.writeText(link); $("#stLinkMsg").textContent = "Copied. Paste it into WhatsApp or email."; }
    catch (e) { prompt("Copy this setup link:", link); }
  });
  $("#stLogoBtn").addEventListener("click", () => $("#stLogoIn").click());
  $("#stLogoDel").addEventListener("click", () => setLogo(""));
  $("#stLogoIn").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 400 / Math.max(img.width, img.height));
      const cv = el("canvas", { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      setLogo(cv.toDataURL("image/png"));
    } catch (err) { EO.toast("That logo couldn't be opened. Try a PNG or JPG.", "bad"); }
  });
  $("#stSave").addEventListener("click", async e => {
    e.preventDefault();
    const prot = EO.vault.isProtected(), admin = EO.vault.isAdmin();
    const name = str($("#stName").value), ini = EO.cleanInitials($("#stIni").value);
    if (!name || !ini) { EO.toast("Type your name and initials.", "bad"); return; }
    if (prot) {
      const sec = EO.vault.secrets();
      const companyKey = admin ? str($("#stCompanyKey").value) : sec.companyKey;
      const useOwn = !companyKey || $("#stUseOwn").checked;
      const ownKey = str($("#stKey").value);
      if (useOwn && !ownKey) { EO.toast("Paste your own key, or choose the company key.", "bad"); return; }
      await EO.vault.setSecrets({ companyKey, useOwn, ownKey });
    }
    const patch = { name, initials: ini };
    if (admin) {
      Object.assign(patch, { companyName: str($("#stCo").value) || "Ennoble International", companyTagline: $("#stTag").value, logo: pendingLogo });
      if (!prot) patch.apiKey = str($("#stKey").value);
    }
    EO.saveSettings(patch);
    if (nextEdited) EO.setNextNumber(int($("#stNext").value) || 1);
    $("#settings").close();
    renderWho(); renderSetup();
    if (order && !$("#view-review").hidden) renderReview();
    EO.toast("Settings saved.");
  });
  $("#stBackup").addEventListener("click", async () => {
    let data;
    if (EO.vault.isProtected()) {
      const recs = (await EO.rawOrders()).filter(r => r.enc);
      data = { app: "ennoble-order-sheet", version: 2, protected: true, exportedAt: new Date().toISOString(), vault: EO.vault.backupHeader(), orders: recs.map(EO.vault.recordOut) };
    } else {
      data = { app: "ennoble-order-sheet", version: 1, exportedAt: new Date().toISOString(), orders: await EO.listOrders() };
    }
    EO.downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), "ennoble-orders-backup-" + EO.todayISO() + ".json");
  });
  $("#stRestore").addEventListener("click", () => $("#stRestoreIn").click());
  $("#stRestoreIn").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (err) { EO.toast("That isn't an order backup file.", "bad"); return; }
    let list = Array.isArray(data.orders) ? data.orders : [];
    if (data.protected) {
      const pw = await askPassword("Backup password", "This backup is encrypted. Type the company password it was made with.");
      if (!pw) return;
      list = await EO.vault.openBackup(data.vault, list, pw);
      if (!list) { EO.toast("That password doesn't open this backup.", "bad"); return; }
    }
    let n = 0;
    for (const o of list) if (o && o.id && o.items) { await EO.saveOrder(EO.upgradeOrder(o)); n++; }
    EO.toast(n + " orders restored.");
    renderRecent();
  });

  /* ======================= nav + start ======================= */
  $("#goHome").addEventListener("click", goHome);
  $("#navNew").addEventListener("click", goHome);
  $("#navOrders").addEventListener("click", async () => { persist.flush(); show("orders"); await renderOrders(); });
  $("#btnAllOrders").addEventListener("click", async () => { show("orders"); await renderOrders(); });
  $("#navSettings").addEventListener("click", openSettings);
  $("#btnNew2").addEventListener("click", goHome);
  window.addEventListener("beforeunload", () => persist.flush());

  async function boot() {
    const join = (/[#&]join=([A-Za-z0-9_-]+)/.exec(location.hash || "") || [])[1];
    if (join) {
      history.replaceState(null, "", location.pathname + location.search);
      await joinFlow(join);
    } else if (EO.vault.isProtected()) {
      document.body.classList.add("locked");
      if (!(await EO.vault.resume())) await unlockFlow();
      document.body.classList.remove("locked");
    }
    if (/[#&]setup=/.test(location.hash || "")) {
      if (EO.vault.isProtected()) {
        history.replaceState(null, "", location.pathname + location.search);
        EO.toast("This computer uses the company password. Ask for the new worker link.", "bad");
      } else readSetupLink();
    }
    renderWho();
    renderNav();
    await goHome();
    scrubSaved().catch(() => {});
  }
  window.addEventListener("hashchange", () => {
    if (/[#&]join=/.test(location.hash)) location.reload();
    else if (!EO.vault.isProtected() && readSetupLink()) renderSetup();
  });
  boot();

  // Exposed for tests and the console.
  EO.app = { get order() { return order; }, openOrder, makeSheet, renderReview };
})(window.EO);
