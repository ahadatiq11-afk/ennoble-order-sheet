/* The Ennoble production order sheet as a PDF (pdfmake, standard Helvetica/Courier). One layout for every order. */
(function (EO) {
  "use strict";

  const INK = "#15201A", MUTED = "#6B7A71", LINE = "#C3CCC4", HI = "#EEF2EF", HEAD = "#E9EFEA", TOT = "#E2EAE4", WARN = "#FBEFE6", WARN_LINE = "#C97B4A";
  const PAGE_W = 595.28, MARGIN_X = 36, CONTENT_W = PAGE_W - MARGIN_X * 2;
  const DASH = "—";

  /* Standard PDF fonts only know Windows-1252. Map what we can, mark the rest. */
  const WIN = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const SUBS = { "\u0141": "L", "\u0142": "l", "\u0110": "D", "\u0111": "d", "\u0126": "H", "\u0127": "h", "\u0131": "i", "\u014A": "N", "\u014B": "n", "\u0166": "T", "\u0167": "t", "\u013F": "L", "\u0140": "l", "→": "->", "←": "<-", "✓": "OK", "✔": "OK", "≥": ">=", "≤": "<=", "″": '"', "′": "'", "−": "-", " ": " ", "‑": "-", "‐": "-", "‒": "-", "―": DASH, "…": "…" };
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
  const v = s => (EO.str(s) ? t(EO.str(s)) : DASH);
  const up = s => t(String(s || "").toUpperCase());

  /* ---------- building blocks ---------- */
  const gridLayout = {
    hLineWidth: () => 0.6, vLineWidth: () => 0.6,
    hLineColor: () => LINE, vLineColor: () => LINE,
    paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0
  };
  const qtyLayout = Object.assign({}, gridLayout, {
    paddingTop: () => 2.5, paddingBottom: () => 2.5, paddingLeft: () => 2, paddingRight: () => 2
  });

  function cell(label, value, o) {
    o = o || {};
    const c = {
      stack: [
        { text: up(label), fontSize: 5.6, color: MUTED, characterSpacing: 0.4 },
        { text: value == null || value === "" ? DASH : value, fontSize: o.big ? 10 : 8.4, font: o.mono ? "Courier" : "Helvetica", bold: !!o.bold, color: (value == null || value === "" || value === DASH) ? MUTED : INK, margin: [0, 2, 0, 0], lineHeight: 1.12 }
      ],
      margin: [5, 4, 5, 4.5]
    };
    if (o.hi) c.fillColor = HI;
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
        { text: up(title), bold: true, fontSize: 7.6, characterSpacing: 0.5, color: INK },
        { canvas: [{ type: "line", x1: 0, y1: 3, x2: CONTENT_W, y2: 3, lineWidth: 0.9, lineColor: INK }] }
      ],
      margin: [0, 13, 0, 6]
    };
  }

  /* ---------- item ---------- */
  function itemHeader(item, i) {
    return {
      table: {
        widths: ["auto", "*", "auto"],
        body: [[
          { text: "ITEM " + EO.pad(i + 1, 2), font: "Courier", bold: true, fontSize: 7.6, margin: [6, 5, 8, 4] },
          { text: up(EO.itemTitle(item)), bold: true, fontSize: 10, margin: [0, 4, 6, 3] },
          { text: EO.itemTotal(item) + " PCS", font: "Courier", bold: true, fontSize: 8.8, alignment: "right", margin: [6, 4.5, 6, 3] }
        ]]
      },
      layout: {
        hLineWidth: () => 0.9, vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.9 : 0),
        hLineColor: () => INK, vLineColor: () => INK,
        fillColor: () => HEAD, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0
      }
    };
  }
  function itemSpecs(item) {
    return grid4([
      [cell("Style ref", v(item.styleRef)), cell("Decoration", v(item.decoration)), cell("Colours", v(EO.itemColours(item)), { span: 2 })],
      [cell("Fabric & weight", v(item.fabric), { span: 2 }), cell("Placements", v(item.placements), { span: 2 })],
      [cell("Trims & labels", v(item.trims), { span: 4 })],
      [cell("Item notes", v(item.notes), { span: 4 })]
    ]);
  }
  function itemGrid(item) {
    const sizes = item.sizes.length ? item.sizes : ["QTY"];
    const many = sizes.length > 11;
    const fs = many ? 7 : 8.8;
    const colourW = many ? 64 : 92;
    const widths = [colourW].concat(sizes.map(() => "*"), [many ? 30 : 40]);
    const head = [{ text: "COLOUR", fontSize: 6, color: MUTED, characterSpacing: 0.3, fillColor: HEAD, margin: [3, 1, 0, 0] }]
      .concat(sizes.map(s => ({ text: up(s), font: "Courier", fontSize: many ? 6 : 6.8, alignment: "center", fillColor: HEAD })),
        [{ text: "TOTAL", fontSize: 6, alignment: "center", bold: true, fillColor: TOT, characterSpacing: 0.3 }]);
    const body = [head];
    const qty = n => (n ? { text: String(n), font: "Courier", bold: true, fontSize: fs, alignment: "center" } : { text: "·", color: LINE, alignment: "center", fontSize: fs });
    const rows = item.rows.length ? item.rows : [EO.blankRow("")];
    for (const r of rows) {
      body.push([{ text: v(r.colour), fontSize: many ? 6.8 : 7.8, margin: [3, 0.5, 2, 0] }]
        .concat(sizes.map(s => qty(EO.int(r.q[s]))),
          [{ text: String(EO.rowTotal(item, r)), font: "Courier", bold: true, fontSize: fs, alignment: "center", fillColor: TOT }]));
    }
    if (rows.length > 1) {
      body.push([{ text: "TOTAL", bold: true, fontSize: 6.6, characterSpacing: 0.3, fillColor: TOT, margin: [3, 1, 0, 0] }]
        .concat(sizes.map(s => ({ text: String(EO.sizeTotal(item, s)), font: "Courier", bold: true, fontSize: fs, alignment: "center", fillColor: TOT })),
          [{ text: String(EO.gridTotal(item)), font: "Courier", bold: true, fontSize: fs + 0.6, alignment: "center", fillColor: "#D3DED6" }]));
    }
    return { table: { widths, body, headerRows: 1, dontBreakRows: true }, layout: qtyLayout };
  }
  function itemRoster(item) {
    if (!item.roster.length) return null;
    const head = ["#", "NAME", "NUMBER", "SIZE", "QTY", "NOTES"].map(h => ({ text: h, fontSize: 5.8, color: MUTED, fillColor: HEAD, characterSpacing: 0.3 }));
    const body = [head].concat(item.roster.map((p, i) => [
      { text: String(i + 1), font: "Courier", fontSize: 7, color: MUTED },
      { text: t(p.name) || DASH, fontSize: 7.6 },
      { text: t(p.number) || DASH, font: "Courier", bold: true, fontSize: 8, alignment: "center" },
      { text: t(p.size) || DASH, font: "Courier", bold: true, fontSize: 7.6, alignment: "center" },
      { text: String(p.qty === "" || p.qty == null ? 1 : EO.int(p.qty)), font: "Courier", fontSize: 7.6, alignment: "center" },
      { text: t(p.notes), fontSize: 7, color: MUTED }
    ]));
    return {
      stack: [
        { text: "ROSTER " + DASH + " NAMES & NUMBERS (" + EO.rosterTotal(item) + ")", fontSize: 6, bold: true, color: MUTED, characterSpacing: 0.4, margin: [0, 6, 0, 3] },
        { table: { widths: [16, "*", 44, 40, 26, "*"], body, headerRows: 1, dontBreakRows: true }, layout: qtyLayout }
      ]
    };
  }
  function itemBlock(item, i) {
    const top = { stack: [itemHeader(item, i), itemSpecs(item)], unbreakable: true };
    const grid = itemGrid(item);
    const roster = itemRoster(item);
    const small = item.rows.length <= 14 && item.roster.length === 0;
    if (small) return { stack: [itemHeader(item, i), itemSpecs(item), grid], unbreakable: true, margin: [0, 0, 0, 11] };
    return { stack: [top, grid, roster].filter(Boolean), margin: [0, 0, 0, 11] };
  }

  /* ---------- pictures ---------- */
  function picturesBlock(order) {
    if (!order.pictures.length) return null;
    const idx = {};
    order.items.forEach((it, i) => { idx[it.id] = i; });
    const pics = order.pictures.slice().sort((a, b) => {
      const x = a.item in idx ? idx[a.item] : 999, y = b.item in idx ? idx[b.item] : 999;
      return x - y;
    });
    const cellOf = p => {
      if (!p) return { text: "", border: [false, false, false, false] };
      const it = p.item in idx ? "ITEM " + EO.pad(idx[p.item] + 1, 2) + "  " : "";
      return {
        stack: [
          { image: p.dataUrl, fit: [CONTENT_W / 2 - 22, 178], alignment: "center", margin: [0, 4, 0, 4] },
          { text: [{ text: it, font: "Courier", bold: true }, t(p.caption || "")], fontSize: 6.6, color: MUTED, margin: [5, 0, 5, 4] }
        ]
      };
    };
    const body = [];
    for (let i = 0; i < pics.length; i += 2) body.push([cellOf(pics[i]), cellOf(pics[i + 1])]);
    return { table: { widths: ["*", "*"], body, dontBreakRows: true }, layout: Object.assign({}, gridLayout, { paddingLeft: () => 0 }) };
  }

  function checksBlock(order) {
    const open = EO.openChecks(order);
    if (!open.length) return null;
    return {
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            { text: "CHECK BEFORE PRODUCTION " + DASH + " CONFIRM WITH CUSTOMER", bold: true, fontSize: 6.8, characterSpacing: 0.4, color: "#8A4A22", margin: [0, 0, 0, 3] },
            { ul: open.map(x => ({ text: t(x), fontSize: 8, margin: [0, 0.5, 0, 0.5] })), markerColor: WARN_LINE }
          ],
          fillColor: WARN, margin: [7, 5, 7, 6]
        }]]
      },
      layout: { hLineWidth: () => 0.8, vLineWidth: i => (i === 0 ? 3 : 0.8), hLineColor: () => WARN_LINE, vLineColor: () => WARN_LINE, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
      margin: [0, 10, 0, 0]
    };
  }

  /* ---------- the document ---------- */
  EO.buildSheetDoc = function (order) {
    const s = EO.settings();
    const no = order.orderNo ? order.orderNo + (order.rev > 1 ? "  R" + order.rev : "") : "DRAFT";
    const total = EO.orderTotal(order);
    const c = order.customer;
    const contact = [c.contact, c.phone, c.email].map(EO.str).filter(Boolean).join("\n");

    const content = [
      grid4([
        [cell("Customer PO", v(order.customerPo), { mono: true }), cell("Order received", v(EO.humanDate(order.orderDate)), { mono: true }),
          cell("Ship by", v(EO.humanDate(order.shipBy)), { mono: true, bold: true, hi: true }), cell("Priority", v(order.priority))],
        [cell("Total pieces", String(total), { mono: true, bold: true, big: true, hi: true }), cell("Items", String(order.items.length), { mono: true }),
          cell("Prepared by", v(order.preparedBy)), cell("Sheet issued", v(EO.humanDate(order.issuedDate || EO.todayISO())), { mono: true })]
      ]),
      section("Customer"),
      grid4([
        [cell("Customer / club", v(c.name), { span: 2, bold: true }), cell("Contact", contact ? t(contact) : DASH, { span: 2 })],
        [cell("Ship to", v(c.shipTo), { span: 4 })]
      ]),
      checksBlock(order),
      section("Items")
    ].filter(Boolean);

    order.items.forEach((it, i) => content.push(itemBlock(it, i)));
    if (!order.items.length) content.push({ text: "No items.", color: MUTED, fontSize: 8 });

    content.push(
      section("Artwork & decoration"),
      grid4([
        [cell("Files received", v(order.artwork.files), { span: 2 }), cell("Colour codes", v(order.artwork.colourCodes), { span: 2 })],
        [cell("Names & numbers", v(order.artwork.namesNumbers), { span: 2 }), cell("Pre-production sample", v(order.artwork.sample), { span: 2 })],
        [cell("Artwork notes", v(order.artwork.notes), { span: 4 })]
      ])
    );
    const pics = picturesBlock(order);
    if (pics) content.push(section("Artwork & reference pictures"), pics);

    const sc = order.schedule;
    content.push({
      stack: [
        section("Production schedule"),
        grid4([[cell("Cutting", v(EO.humanDate(sc.cutting)), { mono: true }), cell("Stitching", v(EO.humanDate(sc.stitching)), { mono: true }),
          cell("QC / finishing", v(EO.humanDate(sc.qc)), { mono: true }), cell("Dispatch", v(EO.humanDate(sc.dispatch)), { mono: true, hi: true })]])
      ],
      unbreakable: true
    });
    content.push({
      stack: [
        section("Packing & dispatch"),
        grid4([
          [cell("Packing", v(order.packing.packing), { span: 4 })],
          [cell("Labels & tags", v(order.packing.labels), { span: 2 }), cell("Shipping method", v(order.packing.shipping), { span: 2 })],
          [cell("Notes for production", v(order.notes), { span: 4 })]
        ]),
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
          margin: [0, 26, 0, 0]
        }
      ],
      unbreakable: true
    });

    const company = up(s.companyName || "Ennoble International");
    const tagline = up(s.companyTagline || "");
    return {
      pageSize: "A4",
      pageMargins: [MARGIN_X, 80, MARGIN_X, 46],
      defaultStyle: { font: "Helvetica", fontSize: 8.4, color: INK, lineHeight: 1.1 },
      info: { title: t("Production Order " + no + " - " + (c.name || "")), author: t(s.companyName || "Ennoble International"), subject: "Production order sheet" },
      header: function () {
        const left = [
          { text: company, bold: true, fontSize: 16.5, characterSpacing: 0.2 },
          { text: tagline, fontSize: 5.8, color: MUTED, characterSpacing: 0.6, margin: [0, 2.5, 0, 0] }
        ];
        const cols = [];
        if (s.logo) cols.push({ image: s.logo, fit: [34, 34], width: 40 });
        cols.push({ width: "*", stack: left, margin: [0, s.logo ? 4 : 0, 0, 0] });
        cols.push({ width: "auto", stack: [
          { text: "PRODUCTION ORDER", fontSize: 9, alignment: "right", characterSpacing: 0.4 },
          { text: t(no), font: "Courier", bold: true, fontSize: 11.5, alignment: "right", margin: [0, 3, 0, 0] }
        ] });
        return {
          margin: [MARGIN_X, 26, MARGIN_X, 0],
          stack: [
            { columns: cols, columnGap: 8 },
            { canvas: [{ type: "line", x1: 0, y1: 7, x2: CONTENT_W, y2: 7, lineWidth: 1.6, lineColor: INK }] }
          ]
        };
      },
      footer: function (page, pages) {
        return {
          margin: [MARGIN_X, 12, MARGIN_X, 0],
          stack: [
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.5, lineColor: LINE }] },
            { columns: [
              { text: company + " " + DASH + " INTERNAL PRODUCTION DOCUMENT" + (order.orderNo ? "  ·  " + t(no) : ""), fontSize: 5.6, color: MUTED, characterSpacing: 0.3 },
              { text: "PAGE " + page + " OF " + pages, fontSize: 5.6, color: MUTED, alignment: "right", width: "auto", characterSpacing: 0.3 }
            ], margin: [0, 5, 0, 0] }
          ]
        };
      },
      content
    };
  };

  async function ensurePdfMake() {
    await EO.loadScript("vendor/pdfmake-0.2.23.min.js");
    await EO.loadScript("vendor/pdfmake-std-fonts.js");
  }
  EO.makeSheetPdf = async function (order) {
    await ensurePdfMake();
    const doc = window.pdfMake.createPdf(EO.buildSheetDoc(order));
    return new Promise((res, rej) => {
      try { doc.getBlob(b => res(b)); } catch (e) { rej(e); }
    });
  };
  EO.pdfText = t;
})(window.EO);
