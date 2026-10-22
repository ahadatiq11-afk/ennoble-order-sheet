/* The Ennoble production order sheet as a PDF (pdfmake, standard Helvetica/Courier). One layout for every order,
   in the Ennoble colours: red, black and white. */
(function (EO) {
  "use strict";

  const RED = "#CC0000", INK = "#111111", MUTED = "#6B6B6B", LINE = "#CFCFCF", SOFT = "#F2F2F2", RED_SOFT = "#FBEAEA";
  const PAGE_W = 595.28, MARGIN_X = 34, CONTENT_W = PAGE_W - MARGIN_X * 2;
  const DASH = "—";

  /* Standard PDF fonts only know Windows-1252. Map what we can, mark the rest. */
  const WIN = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const SUBS = {
    "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "Ŋ": "N", "ŋ": "n",
    "Ŧ": "T", "ŧ": "t", "Ŀ": "L", "ŀ": "l", "→": "->", "←": "<-", "✓": "OK", "✔": "OK",
    "≥": ">=", "≤": "<=", "″": '"', "′": "'", "−": "-", " ": " ", "‑": "-", "‐": "-", "‒": "-", "―": DASH
  };
  function t(s) {
    s = String(s == null ? "" : s);
    let out = "";
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if ((c >= 32 && c <= 126) || c === 10 || (c >= 160 && c <= 255) || WIN.indexOf(ch) > -1) { out += ch; continue; }
      if (c === 9) { out += "  "; continue; }
      if (c === 13) continue;
      if (SUBS[ch]) { out += SUBS[ch]; continue; }
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\x7E]+$/.test(base) ? base : "?";
    }
    return out;
  }
  const has = s => !!EO.str(s);
  const v = s => (has(s) ? t(EO.str(s)) : DASH);
  const up = s => t(String(s || "").toUpperCase());

  /* ---------- building blocks ---------- */
  const noPad = { paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 };
  const gridLayout = Object.assign({
    hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => LINE, vLineColor: () => LINE
  }, noPad);
  const qtyLayout = Object.assign({}, gridLayout, {
    paddingTop: () => 2.6, paddingBottom: () => 2.6, paddingLeft: () => 2, paddingRight: () => 2
  });

  function cell(label, value, o) {
    o = o || {};
    const empty = value == null || value === "" || value === DASH;
    const c = {
      stack: [
        { text: up(label), fontSize: 5.6, color: o.dark ? "#BBBBBB" : MUTED, characterSpacing: 0.45 },
        {
          text: empty ? DASH : value, fontSize: o.big ? 13 : 8.4, font: o.mono ? "Courier" : "Helvetica", bold: !!o.bold,
          color: o.dark ? "#FFFFFF" : empty ? MUTED : (o.red ? RED : INK), margin: [0, 2, 0, 0], lineHeight: 1.12
        }
      ],
      margin: [5, 4, 5, 4.5]
    };
    if (o.dark) c.fillColor = INK;
    else if (o.fill) c.fillColor = o.fill;
    if (o.span) c.colSpan = o.span;
    return c;
  }
  // A 4-column row from cells; colSpan placeholders added automatically.
  function row4(cells) {
    const out = [];
    for (const c of cells) { out.push(c); for (let i = 1; i < (c.colSpan || 1); i++) out.push({}); }
    return out;
  }
  function grid4(rows) {
    return { table: { widths: ["*", "*", "*", "*"], body: rows.map(row4), dontBreakRows: true }, layout: gridLayout };
  }
  function section(title) {
    return {
      stack: [
        { columns: [
          { canvas: [{ type: "rect", x: 0, y: 0.5, w: 4, h: 8.5, color: RED }], width: 9 },
          { text: up(title), bold: true, fontSize: 8, characterSpacing: 0.6, color: INK }
        ] },
        { canvas: [{ type: "line", x1: 0, y1: 3, x2: CONTENT_W, y2: 3, lineWidth: 0.8, lineColor: INK }] }
      ],
      margin: [0, 10, 0, 5]
    };
  }
  // A heading and the block under it go to the same page. (pdfmake's pageBreakBefore re-runs the
  // layout and can leave a page empty, so headings are kept with their content structurally.)
  function keep(head, first) {
    return { stack: [head, first], unbreakable: true };
  }
  // A boxed notice: production notes and the open questions.
  function notice(title, body, o) {
    return {
      table: { widths: ["*"], body: [[{
        stack: [{ text: up(title), bold: true, fontSize: 7.4, characterSpacing: 0.5, color: o.titleColor || RED, margin: [0, 0, 0, 3] }].concat(body),
        fillColor: o.fill || "#FFFFFF", margin: [8, 6, 8, 7]
      }]] },
      layout: Object.assign({
        hLineWidth: () => 0.8, vLineWidth: i => (i === 0 ? 4 : 0.8),
        hLineColor: () => o.line || RED, vLineColor: () => o.line || RED
      }, noPad),
      margin: [0, 10, 0, 0]
    };
  }

  /* ---------- pictures ---------- */
  // size: { wide, pair, cols } = max height of a full-width picture, max height of a smaller one, pictures per row.
  function pictureGrid(pics, itemIndex, size) {
    if (!pics.length) return [];
    const cols = size.cols || 2;
    const label = p => {
      const n = itemIndex[p.item];
      return [{ text: n != null ? "ITEM " + EO.pad(n + 1, 2) + "  " : "", font: "Courier", bold: true, color: RED }, t(p.caption || "")];
    };
    const box = (p, w, h) => ({
      stack: [
        { image: p.dataUrl, fit: [w, h], alignment: "center", margin: [0, 4, 0, 3] },
        { text: label(p), fontSize: 6.4, color: MUTED, margin: [5, 0, 5, 4] }
      ]
    });
    const rows = [];
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const cells = group.map(p => box(p, CONTENT_W / cols - 14, size.pair));
      while (cells.length < cols) cells.push({ text: "" });
      rows.push(cells);
      group = [];
    };
    for (const p of pics) {
      // Wide pictures (size charts, flat CADs) get the full width so their small print stays readable.
      const wide = (p.w || 1) / (p.h || 1) > 1.55 || /size chart/i.test(p.caption || "");
      if (wide) {
        flush();
        const cell = box(p, CONTENT_W - 14, size.wide);
        cell.colSpan = cols;
        rows.push([cell].concat(Array.from({ length: cols - 1 }, () => ({}))));
      } else {
        group.push(p);
        if (group.length === cols) flush();
      }
    }
    flush();
    const widths = Array.from({ length: cols }, () => "*");
    return rows.map((row, i) => ({
      stack: [{ table: { widths, body: [row] }, layout: gridLayout }],
      unbreakable: true,
      margin: [0, i ? 0 : 6, 0, 0]
    }));
  }

  /* ---------- item ---------- */
  function itemHeader(item, i) {
    const tags = [];
    if (/revers/i.test(item.sides || "")) tags.push("REVERSIBLE");
    return {
      table: {
        widths: ["auto", "*", "auto"],
        body: [[
          { text: "ITEM " + EO.pad(i + 1, 2), font: "Courier", bold: true, fontSize: 8, color: "#FFFFFF", fillColor: RED, margin: [7, 5.5, 7, 4.5] },
          { text: up(EO.itemTitle(item)), bold: true, fontSize: 10.5, color: "#FFFFFF", fillColor: INK, margin: [8, 4.5, 6, 3.5] },
          {
            text: [tags.length ? { text: tags.join("  ") + "    ", fontSize: 7, color: "#FF8A8A", font: "Helvetica" } : "", EO.itemTotal(item) + " PCS"],
            font: "Courier", bold: true, fontSize: 9.5, color: "#FFFFFF", fillColor: INK, alignment: "right", margin: [6, 5, 8, 3.5]
          }
        ]]
      },
      layout: Object.assign({ hLineWidth: () => 0, vLineWidth: () => 0 }, noPad)
    };
  }
  function itemSpecs(item) {
    const rows = [
      [cell("Style / mock ref", v(item.styleRef), { mono: true }), cell("Print method", v(item.decoration), { bold: true }), cell("Fabric", v(item.fabric), { span: 2 })],
      [cell("Colours", v(EO.itemColours(item)), { span: 2 }), cell("Cut / fit", v(item.fit)), cell("Single / reversible", v(item.sides))],
      [cell("Logos & placements", v(item.placements), { span: 2 }), cell("Trims & labels", v(item.trims), { span: 2 })]
    ];
    if (has(item.notes)) rows.push([cell("Item notes", v(item.notes), { span: 4 })]);
    const out = [grid4(rows)];
    const specs = (item.specs || []).filter(x => has(x.label) || has(x.value));
    if (specs.length) {
      out.push({
        table: {
          widths: [118, "*"],
          body: specs.map(x => [
            { text: up(x.label || "Detail"), fontSize: 6.4, bold: true, color: INK, fillColor: SOFT, margin: [5, 3.5, 5, 3], characterSpacing: 0.3 },
            { text: v(x.value), fontSize: 8.2, margin: [6, 3, 6, 3], lineHeight: 1.12 }
          ]),
          dontBreakRows: true
        },
        layout: gridLayout
      });
    }
    return out;
  }
  function itemGrid(item) {
    const sizes = item.sizes.length ? item.sizes : ["QTY"];
    const many = sizes.length > 11;
    const fs = many ? 7 : 9;
    const widths = [many ? 64 : 92].concat(sizes.map(() => "*"), [many ? 30 : 40]);
    const head = [{ text: "COLOUR / VARIANT", fontSize: 5.8, bold: true, color: INK, fillColor: SOFT, characterSpacing: 0.3, margin: [3, 1, 0, 0] }]
      .concat(sizes.map(s => ({ text: up(s), font: "Courier", bold: true, fontSize: many ? 6 : 7, alignment: "center", fillColor: SOFT })),
        [{ text: "TOTAL", fontSize: 6, alignment: "center", bold: true, color: RED, fillColor: RED_SOFT, characterSpacing: 0.3 }]);
    const body = [head];
    const qty = n => (n ? { text: String(n), font: "Courier", bold: true, fontSize: fs, alignment: "center" } : { text: "·", color: LINE, alignment: "center", fontSize: fs });
    const rows = item.rows.length ? item.rows : [EO.blankRow("")];
    for (const r of rows) {
      body.push([{ text: v(r.colour), fontSize: many ? 6.8 : 7.9, margin: [3, 0.5, 2, 0] }]
        .concat(sizes.map(s => qty(EO.int(r.q[s]))),
          [{ text: String(EO.rowTotal(item, r)), font: "Courier", bold: true, fontSize: fs, alignment: "center", fillColor: RED_SOFT }]));
    }
    if (rows.length > 1) {
      body.push([{ text: "TOTAL", bold: true, fontSize: 6.6, characterSpacing: 0.3, fillColor: SOFT, margin: [3, 1, 0, 0] }]
        .concat(sizes.map(s => ({ text: String(EO.sizeTotal(item, s)), font: "Courier", bold: true, fontSize: fs, alignment: "center", fillColor: SOFT })),
          [{ text: String(EO.gridTotal(item)), font: "Courier", bold: true, fontSize: fs + 0.6, alignment: "center", color: "#FFFFFF", fillColor: RED }]));
    }
    return { table: { widths, body, headerRows: 1, dontBreakRows: true }, layout: qtyLayout };
  }
  function itemRoster(item) {
    if (!item.roster.length) return null;
    const extras = (item.rosterCols || []).filter(k => item.roster.some(p => has(p.extra && p.extra[k])));
    const withNotes = item.roster.some(p => has(p.notes));
    const small = extras.length > 3;
    const fs = small ? 6.8 : 7.6;
    const head = ["#", "NAME", "NUMBER", "SIZE", "QTY"].concat(extras.map(up), withNotes ? ["NOTES"] : [])
      .map(h => ({ text: h, fontSize: 5.8, bold: true, color: INK, fillColor: SOFT, characterSpacing: 0.2 }));
    const body = [head].concat(item.roster.map((p, i) => [
      { text: String(i + 1), font: "Courier", fontSize: 6.8, color: MUTED },
      { text: t(p.name) || DASH, fontSize: fs, bold: true },
      { text: t(p.number) || DASH, font: "Courier", bold: true, fontSize: fs + 0.4, alignment: "center", color: RED },
      { text: t(p.size) || DASH, font: "Courier", bold: true, fontSize: fs, alignment: "center" },
      { text: String(p.qty === "" || p.qty == null ? 1 : EO.int(p.qty)), font: "Courier", fontSize: fs, alignment: "center" }
    ].concat(
      extras.map(k => ({ text: t((p.extra && p.extra[k]) || ""), fontSize: fs - 0.4 })),
      withNotes ? [{ text: t(p.notes), fontSize: fs - 0.6, color: MUTED }] : []
    )));
    const longest = item.roster.reduce((m, p) => Math.max(m, t(p.size).length), 4);
    const widths = [14, small ? 62 : "*", 36, Math.min(58, 12 + longest * 5.4), 22].concat(extras.map(() => "*"), withNotes ? ["*"] : []);
    const title = [{ text: "PLAYERS " + DASH + " NAMES, NUMBERS & SIZES (" + EO.rosterTotal(item) + " PCS)", colSpan: widths.length, fontSize: 6.2, bold: true, color: RED, characterSpacing: 0.4, border: [false, false, false, true], margin: [0, 5, 0, 1] }]
      .concat(Array.from({ length: widths.length - 1 }, () => ({})));
    return {
      table: { widths, body: [title].concat(body), headerRows: 2, keepWithHeaderRows: 1, dontBreakRows: true },
      layout: qtyLayout,
      unbreakable: item.roster.length <= 12
    };
  }
  function itemBlock(item, i, pics, itemIndex, size) {
    const top = { stack: [itemHeader(item, i)].concat(itemSpecs(item)), unbreakable: true };
    const grid = itemGrid(item);
    const roster = itemRoster(item);
    const pg = pictureGrid(pics, itemIndex, size);
    const small = item.rows.length <= 14 && !roster && !(item.specs || []).length;
    const parts = small ? [{ stack: [itemHeader(item, i)].concat(itemSpecs(item), [grid]), unbreakable: true }] : [top, grid];
    return { stack: parts.concat(roster ? [roster] : [], pg), margin: [0, 0, 0, 12] };
  }

  /* ---------- the document ---------- */
  const LAYOUTS = [
    { place: "items", wide: 330, pair: 200, cols: 2 },
    { place: "items", wide: 250, pair: 160, cols: 2 },
    { place: "items", wide: 190, pair: 125, cols: 2 },
    { place: "end", wide: 260, pair: 165, cols: 2 },
    { place: "end", wide: 190, pair: 120, cols: 3 }
  ];
  EO.buildSheetDoc = function (order, logo, layout) {
    layout = layout || LAYOUTS[0];
    const s = EO.settings();
    const no = order.orderNo || "DRAFT";
    const rev = order.rev > 1 ? "R" + order.rev : "R1";
    const total = EO.orderTotal(order);
    const c = order.customer || {};
    const ap = order.approvals || {};
    const itemIndex = {};
    order.items.forEach((it, i) => { itemIndex[it.id] = i; });
    const pictures = layout.none ? [] : order.pictures;
    const picsFor = id => (layout.place === "end" ? [] : pictures.filter(p => p.item === id));
    const general = layout.place === "end"
      ? pictures.slice().sort((a, b) => (a.item in itemIndex ? itemIndex[a.item] : 999) - (b.item in itemIndex ? itemIndex[b.item] : 999))
      : pictures.filter(p => !(p.item in itemIndex));
    const yes = x => (/^(yes|y|required|true)\b/i.test(EO.str(x)) ? { bold: true, red: true } : {});

    const content = [];
    if (order.priority === "Rush") {
      content.push({
        table: { widths: ["*"], body: [[{
          text: [{ text: "URGENT", bold: true, fontSize: 13, characterSpacing: 1 }, has(order.shipBy) ? { text: "     SHIP BY " + up(EO.humanDate(order.shipBy)), bold: true, fontSize: 10 } : ""],
          color: "#FFFFFF", fillColor: RED, alignment: "center", margin: [6, 6, 6, 5]
        }]] },
        layout: Object.assign({ hLineWidth: () => 0, vLineWidth: () => 0 }, noPad),
        margin: [0, 0, 0, 8]
      });
    }
    content.push(grid4([
      [cell("Customer / brand", v(c.name), { bold: true }), cell("Team / design", v(c.team), { bold: true, span: 2 }), cell("Customer order code", v(order.customerPo), { mono: true, bold: true })],
      [cell("Order received", v(EO.humanDate(order.orderDate)), { mono: true }), cell("Ship by", v(EO.humanDate(order.shipBy)), { mono: true, bold: true, red: has(order.shipBy) }),
        cell("Priority", v(order.priority), { bold: order.priority !== "Standard", red: order.priority === "Rush" }), cell("Total pieces", String(total), { mono: true, bold: true, big: true, dark: true })],
      [cell("Mock / design ref", v(order.mockRef), { mono: true }), cell("Size chart", v(order.sizeChart)), cell("Repeat of / based on", v(order.repeatOf), { span: 2 })],
      [cell("Items", String(order.items.length), { mono: true }), cell("Prepared by", v(order.preparedBy)), cell("Sheet issued", v(EO.humanDate(order.issuedDate || EO.todayISO())), { mono: true }), cell("Revision", rev, { mono: true, bold: order.rev > 1, red: order.rev > 1 })]
    ]));

    if (has(order.notes)) {
      content.push(notice("Production notes " + DASH + " read first", [{ text: t(order.notes), fontSize: 9.4, bold: true, lineHeight: 1.18, color: INK }], { fill: "#FFFFFF", line: INK, titleColor: RED }));
    }
    const open = EO.openChecks(order);
    if (open.length) {
      content.push(notice("Check before production " + DASH + " confirm with customer", [{ ul: open.map(x => ({ text: t(x), fontSize: 8.2, margin: [0, 0.5, 0, 0.5] })), markerColor: RED }], { fill: RED_SOFT, line: RED }));
    }

    if ([ap.mockup, ap.prePrint, ap.confirmation, ap.sample].some(has)) {
      content.push(keep(section("Approvals before production"),
        grid4([[
          cell("Graphic mock-up of every jersey", v(ap.mockup), yes(ap.mockup)),
          cell("Pre-print / strike-off test", v(ap.prePrint), yes(ap.prePrint)),
          cell("Customer confirmation first", v(ap.confirmation), yes(ap.confirmation)),
          cell("Pre-production sample", v(ap.sample), yes(ap.sample))
        ]])));
    }

    const specs = (order.colourSpecs || []).filter(x => has(x.name) || has(x.pantone) || has(x.cmyk));
    if (specs.length) {
      content.push(keep(section("Colour specifications"), {
        table: {
          widths: ["*", "*", "*"],
          body: [["COLOUR", "PANTONE", "CMYK / VALUES"].map(h => ({ text: h, fontSize: 5.8, bold: true, fillColor: SOFT, characterSpacing: 0.3 }))]
            .concat(specs.map(x => [
              { text: v(x.name), fontSize: 8.4, bold: true },
              { text: v(x.pantone), fontSize: 8.4, font: "Courier", bold: true, color: RED },
              { text: v(x.cmyk), fontSize: 8.2, font: "Courier" }
            ])),
          headerRows: 1, dontBreakRows: true
        },
        layout: qtyLayout
      }));
    }

    order.items.forEach((it, i) => {
      const block = itemBlock(it, i, picsFor(it.id), itemIndex, layout);
      // The "Items" heading sits on the same page as the first item's header and specs.
      if (i === 0) block.stack[0] = keep(section("Items"), block.stack[0]);
      content.push(block);
    });
    if (!order.items.length) content.push(section("Items"), { text: "No items.", color: MUTED, fontSize: 8 });

    const a = order.artwork || {};
    content.push(keep(section("Artwork & decoration"),
      grid4([
        [cell("Files received", v(a.files), { span: 2 }), cell("Names & numbers", v(a.namesNumbers), { span: 2 })],
        [cell("Fonts", v(a.fonts), { span: 2 }), cell("Logos", v(a.logos), { span: 2 })],
        [cell("Artwork notes", v(a.notes), { span: 4 })]
      ])));
    const gen = pictureGrid(general, itemIndex, layout);
    if (gen.length) {
      gen[0] = keep(section(layout.place === "end" ? "Mock-ups, size charts & reference pictures" : "Size charts & reference pictures"), gen[0]);
      content.push(...gen);
    }

    const sc = order.schedule || {};
    const pk = order.packing || {};
    content.push({
      stack: [
        section("Production schedule"),
        grid4([[cell("Cutting", v(EO.humanDate(sc.cutting)), { mono: true }), cell("Stitching", v(EO.humanDate(sc.stitching)), { mono: true }),
          cell("QC / finishing", v(EO.humanDate(sc.qc)), { mono: true }), cell("Dispatch", v(EO.humanDate(sc.dispatch)), { mono: true, bold: true })]]),
      ].concat([pk.packing, pk.labels, pk.shipping].some(has) ? [
        section("Packing & dispatch"),
        grid4([
          [cell("Packing", v(pk.packing), { span: 4 })],
          [cell("Labels & tags", v(pk.labels), { span: 2 }), cell("Shipping method", v(pk.shipping), { span: 2 })]
        ])
      ] : [], [
        {
          columns: ["Prepared by / date", "Approved by / date", "Production manager / date"].map((label, i) => ({
            width: "*",
            stack: [
              { text: i === 0 ? t(order.preparedBy) : " ", fontSize: 8.5, margin: [0, 0, 0, 3] },
              { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_W / 3 - 16, y2: 0, lineWidth: 0.8, lineColor: INK }] },
              { text: up(label), fontSize: 5.6, color: MUTED, characterSpacing: 0.4, margin: [0, 3, 0, 0] }
            ]
          })),
          columnGap: 24,
          margin: [0, 24, 0, 0]
        }
      ]),
      unbreakable: true
    });

    const company = up(s.companyName || "Ennoble International");
    const tagline = up(s.companyTagline || "");
    return {
      pageSize: "A4",
      pageMargins: [MARGIN_X, 86, MARGIN_X, 46],
      defaultStyle: { font: "Helvetica", fontSize: 8.4, color: INK, lineHeight: 1.1 },
      info: { title: t("Production Order " + no + " - " + (c.team || c.name || "")), author: t(s.companyName || "Ennoble International"), subject: "Production order sheet (confidential)" },
      header: function () {
        const cols = [];
        if (logo) cols.push({ image: logo, fit: [92, 44], width: 98 });
        cols.push({
          width: "*",
          stack: [
            { text: company, bold: true, fontSize: logo ? 11.5 : 16.5, characterSpacing: 0.4 },
            { text: tagline, fontSize: 5.8, color: MUTED, characterSpacing: 0.6, margin: [0, 2.5, 0, 0] }
          ],
          margin: [logo ? 6 : 0, logo ? 13 : 4, 0, 0]
        });
        cols.push({
          width: "auto",
          stack: [
            { text: "PRODUCTION ORDER", fontSize: 7.5, color: MUTED, alignment: "right", characterSpacing: 1 },
            { text: t(no), font: "Courier", bold: true, fontSize: 15, alignment: "right", margin: [0, 3, 0, 0] },
            order.rev > 1 ? { text: "REVISION " + order.rev, fontSize: 7, bold: true, color: RED, alignment: "right", margin: [0, 2, 0, 0] } : { text: "" }
          ],
          margin: [0, 6, 0, 0]
        });
        return {
          margin: [MARGIN_X, 20, MARGIN_X, 0],
          stack: [
            { columns: cols, columnGap: 4 },
            { canvas: [{ type: "rect", x: 0, y: 6, w: CONTENT_W, h: 2.6, color: RED }] }
          ]
        };
      },
      footer: function (page, pages) {
        return {
          margin: [MARGIN_X, 12, MARGIN_X, 0],
          stack: [
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.6, lineColor: INK }] },
            { columns: [
              { text: [{ text: "CONFIDENTIAL", bold: true, color: RED }, "  ·  " + company + " INTERNAL PRODUCTION DOCUMENT" + (order.orderNo ? "  ·  " + t(no) + " " + rev : "")], fontSize: 5.6, color: MUTED, characterSpacing: 0.3 },
              { text: "PAGE " + page + " OF " + pages, fontSize: 5.6, color: MUTED, alignment: "right", width: "auto", characterSpacing: 0.3 }
            ], margin: [0, 5, 0, 0] }
          ]
        };
      },
      content
    };
  };

  /* The Ennoble logo ships with the site; a logo chosen in Settings replaces it. */
  let brandLogo = null;
  EO.brandLogo = async function () {
    const s = EO.settings();
    if (s.logo) return s.logo;
    if (brandLogo === null) {
      try {
        const res = await fetch("img/ennoble-logo.png");
        brandLogo = res.ok ? await EO.blobToDataURL(await res.blob()) : "";
      } catch (e) { brandLogo = ""; }
    }
    return brandLogo;
  };

  async function ensurePdfMake() {
    await EO.loadScript("vendor/pdfmake-0.2.23.min.js");
    await EO.loadScript("vendor/pdfmake-std-fonts.js");
  }
  function render(order, logo, layout) {
    const doc = window.pdfMake.createPdf(EO.buildSheetDoc(order, logo, layout));
    return new Promise((res, rej) => {
      try { doc.getBlob(b => res(b)); } catch (e) { rej(e); }
    });
  }
  // Pages, and pages that hold nothing but the header and footer. Text is compared with spaces and
  // punctuation stripped, because letter-spaced headings come out of the PDF in pieces.
  async function pageInfo(blob, orderNo) {
    const pdf = await EO.openPdf(await blob.arrayBuffer());
    const lib = await EO.pdfjs();
    const s = EO.settings();
    const alnum = x => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const fixed = [alnum(s.companyName || "Ennoble International"), alnum(s.companyTagline), "PRODUCTIONORDER", "INTERNALPRODUCTIONDOCUMENT", "CONFIDENTIAL", alnum(orderNo || "DRAFT")].filter(Boolean);
    let blanks = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      let body = alnum((await page.getTextContent()).items.map(i => i.str).join(""));
      for (const f of fixed) body = body.split(f).join("");
      body = body.replace(/PAGE\d+OF\d+|REVISION\d+|R\d+/g, "");
      const ops = await page.getOperatorList();
      const images = ops.fnArray.filter(f => f === lib.OPS.paintImageXObject || f === lib.OPS.paintInlineImageXObject).length;
      if (body.length < 3 && images <= 1) blanks++;
    }
    return { pages: pdf.numPages, blanks };
  }
  // Printing costs paper: try picture sizes and placements, keep the shortest sheet with no empty page.
  EO.makeSheetPdf = async function (order) {
    await ensurePdfMake();
    const logo = await EO.brandLogo();
    if (!order.pictures.length) return render(order, logo, LAYOUTS[0]);
    // Pictures can only add pages, so the sheet without them is the best any layout can do.
    const floor = (await pageInfo(await render(order, logo, { place: "items", none: true }), order.orderNo)).pages;
    let best = null;
    for (const layout of LAYOUTS) {
      const blob = await render(order, logo, layout);
      const info = await pageInfo(blob, order.orderNo);
      const score = info.pages + info.blanks * 2;
      if (!best || score < best.score) best = { score, blob, info };
      if (!info.blanks && info.pages <= floor) break;
    }
    return best.blob;
  };
  EO.sheetPageInfo = pageInfo;
  EO.pdfText = t;
})(window.EO);
