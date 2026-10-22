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
      margin: [0, 13, 0, 6],
      headlineLevel: 1
    };
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
  function pictureGrid(pics, itemIndex) {
    if (!pics.length) return null;
    const label = p => {
      const n = itemIndex[p.item];
      return [{ text: n != null ? "ITEM " + EO.pad(n + 1, 2) + "  " : "", font: "Courier", bold: true, color: RED }, t(p.caption || "")];
    };
    const body = [];
    let pair = [];
    const flush = () => {
      if (!pair.length) return;
      body.push(pair.map(p => ({
        stack: [
          { image: p.dataUrl, fit: [CONTENT_W / 2 - 16, 200], alignment: "center", margin: [0, 5, 0, 4] },
          { text: label(p), fontSize: 6.6, color: MUTED, margin: [6, 0, 6, 5] }
        ]
      })).concat(pair.length === 1 ? [{ text: "" }] : []));
      pair = [];
    };
    for (const p of pics) {
      // Wide pictures (size charts, flat CADs) get the full width so their small print stays readable.
      const wide = (p.w || 1) / (p.h || 1) > 1.55 || /size chart/i.test(p.caption || "");
      if (wide) {
        flush();
        body.push([{
          colSpan: 2,
          stack: [
            { image: p.dataUrl, fit: [CONTENT_W - 16, 330], alignment: "center", margin: [0, 5, 0, 4] },
            { text: label(p), fontSize: 6.6, color: MUTED, margin: [6, 0, 6, 5] }
          ]
        }, {}]);
      } else {
        pair.push(p);
        if (pair.length === 2) flush();
      }
    }
    flush();
    return body.map((row, i) => ({ table: { widths: ["*", "*"], body: [row], dontBreakRows: true }, layout: gridLayout, margin: [0, i ? 0 : 6, 0, 0] }));
  }
  // A heading and the first picture row travel together; the rest flow on.
  function withPictures(head, rows) {
    if (!rows || !rows.length) return [];
    return [{ stack: [head, rows[0]], unbreakable: true }].concat(rows.slice(1));
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
    return {
      stack: [
        { text: "PLAYERS " + DASH + " NAMES, NUMBERS & SIZES (" + EO.rosterTotal(item) + " PCS)", fontSize: 6.2, bold: true, color: RED, characterSpacing: 0.4, margin: [0, 7, 0, 3], headlineLevel: 1 },
        { table: { widths, body, headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true }, layout: qtyLayout }
      ],
      unbreakable: item.roster.length <= 12
    };
  }
  function itemBlock(item, i, pics, itemIndex) {
    const top = { stack: [itemHeader(item, i)].concat(itemSpecs(item)), unbreakable: true };
    const grid = itemGrid(item);
    const roster = itemRoster(item);
    const pg = pictureGrid(pics, itemIndex) || [];
    const small = item.rows.length <= 14 && !roster && !(item.specs || []).length;
    const parts = small ? [{ stack: [itemHeader(item, i)].concat(itemSpecs(item), [grid]), unbreakable: true }] : [top, grid];
    return { stack: parts.concat(roster ? [roster] : [], pg), margin: [0, 0, 0, 12] };
  }

  /* ---------- the document ---------- */
  EO.buildSheetDoc = function (order, logo) {
    const s = EO.settings();
    const no = order.orderNo || "DRAFT";
    const rev = order.rev > 1 ? "R" + order.rev : "R1";
    const total = EO.orderTotal(order);
    const c = order.customer || {};
    const ap = order.approvals || {};
    const itemIndex = {};
    order.items.forEach((it, i) => { itemIndex[it.id] = i; });
    const picsFor = id => order.pictures.filter(p => p.item === id);
    const general = order.pictures.filter(p => !(p.item in itemIndex));
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

    content.push(section("Approvals before production"),
      grid4([[
        cell("Graphic mock-up of every jersey", v(ap.mockup), yes(ap.mockup)),
        cell("Pre-print / strike-off test", v(ap.prePrint), yes(ap.prePrint)),
        cell("Customer confirmation first", v(ap.confirmation), yes(ap.confirmation)),
        cell("Pre-production sample", v(ap.sample), yes(ap.sample))
      ]]));

    const specs = (order.colourSpecs || []).filter(x => has(x.name) || has(x.pantone) || has(x.cmyk));
    if (specs.length) {
      content.push(section("Colour specifications"), {
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
      });
    }

    content.push(section("Items"));
    order.items.forEach((it, i) => content.push(itemBlock(it, i, picsFor(it.id), itemIndex)));
    if (!order.items.length) content.push({ text: "No items.", color: MUTED, fontSize: 8 });

    const a = order.artwork || {};
    content.push(section("Artwork & decoration"),
      grid4([
        [cell("Files received", v(a.files), { span: 2 }), cell("Names & numbers", v(a.namesNumbers), { span: 2 })],
        [cell("Fonts", v(a.fonts), { span: 2 }), cell("Logos", v(a.logos), { span: 2 })],
        [cell("Artwork notes", v(a.notes), { span: 4 })]
      ]));
    const gen = pictureGrid(general, itemIndex);
    if (gen) content.push(...withPictures(section("Size charts & reference pictures"), gen));

    const sc = order.schedule || {};
    const pk = order.packing || {};
    content.push({
      stack: [
        section("Production schedule"),
        grid4([[cell("Cutting", v(EO.humanDate(sc.cutting)), { mono: true }), cell("Stitching", v(EO.humanDate(sc.stitching)), { mono: true }),
          cell("QC / finishing", v(EO.humanDate(sc.qc)), { mono: true }), cell("Dispatch", v(EO.humanDate(sc.dispatch)), { mono: true, bold: true })]]),
        section("Packing & dispatch"),
        grid4([
          [cell("Packing", v(pk.packing), { span: 4 })],
          [cell("Labels & tags", v(pk.labels), { span: 2 }), cell("Shipping method", v(pk.shipping), { span: 2 })]
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
      pageMargins: [MARGIN_X, 86, MARGIN_X, 46],
      // A section heading starting in the bottom sixth of a page moves to the next page with its content.
      pageBreakBefore: node => node.headlineLevel === 1 && node.startPosition && node.startPosition.verticalRatio > 0.84,
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
  EO.makeSheetPdf = async function (order) {
    await ensurePdfMake();
    const doc = window.pdfMake.createPdf(EO.buildSheetDoc(order, await EO.brandLogo()));
    return new Promise((res, rej) => {
      try { doc.getBlob(b => res(b)); } catch (e) { rej(e); }
    });
  };
  EO.pdfText = t;
})(window.EO);
