/* The same order as an Excel workbook in the Ennoble colours: the sheet layout, a flat size breakdown,
   the player list and the pictures. */
(function (EO) {
  "use strict";

  const RED = "FFCC0000", INK = "FF111111", WHITE = "FFFFFFFF", MUTED = "FF6B6B6B", LINE = "FFCFCFCF", SOFT = "FFF2F2F2", RED_SOFT = "FFFBEAEA";
  const thin = { style: "thin", color: { argb: LINE } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const COLS = 12; // A..L: four blocks of three columns, like the PDF's four cells
  const fill = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

  const col = n => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const dash = s => (EO.str(s) ? EO.str(s) : "—");
  const yes = x => /^(yes|y|required|true)\b/i.test(EO.str(x));

  function sheetLayout(wb, ws, order, logo) {
    const s = EO.settings();
    ws.columns = Array.from({ length: 30 }, (_, i) => ({ width: i === 0 ? 18 : 9 }));
    let r = 1;
    const put = (row, c, value, style) => {
      const cell = ws.getCell(row, c + 1);
      cell.value = value;
      if (style) for (const k of Object.keys(style)) if (style[k] !== undefined) cell[k] = style[k];
      return cell;
    };
    const merge = (r1, c1, r2, c2) => { if (r2 > r1 || c2 > c1) ws.mergeCells(r1, c1 + 1, r2, c2 + 1); };
    const band = (row, last, argb) => { for (let k = 0; k <= last; k++) ws.getCell(row, k + 1).fill = fill(argb); };

    // Header: logo, company, order number, red rule
    ws.getRow(1).height = 26; ws.getRow(2).height = 26;
    if (logo) {
      const id = wb.addImage({ base64: logo.split(",")[1], extension: /image\/png/.test(logo) ? "png" : "jpeg" });
      ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 108, height: 52 } });
    }
    put(1, 2, String(s.companyName || "Ennoble International").toUpperCase(), { font: { bold: true, size: 15, color: { argb: INK } }, alignment: { vertical: "bottom" } });
    merge(1, 2, 1, 7);
    put(2, 2, String(s.companyTagline || "").toUpperCase(), { font: { size: 8, color: { argb: MUTED } }, alignment: { vertical: "top" } });
    merge(2, 2, 2, 7);
    put(1, 8, "PRODUCTION ORDER", { alignment: { horizontal: "right", vertical: "bottom" }, font: { size: 9, color: { argb: MUTED } } });
    merge(1, 8, 1, 11);
    put(2, 8, (order.orderNo || "DRAFT") + (order.rev > 1 ? "  R" + order.rev : ""), { alignment: { horizontal: "right", vertical: "top" }, font: { bold: true, size: 14, name: "Courier New" } });
    merge(2, 8, 2, 11);
    for (let c = 0; c < COLS; c++) ws.getCell(3, c + 1).border = { top: { style: "thick", color: { argb: RED } } };
    r = 4;

    if (order.priority === "Rush") {
      put(r, 0, "URGENT" + (EO.str(order.shipBy) ? "   —   SHIP BY " + EO.humanDate(order.shipBy).toUpperCase() : ""), { font: { bold: true, size: 13, color: { argb: WHITE } }, alignment: { horizontal: "center", vertical: "middle" } });
      merge(r, 0, r, COLS - 1);
      band(r, COLS - 1, RED);
      ws.getRow(r).height = 24;
      r += 2;
    }

    // A row of labelled cells: [{label, value, span (1-4), mono, bold, red, dark}]
    function cells(list) {
      let c = 0;
      let tallest = 15;
      for (const x of list) {
        const w = (x.span || 1) * 3;
        const bg = x.dark ? INK : undefined;
        put(r, c, String(x.label).toUpperCase(), { font: { size: 7, color: { argb: x.dark ? "FFBBBBBB" : MUTED } }, fill: bg ? fill(bg) : undefined });
        merge(r, c, r, c + w - 1);
        const value = x.value === "" || x.value == null ? "—" : x.value;
        put(r + 1, c, value, {
          font: { size: x.big ? 14 : 10, bold: !!x.bold, name: x.mono ? "Courier New" : undefined, color: { argb: x.dark ? WHITE : x.red ? RED : INK } },
          alignment: { wrapText: true, vertical: "top", horizontal: "left" },
          fill: bg ? fill(bg) : undefined
        });
        merge(r + 1, c, r + 1, c + w - 1);
        for (let k = c; k < c + w; k++) {
          ws.getCell(r, k + 1).border = { top: thin, left: k === c ? thin : undefined, right: k === c + w - 1 ? thin : undefined };
          ws.getCell(r + 1, k + 1).border = { bottom: thin, left: k === c ? thin : undefined, right: k === c + w - 1 ? thin : undefined };
        }
        const lines = String(value).split("\n").length + Math.floor(String(value).length / (w * 11));
        tallest = Math.max(tallest, Math.min(200, 14 * lines + 2));
        c += w;
      }
      ws.getRow(r + 1).height = tallest;
      r += 2;
    }
    function heading(text) {
      r++;
      put(r, 0, { richText: [{ text: "▌ ", font: { bold: true, size: 10, color: { argb: RED } } }, { text: text.toUpperCase(), font: { bold: true, size: 10, color: { argb: INK } } }] });
      for (let c = 0; c < COLS; c++) ws.getCell(r, c + 1).border = { bottom: { style: "thin", color: { argb: INK } } };
      r += 2;
    }
    function box2(title, lines, bg, titleColor) {
      put(r, 0, title.toUpperCase(), { font: { bold: true, size: 9, color: { argb: titleColor } }, fill: fill(bg) });
      merge(r, 0, r, COLS - 1);
      ws.getCell(r, 1).border = { left: { style: "thick", color: { argb: titleColor } } };
      r++;
      for (const q of lines) {
        put(r, 0, q, { fill: fill(bg), font: { size: 10, bold: titleColor === RED && bg === WHITE }, alignment: { wrapText: true, vertical: "top" } });
        merge(r, 0, r, COLS - 1);
        ws.getCell(r, 1).border = { left: { style: "thick", color: { argb: titleColor } } };
        ws.getRow(r).height = 15 * Math.max(1, Math.ceil(q.length / 105) + (q.match(/\n/g) || []).length);
        r++;
      }
      r++;
    }

    const c = order.customer || {};
    const ap = order.approvals || {};
    cells([
      { label: "Customer / brand", value: c.name, bold: true },
      { label: "Team / design", value: c.team, bold: true, span: 2 },
      { label: "Customer order code", value: order.customerPo, mono: true, bold: true }
    ]);
    cells([
      { label: "Order received", value: EO.humanDate(order.orderDate), mono: true },
      { label: "Ship by", value: EO.humanDate(order.shipBy), mono: true, bold: true, red: !!EO.str(order.shipBy) },
      { label: "Priority", value: order.priority, bold: order.priority !== "Standard", red: order.priority === "Rush" },
      { label: "Total pieces", value: EO.orderTotal(order), mono: true, bold: true, big: true, dark: true }
    ]);
    cells([
      { label: "Mock / design ref", value: order.mockRef, mono: true },
      { label: "Size chart", value: order.sizeChart },
      { label: "Repeat of / based on", value: order.repeatOf, span: 2 }
    ]);
    cells([
      { label: "Items", value: order.items.length, mono: true },
      { label: "Prepared by", value: order.preparedBy },
      { label: "Sheet issued", value: EO.humanDate(order.issuedDate || EO.todayISO()), mono: true },
      { label: "Revision", value: order.rev > 1 ? "R" + order.rev : "R1", mono: true, red: order.rev > 1 }
    ]);
    r++;
    if (EO.str(order.notes)) box2("Production notes — read first", [EO.str(order.notes)], WHITE, RED);
    const open = EO.openChecks(order);
    if (open.length) box2("Check before production — confirm with customer", open.map(q => "• " + q), RED_SOFT, RED);

    heading("Approvals before production");
    cells([
      { label: "Graphic mock-up of every jersey", value: ap.mockup, bold: yes(ap.mockup), red: yes(ap.mockup) },
      { label: "Pre-print / strike-off test", value: ap.prePrint, bold: yes(ap.prePrint), red: yes(ap.prePrint) },
      { label: "Customer confirmation first", value: ap.confirmation, bold: yes(ap.confirmation), red: yes(ap.confirmation) },
      { label: "Pre-production sample", value: ap.sample, bold: yes(ap.sample), red: yes(ap.sample) }
    ]);

    const specs = (order.colourSpecs || []).filter(x => EO.str(x.name) || EO.str(x.pantone) || EO.str(x.cmyk));
    if (specs.length) {
      heading("Colour specifications");
      ["COLOUR", "PANTONE", "CMYK / VALUES"].forEach((h, k) => {
        put(r, k * 4, h, { font: { bold: true, size: 8 }, fill: fill(SOFT), border: box });
        merge(r, k * 4, r, k * 4 + 3);
      });
      r++;
      for (const x of specs) {
        put(r, 0, dash(x.name), { font: { bold: true }, border: box }); merge(r, 0, r, 3);
        put(r, 4, dash(x.pantone), { font: { bold: true, name: "Courier New", color: { argb: RED } }, border: box }); merge(r, 4, r, 7);
        put(r, 8, dash(x.cmyk), { font: { name: "Courier New" }, border: box }); merge(r, 8, r, 11);
        r++;
      }
    }

    heading("Items");
    order.items.forEach((it, i) => {
      const sizes = it.sizes.length ? it.sizes : ["QTY"];
      const last = Math.max(COLS - 1, sizes.length + 1);
      put(r, 0, "ITEM " + EO.pad(i + 1, 2), { font: { bold: true, name: "Courier New", color: { argb: WHITE } }, fill: fill(RED), alignment: { horizontal: "center" } });
      put(r, 1, EO.itemTitle(it).toUpperCase(), { font: { bold: true, size: 11, color: { argb: WHITE } } });
      merge(r, 1, r, last - 2);
      put(r, last - 1, (/revers/i.test(it.sides || "") ? "REVERSIBLE   " : "") + EO.itemTotal(it) + " PCS", { font: { bold: true, name: "Courier New", color: { argb: WHITE } }, alignment: { horizontal: "right" } });
      merge(r, last - 1, r, last);
      for (let k = 1; k <= last; k++) ws.getCell(r, k + 1).fill = fill(INK);
      ws.getRow(r).height = 20;
      r++;
      cells([{ label: "Style / mock ref", value: it.styleRef, mono: true }, { label: "Print method", value: it.decoration, bold: true }, { label: "Fabric", value: it.fabric, span: 2 }]);
      cells([{ label: "Colours", value: EO.itemColours(it), span: 2 }, { label: "Cut / fit", value: it.fit }, { label: "Single / reversible", value: it.sides }]);
      cells([{ label: "Logos & placements", value: it.placements, span: 2 }, { label: "Trims & labels", value: it.trims, span: 2 }]);
      if (EO.str(it.notes)) cells([{ label: "Item notes", value: it.notes, span: 4 }]);
      for (const x of (it.specs || []).filter(x => EO.str(x.label) || EO.str(x.value))) {
        put(r, 0, String(x.label || "Detail").toUpperCase(), { font: { bold: true, size: 8 }, fill: fill(SOFT), alignment: { wrapText: true, vertical: "top" }, border: box });
        merge(r, 0, r, 1);
        put(r, 2, dash(x.value), { alignment: { wrapText: true, vertical: "top" }, border: box });
        merge(r, 2, r, COLS - 1);
        ws.getRow(r).height = 15 * Math.max(1, Math.ceil(String(x.value || "").length / 90));
        r++;
      }

      const hdr = r;
      put(hdr, 0, "COLOUR / VARIANT", { font: { bold: true, size: 8 }, fill: fill(SOFT), border: box });
      sizes.forEach((sz, k) => put(hdr, k + 1, sz, { font: { bold: true, size: 9, name: "Courier New" }, alignment: { horizontal: "center" }, fill: fill(SOFT), border: box }));
      put(hdr, sizes.length + 1, "TOTAL", { font: { bold: true, size: 8, color: { argb: RED } }, alignment: { horizontal: "center" }, fill: fill(RED_SOFT), border: box });
      r++;
      const rows = it.rows.length ? it.rows : [EO.blankRow("")];
      for (const row of rows) {
        put(r, 0, dash(row.colour), { border: box, alignment: { wrapText: true } });
        sizes.forEach((sz, k) => put(r, k + 1, EO.int(row.q[sz]) || null, { font: { bold: true, name: "Courier New", size: 11 }, alignment: { horizontal: "center" }, border: box }));
        put(r, sizes.length + 1, { formula: "SUM(" + col(1) + r + ":" + col(sizes.length) + r + ")", result: EO.rowTotal(it, row) },
          { font: { bold: true, name: "Courier New", size: 11 }, alignment: { horizontal: "center" }, fill: fill(RED_SOFT), border: box });
        r++;
      }
      if (rows.length > 1) {
        const first = r - rows.length, lastRow = r - 1;
        put(r, 0, "TOTAL", { font: { bold: true }, fill: fill(SOFT), border: box });
        sizes.forEach((sz, k) => put(r, k + 1, { formula: "SUM(" + col(k + 1) + first + ":" + col(k + 1) + lastRow + ")", result: EO.sizeTotal(it, sz) },
          { font: { bold: true, name: "Courier New", size: 11 }, alignment: { horizontal: "center" }, fill: fill(SOFT), border: box }));
        put(r, sizes.length + 1, { formula: "SUM(" + col(sizes.length + 1) + first + ":" + col(sizes.length + 1) + lastRow + ")", result: EO.gridTotal(it) },
          { font: { bold: true, name: "Courier New", size: 12, color: { argb: WHITE } }, alignment: { horizontal: "center" }, fill: fill(RED), border: box });
        r++;
      }
      if (it.roster.length) put(r++, 0, "Players: " + it.roster.length + " rows, " + EO.rosterTotal(it) + " pcs. See the Players sheet.", { font: { italic: true, size: 9, color: { argb: RED } } });
      const pics = order.pictures.filter(p => p.item === it.id).length;
      if (pics) put(r++, 0, pics + (pics === 1 ? " picture" : " pictures") + " for this item: see the Pictures sheet.", { font: { italic: true, size: 9, color: { argb: MUTED } } });
      r++;
    });

    const a = order.artwork || {};
    heading("Artwork & decoration");
    cells([{ label: "Files received", value: a.files, span: 2 }, { label: "Names & numbers", value: a.namesNumbers, span: 2 }]);
    cells([{ label: "Fonts", value: a.fonts, span: 2 }, { label: "Logos", value: a.logos, span: 2 }]);
    cells([{ label: "Artwork notes", value: a.notes, span: 4 }]);

    heading("Production schedule");
    const sc = order.schedule || {};
    cells([
      { label: "Cutting", value: EO.humanDate(sc.cutting), mono: true }, { label: "Stitching", value: EO.humanDate(sc.stitching), mono: true },
      { label: "QC / finishing", value: EO.humanDate(sc.qc), mono: true }, { label: "Dispatch", value: EO.humanDate(sc.dispatch), mono: true, bold: true }
    ]);
    heading("Packing & dispatch");
    const pk = order.packing || {};
    cells([{ label: "Packing", value: pk.packing, span: 4 }]);
    cells([{ label: "Labels & tags", value: pk.labels, span: 2 }, { label: "Shipping method", value: pk.shipping, span: 2 }]);

    r += 2;
    ["Prepared by / date", "Approved by / date", "Production manager / date"].forEach((label, i) => {
      const c0 = i * 4;
      if (i === 0) put(r, c0, order.preparedBy || "");
      for (let k = c0; k < c0 + 3; k++) ws.getCell(r, k + 1).border = { bottom: { style: "thin", color: { argb: INK } } };
      put(r + 1, c0, label.toUpperCase(), { font: { size: 7, color: { argb: MUTED } } });
    });

    ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddFooter: "&LCONFIDENTIAL · " + (s.companyName || "Ennoble International").toUpperCase() + " INTERNAL PRODUCTION DOCUMENT&RPage &P of &N" };
    ws.views = [{ showGridLines: false }];
  }

  function styleHeader(ws, lastCol) {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: WHITE } };
    for (let k = 1; k <= lastCol; k++) ws.getCell(1, k).fill = fill(INK);
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  function breakdownSheet(wb, order) {
    const ws = wb.addWorksheet("Size Breakdown");
    ws.columns = [
      { header: "Item", key: "item", width: 7 }, { header: "Group", key: "group", width: 14 }, { header: "Product", key: "product", width: 32 },
      { header: "Style ref", key: "style", width: 14 }, { header: "Colour / variant", key: "colour", width: 20 }, { header: "Size", key: "size", width: 10 },
      { header: "Qty", key: "qty", width: 8 }, { header: "Print method", key: "deco", width: 18 }, { header: "Fabric", key: "fabric", width: 24 }
    ];
    order.items.forEach((it, i) => {
      for (const row of it.rows) for (const sz of it.sizes) {
        const q = EO.int(row.q[sz]);
        if (q) ws.addRow({ item: EO.pad(i + 1, 2), group: it.group, product: it.product, style: it.styleRef, colour: row.colour, size: sz, qty: q, deco: it.decoration, fabric: it.fabric });
      }
    });
    const n = ws.rowCount;
    ws.addRow({});
    const tr = ws.addRow({ size: "TOTAL", qty: { formula: "SUM(G2:G" + n + ")", result: EO.orderTotal(order) } });
    tr.font = { bold: true, color: { argb: RED } };
    styleHeader(ws, 9);
    ws.autoFilter = { from: "A1", to: "I1" };
  }

  function playersSheet(wb, order) {
    if (!order.items.some(it => it.roster.length)) return;
    const ws = wb.addWorksheet("Players");
    const extras = [];
    order.items.forEach(it => (it.rosterCols || []).forEach(k => { if (!extras.includes(k)) extras.push(k); }));
    ws.columns = [
      { header: "Item", key: "item", width: 7 }, { header: "Product", key: "product", width: 28 }, { header: "#", key: "n", width: 5 },
      { header: "Name", key: "name", width: 22 }, { header: "Number", key: "number", width: 10 }, { header: "Size", key: "size", width: 9 },
      { header: "Qty", key: "qty", width: 6 }
    ].concat(extras.map((k, j) => ({ header: k, key: "x" + j, width: 16 })), [{ header: "Notes", key: "notes", width: 26 }]);
    order.items.forEach((it, i) => it.roster.forEach((p, k) => {
      const rowData = {
        item: EO.pad(i + 1, 2), product: it.product, n: k + 1, name: p.name, number: p.number, size: p.size,
        qty: p.qty === "" || p.qty == null ? 1 : EO.int(p.qty), notes: p.notes
      };
      extras.forEach((x, j) => { rowData["x" + j] = (p.extra && p.extra[x]) || ""; });
      ws.addRow(rowData);
    }));
    styleHeader(ws, 8 + extras.length);
  }

  function picturesSheet(wb, order) {
    if (!order.pictures.length) return;
    const ws = wb.addWorksheet("Pictures");
    ws.columns = [{ width: 60 }, { width: 50 }];
    const idx = {};
    order.items.forEach((it, i) => { idx[it.id] = i; });
    const sorted = order.pictures.slice().sort((a, b) => (a.item in idx ? idx[a.item] : 999) - (b.item in idx ? idx[b.item] : 999));
    let r = 1;
    for (const p of sorted) {
      const k = Math.min(1, 420 / Math.max(p.w || 420, 1), 300 / Math.max(p.h || 300, 1));
      const w = Math.round((p.w || 420) * k), h = Math.round((p.h || 300) * k);
      const id = wb.addImage({ base64: p.dataUrl.split(",")[1], extension: "jpeg" });
      ws.addImage(id, { tl: { col: 0, row: r - 1 }, ext: { width: w, height: h } });
      const rowsUsed = Math.ceil(h / 20) + 1;
      for (let i = 0; i < rowsUsed; i++) ws.getRow(r + i).height = 15;
      const cell = ws.getCell(r, 2);
      cell.value = (p.item in idx ? "Item " + EO.pad(idx[p.item] + 1, 2) + ": " : "General: ") + (p.caption || "");
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.font = { bold: p.item in idx, color: { argb: p.item in idx ? RED : INK } };
      r += rowsUsed + 1;
    }
  }

  EO.makeSheetXlsx = async function (order) {
    await EO.loadScript(EO.VENDOR.exceljs);
    const wb = new window.ExcelJS.Workbook();
    wb.creator = EO.settings().companyName || "Ennoble International";
    wb.created = new Date();
    sheetLayout(wb, wb.addWorksheet("Order Sheet"), order, await EO.brandLogo());
    breakdownSheet(wb, order);
    playersSheet(wb, order);
    picturesSheet(wb, order);
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };
})(window.EO);
