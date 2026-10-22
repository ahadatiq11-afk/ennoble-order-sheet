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
    await renderRecent();
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
    if (!$("#suKey").value) $("#suKey").value = s.apiKey;
    $("#suKeyHelp").textContent = s.apiKey ? "Key already added from the setup link." : "Filled in for you if you opened a setup link.";
    $("#suIniPrev").textContent = EO.cleanInitials($("#suIni").value) || "AA";
  }
  $("#suIni").addEventListener("input", () => { $("#suIniPrev").textContent = EO.cleanInitials($("#suIni").value) || "AA"; });
  $("#suSave").addEventListener("click", async () => {
    const name = str($("#suName").value), ini = EO.cleanInitials($("#suIni").value), key = str($("#suKey").value);
    if (!name || !ini) { $("#suMsg").textContent = "Type your name and initials."; return; }
    if (!key) { $("#suMsg").textContent = "Add the Gemini key (or open the setup link you were sent)."; return; }
    EO.saveSettings({ name, initials: ini, apiKey: key });
    $("#suMsg").textContent = "Checking the key…";
    try { const m = await EO.testKey(key); EO.toast("All set. Gemini (" + m + ") is ready."); }
    catch (e) { EO.toast("Saved, but the key test failed: " + EO.geminiFriendly(e), "bad"); }
    $("#suMsg").textContent = "";
    renderWho();
    renderSetup();
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
      if (res.truncated) o.checks.unshift({ id: EO.uid(), text: "Gemini's answer was cut short: compare the last items with the customer's order.", resolved: false });
      if (!o.items.length) o.items.push(EO.blankItem());
      o.readBy = res.model;
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
        el("b", { text: str(o.customer.name) || "Customer not named" }),
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
    const hit = o => !q || [o.orderNo, o.customer.name, o.customerPo, o.customer.contact].concat(o.items.map(i => i.product + " " + i.styleRef))
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
    order = upgrade(o);
    openReview();
  }
  async function copyOrder(id) {
    const o = await EO.getOrder(id);
    if (!o) return;
    const c = upgrade(JSON.parse(JSON.stringify(o)));
    Object.assign(c, { id: EO.uid(), orderNo: "", rev: 0, issuedAt: 0, issuedDate: "", sharedRev: 0, changedSinceIssue: false, createdAt: Date.now(), updatedAt: Date.now(), orderDate: EO.todayISO(), shipBy: "", customerPo: "", readBy: "", warnings: [] });
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
  // Orders saved by older versions of the page get any fields they lack.
  function upgrade(o) {
    const b = EO.blankOrder();
    for (const k of Object.keys(b)) if (o[k] === undefined) o[k] = b[k];
    for (const k of ["customer", "artwork", "schedule", "packing"]) o[k] = Object.assign({}, b[k], o[k]);
    o.items = (o.items || []).map(it => Object.assign(EO.blankItem(), it));
    return o;
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
      const n = el("div", { class: "note good" },
        el("div", { text: order.readBy ? "Read by Gemini (" + order.readBy + "). Check every quantity against the customer's order before you make the sheet." : "Check every quantity against the customer's order." }));
      if (order.warnings && order.warnings.length) n.append(el("ul", null, order.warnings.map(w => el("li", { text: w }))));
      parts.push(n);
    }

    parts.push(el("div", { id: "checksHost" }));

    const nextNo = EO.peekNextNumber().text;
    parts.push(panel("Order", null, el("div", { class: "grid" },
      field("Order no.", order, "orderNo", { mono: true, ph: nextNo, help: order.orderNo ? "" : "Given automatically when you make the sheet." }),
      field("Customer PO", order, "customerPo", { mono: true }),
      field("Order received", order, "orderDate", { type: "date" }),
      field("Ship by", order, "shipBy", { type: "date", ph: "date or e.g. ASAP" }),
      field("Priority", order, "priority", { type: "select", options: EO.PRIORITIES }),
      field("Prepared by", order, "preparedBy", { ph: s.name })
    )));

    const c = order.customer;
    parts.push(panel("Customer", null, el("div", { class: "grid" },
      field("Customer / club / brand", c, "name", { cls: "s2", onInput: refreshSums }),
      field("Contact person", c, "contact"),
      field("Phone", c, "phone", { mono: true }),
      field("Email", c, "email", { cls: "s2" }),
      field("Ship to", c, "shipTo", { type: "area", cls: "s2", rows: 3 })
    )));

    const itemsHost = el("div", { id: "itemsHost", style: "display:flex;flex-direction:column;gap:14px" });
    parts.push(panel("Items", "One card per garment. Colours down, sizes across.", [
      itemsHost,
      el("div", { class: "btnrow" }, el("button", { type: "button", class: "btn", onclick: () => { order.items.push(EO.blankItem()); touched(); renderItems(); } }, icon("plus"), "Add item"))
    ]));

    const a = order.artwork;
    parts.push(panel("Artwork & decoration", null, el("div", { class: "grid" },
      field("Files received", a, "files", { cls: "s2", ph: "logo files, mockups, what's still missing" }),
      field("Colour codes / Pantone", a, "colourCodes", { cls: "s2" }),
      field("Names & numbers", a, "namesNumbers", { cls: "s2", ph: "e.g. Back names + numbers, roster attached" }),
      field("Pre-production sample", a, "sample", { cls: "s2", ph: "e.g. 1 sample per style, approve before bulk" }),
      field("Artwork notes", a, "notes", { type: "area", cls: "full", rows: 2 })
    )));

    const picsHost = el("div", { id: "picsHost" });
    const picIn = el("input", { type: "file", accept: "image/*,.pdf", multiple: true, hidden: true, onchange: e => { addPictureFiles(e.target.files); e.target.value = ""; } });
    parts.push(panel("Artwork & reference pictures", "Printed on the sheet with their item number", [
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
      field("Shipping method", p, "shipping", { cls: "s2" }),
      field("Notes for production", order, "notes", { type: "area", cls: "full", rows: 3 })
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
      el("p", { class: "lead", text: open ? "Unticked lines print in an orange box at the top of the sheet. Tick a line once it's confirmed or fixed." : "Nothing open. Add anything you still need to confirm." }),
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
        el("div", { class: "t" }, el("b", { text: str(order.customer.name) || "Customer not named yet" }),
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
      field("Style ref", it, "styleRef", { mono: true }),
      field("Decoration", it, "decoration", { ph: "Embroidery, Screen print, DTF…" }),
      coloursField,
      field("Fabric & weight", it, "fabric", { cls: "s2", ph: "e.g. Fleece 320 gsm, 80/20 cotton-poly" }),
      field("Placements", it, "placements", { cls: "s2", ph: "e.g. Left chest 8 cm, full back 28 cm" }),
      field("Trims & labels", it, "trims", { cls: "full", ph: "zips, drawcords, rib, neck label, hangtag…" }),
      field("Item notes", it, "notes", { type: "area", cls: "full", rows: 2 }));

    const gridHost = el("div");
    const drawGrid = () => gridHost.replaceChildren(qtyEditor(it, drawGrid));
    drawGrid();

    const stated = field("Customer's own total", it, "statedTotal", { mono: true, number: true, ph: "if they wrote one", help: "Only used to check the sizes add up." });
    stated.style.maxWidth = "220px";

    return el("div", { class: "item" }, head, el("div", { class: "item-body" }, specs, gridHost, stated, rosterEditor(it, drawGrid)));
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
    const p = { id: EO.uid(), name: "", number: "", size: "", qty: "", notes: "" };
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
    const draw = () => {
      const rows = it.roster.map((p, i) => {
        const inp = (k, w, ph) => {
          const x = el("input", { value: p[k] == null ? "" : p[k], placeholder: ph || "", style: w ? "width:" + w : "" , "aria-label": k });
          x.addEventListener("input", () => { p[k] = k === "qty" ? (x.value === "" ? "" : int(x.value)) : x.value; touched(); sum.textContent = "Roster: names & numbers (" + it.roster.length + ")"; });
          return el("td", null, x);
        };
        return el("tr", null, el("td", { class: "mono", style: "color:var(--muted);width:30px", text: String(i + 1) }),
          inp("name", "", "Name"), inp("number", "70px", "No."), inp("size", "70px", "Size"), inp("qty", "60px", "1"), inp("notes", "", ""),
          el("td", null, iconBtn("x", "Remove player", () => { it.roster.splice(i, 1); touched(); draw(); }, "danger")));
      });
      const paste = el("textarea", { class: "in", rows: 3, placeholder: "Paste a list, one player per line: Name, Number, Size (Excel columns work too)" });
      body.replaceChildren(
        it.roster.length ? el("div", { style: "overflow-x:auto" }, el("table", { class: "roster" },
          el("thead", null, el("tr", null, ["#", "Name", "Number", "Size", "Qty", "Notes", ""].map(h => el("th", { text: h })))),
          el("tbody", null, rows))) : el("div", { class: "help", text: "For team orders: player names, numbers and sizes. Leave empty if there's none." }),
        el("div", { class: "btnrow" },
          el("button", { type: "button", class: "btn small", onclick: () => { it.roster.push({ id: EO.uid(), name: "", number: "", size: "", qty: "", notes: "" }); touched(); draw(); } }, icon("plus"), "Player"),
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
      sum.textContent = "Roster: names & numbers (" + it.roster.length + ")";
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
      ? el("div", { class: "note" }, open.length + (open.length === 1 ? " thing is" : " things are") + " still to confirm with the customer. " + (open.length === 1 ? "It's" : "They're") + " printed in the orange box at the top of the sheet.")
      : el("div", { class: "note good", text: "Everything is confirmed. Download the PDF for production, or print it." }));
    const prev = $("#preview");
    prev.replaceChildren(el("div", { class: "progress", style: "width:100%;max-width:820px" }, el("div", { class: "spin" }), el("div", { class: "msg", text: "Drawing the sheet…" })));
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
  function openSettings() {
    const s = EO.settings();
    $("#stName").value = s.name; $("#stIni").value = s.initials; $("#stKey").value = s.apiKey;
    $("#stKey").type = "password"; $("#stKeyShow").textContent = "Show";
    $("#stCo").value = s.companyName; $("#stTag").value = s.companyTagline;
    const p = EO.peekNextNumber();
    $("#stNext").value = p.n; nextEdited = false;
    $("#stNextPrev").textContent = p.text;
    $("#stKeyMsg").replaceChildren("Free key from ", el("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener", text: "aistudio.google.com/apikey" }), ". It stays in this browser only.");
    $("#stLinkMsg").textContent = "";
    setLogo(s.logo);
    $("#settings").showModal();
  }
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
  $("#stSave").addEventListener("click", e => {
    e.preventDefault();
    const ini = EO.cleanInitials($("#stIni").value);
    EO.saveSettings({
      name: str($("#stName").value), initials: ini, apiKey: str($("#stKey").value),
      companyName: str($("#stCo").value) || "Ennoble International", companyTagline: $("#stTag").value, logo: pendingLogo
    });
    if (nextEdited && ini) EO.setNextNumber(int($("#stNext").value) || 1);
    $("#settings").close();
    renderWho(); renderSetup();
    if (order && !$("#view-review").hidden) renderReview();
    EO.toast("Settings saved.");
  });
  $("#stBackup").addEventListener("click", async () => {
    const all = await EO.listOrders();
    const blob = new Blob([JSON.stringify({ app: "ennoble-order-sheet", version: 1, exportedAt: new Date().toISOString(), orders: all })], { type: "application/json" });
    EO.downloadBlob(blob, "ennoble-orders-backup-" + EO.todayISO() + ".json");
  });
  $("#stRestore").addEventListener("click", () => $("#stRestoreIn").click());
  $("#stRestoreIn").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data.orders) ? data.orders : [];
      for (const o of list) if (o && o.id && o.items) await EO.saveOrder(upgrade(o));
      EO.toast(list.length + " orders restored.");
      renderRecent();
    } catch (err) { EO.toast("That isn't an order backup file.", "bad"); }
  });

  /* ======================= nav + start ======================= */
  $("#goHome").addEventListener("click", goHome);
  $("#navNew").addEventListener("click", goHome);
  $("#navOrders").addEventListener("click", async () => { persist.flush(); show("orders"); await renderOrders(); });
  $("#btnAllOrders").addEventListener("click", async () => { show("orders"); await renderOrders(); });
  $("#navSettings").addEventListener("click", openSettings);
  $("#btnNew2").addEventListener("click", goHome);
  window.addEventListener("beforeunload", () => persist.flush());

  readSetupLink();
  window.addEventListener("hashchange", () => { if (readSetupLink()) renderSetup(); });
  renderWho();
  goHome();

  // Exposed for tests and the console.
  EO.app = { get order() { return order; }, openOrder, makeSheet, renderReview };
})(window.EO);
