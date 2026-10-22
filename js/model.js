/* The order record: one shape for every customer, every garment, every size system. */
(function (EO) {
  "use strict";
  const str = EO.str, int = EO.int;

  EO.PRIORITIES = ["Standard", "Rush", "Sample run", "Repeat order"];

  EO.blankRow = (colour) => ({ id: EO.uid(), colour: colour || "", q: {}, stated: null });
  EO.blankPlayer = () => ({ id: EO.uid(), name: "", number: "", size: "", qty: "", notes: "", extra: {} });
  EO.blankItem = () => ({
    id: EO.uid(), group: "", product: "", styleRef: "", decoration: "", fabric: "", colours: "",
    fit: "", sides: "", placements: "", trims: "", specs: [], notes: "",
    sizes: [], rows: [], statedTotal: null, roster: [], rosterCols: []
  });
  // Customer contact details and delivery addresses are deliberately not part of the record:
  // the sheet goes to the floor and only carries what production needs.
  EO.blankOrder = function () {
    const s = EO.settings();
    return {
      id: EO.uid(), orderNo: "", rev: 0, createdAt: Date.now(), updatedAt: Date.now(), issuedAt: 0,
      customerPo: "", orderDate: EO.todayISO(), shipBy: "", priority: "Standard",
      preparedBy: s.name || "", issuedDate: "",
      customer: { name: "", team: "" },
      repeatOf: "", mockRef: "", sizeChart: "",
      approvals: { mockup: "", prePrint: "", confirmation: "", sample: "" },
      colourSpecs: [],
      items: [],
      artwork: { files: "", fonts: "", logos: "", namesNumbers: "", notes: "" },
      schedule: { cutting: "", stitching: "", qc: "", dispatch: "" },
      packing: { packing: "", labels: "", shipping: "" },
      notes: "", checks: [], resolvedAuto: [], pictures: [], sources: [], sourceText: "", aiUsage: null
    };
  };

  // Bring an order saved by an older version up to the current shape, dropping contact details.
  EO.upgradeOrder = function (o) {
    const b = EO.blankOrder();
    const oldCustomer = o.customer || {};
    const oldArtwork = o.artwork || {};
    for (const k of Object.keys(b)) if (o[k] === undefined) o[k] = b[k];
    o.customer = { name: str(oldCustomer.name), team: str(oldCustomer.team) };
    o.approvals = Object.assign({}, b.approvals, o.approvals);
    if (!o.approvals.sample && str(oldArtwork.sample)) o.approvals.sample = str(oldArtwork.sample);
    if (!o.colourSpecs.length && str(oldArtwork.colourCodes)) o.colourSpecs = [{ id: EO.uid(), name: str(oldArtwork.colourCodes), pantone: "", cmyk: "" }];
    o.artwork = { files: str(oldArtwork.files), fonts: str(oldArtwork.fonts), logos: str(oldArtwork.logos), namesNumbers: str(oldArtwork.namesNumbers), notes: str(oldArtwork.notes) };
    for (const k of ["schedule", "packing"]) o[k] = Object.assign({}, b[k], o[k]);
    o.items = (o.items || []).map(it => {
      const x = Object.assign(EO.blankItem(), it);
      x.roster = (x.roster || []).map(p => Object.assign(EO.blankPlayer(), p, { extra: Object.assign({}, p.extra) }));
      x.rosterCols = Array.isArray(x.rosterCols) ? x.rosterCols : [];
      x.specs = Array.isArray(x.specs) ? x.specs : [];
      return x;
    });
    return o;
  };

  /* ---------- sizes ---------- */
  const WORDS = [
    [/^(EXTRA[\s-]*SMALL|X[\s-]+SMALL|XSMALL)$/, "XS"],
    [/^(SMALL|SML|SM)$/, "S"],
    [/^(MEDIUM|MED|MD)$/, "M"],
    [/^(LARGE|LRG|LG)$/, "L"],
    [/^(EXTRA[\s-]*LARGE|X[\s-]*LARGE|XLARGE)$/, "XL"],
    [/^(ONE[\s-]*SIZE|OS|O\/S|FREE[\s-]*SIZE|ONESIZE)$/, "ONE SIZE"]
  ];
  // Tidy a size label without changing what the customer meant (XXL stays XXL).
  function word(s) {
    for (const [re, v] of WORDS) if (re.test(s)) return v;
    return s;
  }
  EO.normSize = function (label) {
    const s = str(label).replace(/\s+/g, " ").toUpperCase();
    if (!s) return "";
    const w = word(s);
    if (w !== s) return w;
    // "Youth Medium", "Y-M", "YOUTH L" -> YM / YL. Anything else (ages, waist sizes) is left alone.
    const m = /^(YOUTH|YTH|Y)[\s-]*(.+)$/.exec(s);
    if (m) { const rest = word(m[2]); if (ADULT.includes(rest)) return "Y" + rest; }
    return s;
  };

  const ADULT = ["XXXXS", "4XS", "XXXS", "3XS", "XXS", "2XS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "XXXXL", "4XL", "XXXXXL", "5XL", "6XL", "7XL", "8XL"];
  function rank(label) {
    const s = String(label).toUpperCase();
    if (s === "ONE SIZE") return [5, 0];
    if (/^(SIZE )?(TBC|TBD)$/.test(s)) return [9, 0];
    const a = ADULT.indexOf(s);
    if (a > -1) return [2, a];
    if (/^Y/.test(s) && ADULT.indexOf(s.slice(1)) > -1) return [1, ADULT.indexOf(s.slice(1))];
    // Kids' ages ("7-8YRS", "10Y", "6 YEARS") come before adult sizes.
    const age = /^(\d+)(\s*-\s*\d+)?\s*(Y|YR|YRS|YEARS?)$/.exec(s) || /^(\d+)\s*-\s*(\d+)$/.exec(s);
    if (age) return [0, Number(age[1])];
    const n = /^(\d+(?:\.\d+)?)/.exec(s);
    if (n) return [3, Number(n[1])];
    return null;
  }
  // Put sizes in the natural order when every label is recognisable; otherwise keep the order given.
  EO.sortSizes = function (list) {
    const ranks = list.map(rank);
    if (ranks.some(r => r === null)) return list.slice();
    return list.map((s, i) => ({ s, r: ranks[i], i }))
      .sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.i - y.i).map(x => x.s);
  };

  /* ---------- totals ---------- */
  EO.rowTotal = (item, row) => item.sizes.reduce((a, s) => a + int(row.q[s]), 0);
  EO.sizeTotal = (item, size) => item.rows.reduce((a, r) => a + int(r.q[size]), 0);
  EO.rosterTotal = item => (item.roster || []).reduce((a, p) => a + (p.qty === "" || p.qty == null ? 1 : int(p.qty)), 0);
  EO.gridTotal = item => item.rows.reduce((a, r) => a + EO.rowTotal(item, r), 0);
  EO.itemTotal = item => (item.rows.length ? EO.gridTotal(item) : EO.rosterTotal(item));
  EO.orderTotal = order => order.items.reduce((a, i) => a + EO.itemTotal(i), 0);
  EO.itemColours = function (item) {
    if (str(item.colours)) return str(item.colours);
    const seen = [];
    for (const r of item.rows) { const c = str(r.colour); if (c && !seen.includes(c)) seen.push(c); }
    return seen.join(", ");
  };
  EO.itemTitle = function (item) {
    const p = str(item.product) || "Untitled item";
    const g = str(item.group);
    if (!g || p.toUpperCase().startsWith(g.toUpperCase())) return p;
    return g + " · " + p;
  };

  // A roster with no size grid: count players per size so the cutters still get a grid.
  EO.gridFromRoster = function (item) {
    const counts = {};
    const order = [];
    for (const p of item.roster) {
      const sz = EO.normSize(p.size) || "Size TBC";
      if (!(sz in counts)) { counts[sz] = 0; order.push(sz); }
      counts[sz] += p.qty === "" || p.qty == null ? 1 : int(p.qty);
    }
    item.sizes = EO.sortSizes(order);
    const row = EO.blankRow(EO.itemColours(item));
    for (const s of item.sizes) row.q[s] = counts[s];
    item.rows = [row];
  };

  /* ---------- automatic checks: arithmetic the floor must not have to do ---------- */
  EO.autoChecks = function (order) {
    const out = [];
    const no = i => "Item " + EO.pad(i + 1, 2);
    // Skip a check when the customer questions already cover it (Gemini often lists the same gap).
    const asked = (re, product) => order.checks.some(c => re.test(c.text) && (!product || c.text.toLowerCase().indexOf(String(product).toLowerCase().split(" ")[0]) > -1 || /TBD|TBC|confirm/i.test(c.text)));
    if (!order.items.length) out.push("No items on this order yet.");
    order.items.forEach((it, i) => {
      const t = EO.itemTotal(it);
      if (!t) out.push(no(i) + " (" + (str(it.product) || "untitled") + ") has no quantities.");
      if (it.statedTotal != null && it.statedTotal !== "" && int(it.statedTotal) !== t)
        out.push(no(i) + ": the customer's total says " + int(it.statedTotal) + " pcs but the sizes add up to " + t + ".");
      it.rows.forEach(r => {
        if (r.stated != null && r.stated !== "" && int(r.stated) !== EO.rowTotal(it, r))
          out.push(no(i) + ", " + (str(r.colour) || "colour row") + ": stated " + int(r.stated) + " pcs but the sizes add up to " + EO.rowTotal(it, r) + ".");
        if (/^(TBD|TBC|\?)|\b(TBD|TBC)\b/i.test(str(r.colour)) && !asked(/colou?r/i, it.product))
          out.push(no(i) + ": a colour is still to be confirmed.");
      });
      if (it.roster.length && it.rows.length) {
        const rt = EO.rosterTotal(it), gt = EO.gridTotal(it);
        if (rt !== gt) out.push(no(i) + ": the roster has " + rt + " players but the size grid has " + gt + " pcs.");
      }
      if (it.sizes.some(s => /TBC|TBD/i.test(s))) out.push(no(i) + ": the size split is not confirmed.");
    });
    if (!str(order.shipBy) && !asked(/deliver|ship|dispatch|deadline|due|date/i)) out.push("No ship-by date given.");
    return Array.from(new Set(out));
  };
  // Everything still open, customer questions first.
  EO.openChecks = function (order) {
    const manual = order.checks.filter(c => !c.resolved && str(c.text)).map(c => str(c.text));
    const auto = EO.autoChecks(order).filter(t => !order.resolvedAuto.includes(t));
    return manual.concat(auto);
  };

  const pairs = list => (Array.isArray(list) ? list : [])
    .map(x => ({ id: EO.uid(), label: str(x && x.label), value: str(x && x.value) }))
    .filter(x => x.label || x.value);

  /* ---------- turn Gemini's answer into an order ---------- */
  EO.orderFromAI = function (ai, pictures, sources, sourceText) {
    const o = EO.blankOrder();
    const od = ai.order || {};
    o.customerPo = str(od.customer_order_code || od.customer_po);
    o.orderDate = EO.isISODate(od.order_date) ? str(od.order_date) : EO.todayISO();
    o.shipBy = str(od.ship_by);
    const pr = str(od.priority).toLowerCase();
    o.priority = EO.PRIORITIES.find(p => p.toLowerCase().startsWith(pr.split(" ")[0] || "-")) || "Standard";
    o.repeatOf = str(od.repeat_of);
    o.mockRef = str(od.mock_ref);
    o.sizeChart = str(od.size_chart);

    const c = ai.customer || {};
    o.customer = { name: str(c.name), team: str(c.team) };

    const ap = ai.approvals || {};
    o.approvals = {
      mockup: str(ap.mockup_required), prePrint: str(ap.pre_print_test),
      confirmation: str(ap.manufacturer_confirmation), sample: str(ap.pre_production_sample)
    };
    o.colourSpecs = (Array.isArray(ai.colour_specs) ? ai.colour_specs : [])
      .map(x => ({ id: EO.uid(), name: str(x.name), pantone: str(x.pantone), cmyk: str(x.cmyk) }))
      .filter(x => x.name || x.pantone || x.cmyk);

    o.items = (Array.isArray(ai.items) ? ai.items : []).map(raw => {
      const it = EO.blankItem();
      it.group = str(raw.group);
      it.product = str(raw.product);
      it.styleRef = str(raw.style_ref);
      it.fabric = str(raw.fabric);
      it.colours = str(raw.colours);
      it.decoration = str(raw.decoration);
      it.fit = str(raw.fit);
      it.sides = str(raw.single_or_reversible);
      it.placements = str(raw.placements);
      it.trims = str(raw.trims_labels);
      it.specs = pairs(raw.specs);
      it.notes = str(raw.notes);
      it.statedTotal = EO.intOrNull(raw.stated_total);

      const sizeOrder = [];
      const addSize = s => { if (s && !sizeOrder.includes(s)) sizeOrder.push(s); };
      (Array.isArray(raw.sizes) ? raw.sizes : []).forEach(s => addSize(EO.normSize(s)));
      const rows = Array.isArray(raw.colour_rows) ? raw.colour_rows : [];
      it.rows = rows.map(r => {
        const row = EO.blankRow(str(r.colour));
        row.stated = EO.intOrNull(r.stated_total);
        (Array.isArray(r.breakdown) ? r.breakdown : []).forEach(b => {
          const s = EO.normSize(b.size) || "Size TBC";
          addSize(s);
          row.q[s] = int(row.q[s]) + int(b.qty);
        });
        return row;
      }).filter(r => str(r.colour) || Object.keys(r.q).length);
      it.sizes = EO.sortSizes(sizeOrder.filter(s => it.rows.some(r => int(r.q[s]) > 0) || !it.rows.length));
      if (!it.sizes.length && it.rows.length) it.sizes = sizeOrder;

      // Rosters: the four fixed columns plus whatever else the customer lists per player.
      const cols = [];
      it.roster = (Array.isArray(raw.roster) ? raw.roster : []).map(p => {
        const pl = EO.blankPlayer();
        Object.assign(pl, { name: str(p.name), number: str(p.number), size: EO.normSize(p.size), qty: p.qty == null || p.qty === "" ? "" : int(p.qty), notes: str(p.notes) });
        (Array.isArray(p.extra) ? p.extra : []).forEach(x => {
          const label = str(x && x.label), value = str(x && x.value);
          if (!label || !value) return;
          const key = cols.find(k => k.toLowerCase() === label.toLowerCase()) || label;
          if (!cols.includes(key)) cols.push(key);
          pl.extra[key] = value;
        });
        return pl;
      }).filter(p => p.name || p.number || p.size);
      it.rosterCols = cols.slice(0, 6);
      if (it.roster.length && (!it.rows.length || !EO.gridTotal(it))) EO.gridFromRoster(it);
      if (!it.colours) it.colours = EO.itemColours(it);
      return it;
    }).filter(it => it.product || it.rows.length || it.roster.length);

    const a = ai.artwork || {};
    o.artwork = {
      files: str(a.files_received), fonts: str(a.fonts), logos: str(a.logos),
      namesNumbers: str(a.names_numbers), notes: str(a.notes)
    };
    const p = ai.packing || {};
    o.packing = { packing: str(p.packing), labels: str(p.labels_tags), shipping: str(p.shipping_method) };
    o.notes = str(ai.production_notes);
    o.checks = (Array.isArray(ai.questions) ? ai.questions : []).map(str).filter(Boolean)
      .map(t => ({ id: EO.uid(), text: t, resolved: false }));

    // Pictures: keep what Gemini says is useful, with its caption and item. Size charts stay general.
    const info = {};
    (Array.isArray(ai.pictures) ? ai.pictures : []).forEach(pi => { if (pi && pi.id) info[String(pi.id).toUpperCase()] = pi; });
    o.pictures = (pictures || []).map(pic => {
      const meta = info[pic.ref] || {};
      if (meta.keep === false) return null;
      const n = EO.int(meta.item_number);
      const item = n >= 1 && n <= o.items.length ? o.items[n - 1].id : "";
      return { id: EO.uid(), dataUrl: pic.dataUrl, w: pic.w, h: pic.h, caption: str(meta.caption) || pic.name || "", item };
    }).filter(Boolean);

    o.sources = sources || [];
    o.sourceText = sourceText || "";
    return o;
  };
})(window.EO);
