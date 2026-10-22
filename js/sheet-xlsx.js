/* The same order as an Excel workbook: the sheet layout, a flat size breakdown, the roster and the pictures. */
(function (EO) {
  "use strict";

  const INK = "FF15201A", MUTED = "FF6B7A71", LINE = "FFC3CCC4", HI = "FFEEF2EF", HEAD = "FFE9EFEA", TOT = "FFE2EAE4", WARN = "FFFBEFE6";
  const thin = { style: "thin", color: { argb: LINE } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const COLS = 12; // A..L: four blocks of three columns, like the PDF's four cells

  const col = n => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const dash = s => (EO.str(s) ? EO.str(s) : "—");

  function sheetLayout(ws, order) {
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

    // Header
    put(r, 0, String(s.companyName || "Ennoble International").toUpperCase(), { font: { bold: true, size: 18, color: { argb: INK } } });
    merge(r, 0, r, 7);
    put(r, 8, "PRODUCTION ORDER", { alignment: { horizontal: "right" }, font: { size: 10 } });
    merge(r, 8, r, 11);
    r++;
    put(r, 0, String(s.companyTagline || "").toUpperCase(), { font: { size: 8, color: { argb: MUTED } } });
    merge(r, 0, r, 7);
    put(r, 8, order.orderNo ? order.orderNo + (order.rev > 1 ? "  R" + order.rev : "") : "DRAFT", { alignment: { horizontal: "right" }, font: { bold: true, size: 12, name: "Courier New" } });
    merge(r, 8, r, 11);
    for (let c = 0; c < COLS; c++) ws.getCell(r, c + 1).border = { bottom: { style: "medium", color: { argb: INK } } };
    r += 2;

    // A row of labelled cells: [{label, value, span (1-4), hi, mono, bold}]
    function cells(list) {
      let c = 0;
      for (const x of list) {
        const w = (x.span || 1) * 3;
        put(r, c, String(x.label).toUpperCase(), { font: { size: 7, color: { argb: MUTED } }, fill: x.hi ? fill(HI) : undefined });
        merge(r, c, r, c + w - 1);
        const vc = put(r + 1, c, x.value === "" || x.value == null ? "—" : x.value, {
          font: { size: x.big ? 13 : 10, bold: !!x.bold, name: x.mono ? "Courier New" : undefined },
          alignment: { wrapText: true, vertical: "top", horizontal: "left" },
          fill: x.hi ? fill(HI) : undefined
        });
        merge(r + 1, c, r + 1, c + w - 1);
        for (let k = c; k < c + w; k++) {
          ws.getCell(r, k + 1).border = { top: thin, left: k === c ? thin : undefined, right: k === c + w - 1 ? thin : undefined };
          ws.getCell(r + 1, k + 1).border = { bottom: thin, left: k === c ? thin : undefined, right: k === c + w - 1 ? thin : undefined };
        }
        const lines = String(vc.value).split("\n").length + Math.floor(String(vc.value).length / (w * 11));
        ws.getRow(r + 1).height = Math.max(ws.getRow(r + 1).height || 15, Math.min(160, 14 * lines + 2));
        c += w;
      }
      r += 2;
    }
    function heading(text) {
      r++;
      put(r, 0, text.toUpperCase(), { font: { bold: true, size: 9 } });
      for (let c = 0; c < COLS; c++) ws.getCell(r, c + 1).border = { bottom: { style: "thin", color: { argb: INK } } };
      r += 2;
    }
    const fill = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const c = order.customer;

    cells([
      { label: "Customer PO", value: order.customerPo, mono: true },
      { label: "Order received", value: EO.humanDate(order.orderDate), mono: true },
      { label: "Ship by", value: EO.humanDate(order.shipBy), mono: true, bold: true, hi: true },
      { label: "Priority", value: order.priority }
    ]);
    cells([
      { label: "Total pieces", value: EO.orderTotal(order), mono: true, bold: true, big: true, hi: true },
      { label: "Items", value: order.items.length, mono: true },
      { label: "Prepared by", value: order.preparedBy },
      { label: "Sheet issued", value: EO.humanDate(order.issuedDate || EO.todayISO()), mono: true }
    ]);
    heading("Customer");
    cells([
      { label: "Customer / club", value: c.name, span: 2, bold: true },
      { label: "Contact", value: [c.contact, c.phone, c.email].map(EO.str).filter(Boolean).join("\n"), span: 2 }
    ]);
    cells([{ label: "Ship to", value: c.shipTo, span: 4 }]);

    const open = EO.openChecks(order);
    if (open.length) {
      r++;
      put(r, 0, "CHECK BEFORE PRODUCTION — CONFIRM WITH CUSTOMER", { font: { bold: true, size: 9, color: { argb: "FF8A4A22" } }, fill: fill(WARN) });
      merge(r, 0, r, COLS - 1);
      r++;
      for (const q of open) {
        put(r, 0, "• " + q, { fill: fill(WARN), alignment: { wrapText: true, vertical: "top" } });
        merge(r, 0, r, COLS - 1);
        ws.getRow(r).height = 15 * Math.max(1, Math.ceil(q.length / 110));
        r++;
      }
    }

    heading("Items");
    order.items.forEach((it, i) => {
      const sizes = it.sizes.length ? it.sizes : ["QTY"];
      const last = Math.max(COLS - 1, sizes.length + 1);
      put(r, 0, "ITEM " + EO.pad(i + 1, 2), { font: { bold: true, name: "Courier New" }, fill: fill(HEAD) });
      put(r, 1, EO.itemTitle(it).toUpperCase(), { font: { bold: true, size: 11 }, fill: fill(HEAD) });
      merge(r, 1, r, last - 2);
      put(r, last - 1, EO.itemTotal(it) + " PCS", { font: { bold: true, name: "Courier New" }, alignment: { horizontal: "right" }, fill: fill(HEAD) });
      merge(r, last - 1, r, last);
      for (let k = 0; k <= last; k++) ws.getCell(r, k + 1).border = { top: { style: "medium", color: { argb: INK } }, bottom: { style: "thin", color: { argb: INK } } };
      r++;
      cells([{ label: "Style ref", value: it.styleRef }, { label: "Decoration", value: it.decoration }, { label: "Colours", value: EO.itemColours(it), span: 2 }]);
      cells([{ label: "Fabric & weight", value: it.fabric, span: 2 }, { label: "Placements", value: it.placements, span: 2 }]);
      cells([{ label: "Trims & labels", value: it.trims, span: 4 }]);
      cells([{ label: "Item notes", value: it.notes, span: 4 }]);

      const hdr = r;
      put(hdr, 0, "COLOUR", { font: { size: 8, color: { argb: MUTED } }, fill: fill(HEAD), border: box });
      sizes.forEach((sz, k) => put(hdr, k + 1, sz, { font: { size: 9, name: "Courier New" }, alignment: { horizontal: "center" }, fill: fill(HEAD), border: box }));
      put(hdr, sizes.length + 1, "TOTAL", { font: { bold: true, size: 8 }, alignment: { horizontal: "center" }, fill: fill(TOT), border: box });
      r++;
      const rows = it.rows.length ? it.rows : [EO.blankRow("")];
      for (const row of rows) {
        put(r, 0, dash(row.colour), { border: box });
        sizes.forEach((sz, k) => put(r, k + 1, EO.int(row.q[sz]) || null, { font: { bold: true, name: "Courier New", size: 11 }, alignment: { horizontal: "center" }, border: box }));
        put(r, sizes.length + 1, { formula: "SUM(" + col(1) + r + ":" + col(sizes.length) + r + ")", result: EO.rowTotal(it, row) },
          { font: { bold: true, name: "Courier New", size: 11 }, alignment: { horizontal: "center" }, fill: fill(TOT), border: box });
        r++;
      }
      if (rows.length > 1) {
        const first = r - rows.length, lastRow = r - 1;
        put(r, 0, "TOTAL", { font: { bold: true }, fill: fill(TOT), border: box });
        sizes.forEach((sz, k) => put(r, k + 1, { formula: "SUM(" + col(k + 1) + first + ":" + col(k + 1) + lastRow + ")", result: EO.sizeTotal(it, sz) },
          { font: { bold: true, name: "Courier New", size: 11 }, alignment: { horizontal: "center" }, fill: fill(TOT), border: box }));
        put(r, sizes.length + 1, { formula: "SUM(" + col(sizes.length + 1) + first + ":" + col(sizes.length + 1) + lastRow + ")", result: EO.gridTotal(it) },
          { font: { bold: true, name: "Courier New", size: 12 }, alignment: { horizontal: "center" }, fill: fill("FFD3DED6"), border: box });
        r++;
      }
      if (it.roster.length) put(r++, 0, "Roster: " + it.roster.length + " players, see the Roster sheet.", { font: { italic: true, size: 9, color: { argb: MUTED } } });
      r++;
    });

    heading("Artwork & decoration");
    cells([{ label: "Files received", value: order.artwork.files, span: 2 }, { label: "Colour codes", value: order.artwork.colourCodes, span: 2 }]);
    cells([{ label: "Names & numbers", value: order.artwork.namesNumbers, span: 2 }, { label: "Pre-production sample", value: order.artwork.sample, span: 2 }]);
    cells([{ label: "Artwork notes", value: order.artwork.notes, span: 4 }]);
    if (order.pictures.length) put(r++, 0, order.pictures.length + " reference picture(s): see the Pictures sheet.", { font: { italic: true, size: 9, color: { argb: MUTED } } });

    heading("Production schedule");
    const sc = order.schedule;
    cells([
      { label: "Cutting", value: EO.humanDate(sc.cutting), mono: true }, { label: "Stitching", value: EO.humanDate(sc.stitching), mono: true },
      { label: "QC / finishing", value: EO.humanDate(sc.qc), mono: true }, { label: "Dispatch", value: EO.humanDate(sc.dispatch), mono: true, hi: true }
    ]);
    heading("Packing & dispatch");
    cells([{ label: "Packing", value: order.packing.packing, span: 4 }]);
    cells([{ label: "Labels & tags", value: order.packing.labels, span: 2 }, { label: "Shipping method", value: order.packing.shipping, span: 2 }]);
    cells([{ label: "Notes for production", value: order.notes, span: 4 }]);

    r += 2;
    ["Prepared by / date", "Approved by / date", "Production manager / date"].forEach((label, i) => {
      const c0 = i * 4;
      if (i === 0) put(r, c0, order.preparedBy || "");
      for (let k = c0; k < c0 + 3; k++) ws.getCell(r, k + 1).border = { bottom: { style: "thin", color: { argb: INK } } };
      put(r + 1, c0, label.toUpperCase(), { font: { size: 7, color: { argb: MUTED } } });
    });

    ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddFooter: "&L" + (s.companyName || "Ennoble International").toUpperCase() + " — INTERNAL PRODUCTION DOCUMENT&RPage &P of &N" };
    ws.views = [{ showGridLines: false }];
  }

  function breakdownSheet(wb, order) {
    const ws = wb.addWorksheet("Size Breakdown");
    ws.columns = [
      { header: "Item", key: "item", width: 7 }, { header: "Group", key: "group", width: 14 }, { header: "Product", key: "product", width: 30 },
      { header: "Style ref", key: "style", width: 14 }, { header: "Colour", key: "colour", width: 18 }, { header: "Size", key: "size", width: 10 },
      { header: "Qty", key: "qty", width: 8 }, { header: "Decoration", key: "deco", width: 22 }, { header: "Fabric", key: "fabric", width: 24 }
    ];
    order.items.forEach((it, i) => {
      for (const row of it.rows) for (const sz of it.sizes) {
        const q = EO.int(row.q[sz]);
        if (q) ws.addRow({ item: EO.pad(i + 1, 2), group: it.group, product: it.product, style: it.styleRef, colour: row.colour, size: sz, qty: q, deco: it.decoration, fabric: it.fabric });
      }
    });
    const n = ws.rowCount;
    ws.addRow({});
    ws.addRow({ size: "TOTAL", qty: { formula: "SUM(G2:G" + n + ")", result: EO.orderTotal(order) } }).font = { bold: true };
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    ws.autoFilter = { from: "A1", to: "I1" };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  function rosterSheet(wb, order) {
    if (!order.items.some(it => it.roster.length)) return;
    const ws = wb.addWorksheet("Roster");
    ws.columns = [
      { header: "Item", key: "item", width: 7 }, { header: "Product", key: "product", width: 28 }, { header: "#", key: "n", width: 5 },
      { header: "Name", key: "name", width: 24 }, { header: "Number", key: "number", width: 9 }, { header: "Size", key: "size", width: 9 },
      { header: "Qty", key: "qty", width: 6 }, { header: "Notes", key: "notes", width: 30 }
    ];
    order.items.forEach((it, i) => it.roster.forEach((p, k) => ws.addRow({
      item: EO.pad(i + 1, 2), product: it.product, n: k + 1, name: p.name, number: p.number, size: p.size,
      qty: p.qty === "" || p.qty == null ? 1 : EO.int(p.qty), notes: p.notes
    })));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  function picturesSheet(wb, order) {
    if (!order.pictures.length) return;
    const ws = wb.addWorksheet("Pictures");
    ws.columns = [{ width: 60 }, { width: 50 }];
    const idx = {};
    order.items.forEach((it, i) => { idx[it.id] = i; });
    let r = 1;
    for (const p of order.pictures) {
      const k = Math.min(1, 380 / Math.max(p.w || 380, 1), 260 / Math.max(p.h || 260, 1));
      const w = Math.round((p.w || 380) * k), h = Math.round((p.h || 260) * k);
      const id = wb.addImage({ base64: p.dataUrl.split(",")[1], extension: "jpeg" });
      ws.addImage(id, { tl: { col: 0, row: r - 1 }, ext: { width: w, height: h } });
      const rowsUsed = Math.ceil(h / 20) + 1;
      for (let i = 0; i < rowsUsed; i++) ws.getRow(r + i).height = 15;
      ws.getCell(r, 2).value = (p.item in idx ? "Item " + EO.pad(idx[p.item] + 1, 2) + ": " : "") + (p.caption || "");
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
      r += rowsUsed + 1;
    }
  }

  EO.makeSheetXlsx = async function (order) {
    await EO.loadScript(EO.VENDOR.exceljs);
    const wb = new window.ExcelJS.Workbook();
    wb.creator = EO.settings().companyName || "Ennoble International";
    wb.created = new Date();
    sheetLayout(wb.addWorksheet("Order Sheet"), order);
    breakdownSheet(wb, order);
    rosterSheet(wb, order);
    picturesSheet(wb, order);
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };
})(window.EO);
