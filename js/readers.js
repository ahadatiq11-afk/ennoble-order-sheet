/* Turn whatever the customer sent into (1) parts Gemini can read and (2) pictures for the sheet. */
(function (EO) {
  "use strict";

  const BASE = new URL(".", document.baseURI).href;
  const V = {
    jszip: "vendor/jszip-3.10.1.min.js",
    exceljs: "vendor/exceljs-4.4.0.min.js",
    sheetjs: "vendor/xlsx-0.18.5.full.min.js",
    pdfjs: "vendor/pdfjs/pdf-4.10.38.min.mjs",
    pdfworker: "vendor/pdfjs/pdf.worker-4.10.38.min.mjs"
  };
  EO.VENDOR = V;

  const MAX_TEXT = 220000;          // characters of text sent to Gemini
  const MAX_INLINE = 14 * 1024 * 1024; // raw bytes of PDFs/images sent to Gemini (base64 grows it ~33%)
  const MAX_AI_PICTURES = 20;       // pictures Gemini looks at (more are still kept on the sheet)
  const PIC_PX = 1600;              // longest side of a stored picture

  let pdfjsP = null;
  EO.pdfjs = function () {
    if (!pdfjsP) {
      pdfjsP = import(BASE + V.pdfjs).then(m => {
        m.GlobalWorkerOptions.workerSrc = BASE + V.pdfworker;
        return m;
      }).catch(e => { pdfjsP = null; throw new Error("The PDF reader didn't load. Check the internet connection and reload. (" + e.message + ")"); });
    }
    return pdfjsP;
  };
  // isEvalSupported:false closes the font-eval path in pdf.js; customer PDFs are untrusted input.
  EO.openPdf = async function (data) {
    const lib = await EO.pdfjs();
    return lib.getDocument({ data, isEvalSupported: false }).promise;
  };

  /* ---------- pictures ---------- */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("unreadable picture"));
      i.src = src;
    });
  }
  function canvasFrom(src, maxPx) {
    const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
    const k = Math.min(1, maxPx / Math.max(w0 || 1, h0 || 1));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // JPEG has no transparency
    ctx.drawImage(src, 0, 0, w, h);
    return cv;
  }
  // Any browser-readable image -> JPEG data URL no larger than maxPx on its longest side.
  EO.imageToJpeg = async function (blob, maxPx) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      const cv = canvasFrom(img, maxPx || PIC_PX);
      return { dataUrl: cv.toDataURL("image/jpeg", 0.85), w: cv.width, h: cv.height };
    } finally { URL.revokeObjectURL(url); }
  };

  const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", jfif: "image/jpeg" };
  const ARTWORK_ONLY = ["ai", "eps", "psd", "cdr", "dst", "emb", "pes", "exp", "jef", "vp3", "indd", "tif", "tiff", "emf", "wmf", "dxf", "plt"];

  /* ---------- the collection a read builds up ---------- */
  function newCtx(onStatus) {
    return {
      parts: [], texts: [], pictures: [], sources: [], artworkFiles: [], warnings: [],
      inlineBytes: 0, textChars: 0, aiPictures: 0, status: onStatus || function () {},
      addText(t) {
        t = String(t || "");
        if (!t.trim()) return;
        const room = MAX_TEXT - this.textChars;
        if (room <= 0) return;
        if (t.length > room) t = t.slice(0, room) + "\n[...text cut short: the file is very long]";
        this.textChars += t.length;
        this.parts.push({ text: t });
        this.texts.push(t);
      },
      canInline(bytes) { return this.inlineBytes + bytes <= MAX_INLINE; },
      addInline(mime, base64, bytes) {
        this.inlineBytes += bytes;
        this.parts.push({ inline_data: { mime_type: mime, data: base64 } });
      },
      // Register a picture; returns its reference (IMG3) for the text flow.
      async addPicture(blob, name, opts) {
        opts = opts || {};
        let pic;
        try { pic = await EO.imageToJpeg(blob, PIC_PX); }
        catch (e) { this.warnings.push("Couldn't open the picture " + name + "."); return null; }
        if (pic.w < 60 || pic.h < 60) return null; // icons and spacer gifs
        const ref = "IMG" + (this.pictures.length + 1);
        this.pictures.push({ ref, name, dataUrl: pic.dataUrl, w: pic.w, h: pic.h });
        const bytes = EO.dataURLBytes(pic.dataUrl);
        if (!opts.noAI && this.aiPictures < MAX_AI_PICTURES && this.canInline(bytes)) {
          this.aiPictures++;
          this.parts.push({ text: "Picture " + ref + " (" + name + "):" });
          this.addInline("image/jpeg", pic.dataUrl.split(",")[1], bytes);
        }
        return ref;
      }
    };
  }

  /* ---------- XML helpers for Office files ---------- */
  function xml(s) {
    const d = new DOMParser().parseFromString(s, "application/xml");
    if (d.getElementsByTagName("parsererror").length) throw new Error("the file's contents were unreadable");
    return d;
  }
  async function zipOf(file) {
    await EO.loadScript(V.jszip);
    return window.JSZip.loadAsync(await file.arrayBuffer());
  }
  async function relsOf(zip, path) {
    const out = {};
    const f = zip.file(path);
    if (!f) return out;
    const d = xml(await f.async("string"));
    const all = d.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName === "Relationship") out[all[i].getAttribute("Id")] = all[i].getAttribute("Target") || "";
    }
    return out;
  }
  function joinPath(dir, target) {
    if (target.startsWith("/")) return target.slice(1);
    const parts = (dir + "/" + target).split("/");
    const out = [];
    for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
    return out.join("/");
  }
  function embedId(n) {
    for (let i = 0; i < n.attributes.length; i++) {
      const a = n.attributes[i];
      if (a.localName === "embed" || (a.localName === "id" && n.localName === "imagedata")) return a.value;
    }
    return "";
  }
  async function zipImage(zip, path) {
    const f = zip.file(path);
    if (!f) return null;
    const ext = EO.fileExt(path);
    if (!IMG_TYPES[ext]) return null;
    const raw = await f.async("blob");
    return new Blob([raw], { type: IMG_TYPES[ext] });
  }

  /* ---------- Word (.docx) ---------- */
  async function readDocx(file, ctx) {
    const zip = await zipOf(file);
    const doc = zip.file("word/document.xml");
    if (!doc) throw new Error("that doesn't look like a Word file");
    const rels = await relsOf(zip, "word/_rels/document.xml.rels");
    const seen = {};
    const lines = [];

    async function picFor(id) {
      const target = rels[id];
      if (!target) return "";
      const path = joinPath("word", target);
      if (seen[path] !== undefined) return seen[path];
      seen[path] = "";
      const blob = await zipImage(zip, path);
      if (!blob) return "";
      seen[path] = (await ctx.addPicture(blob, file.name + " / " + path.split("/").pop())) || "";
      return seen[path];
    }
    async function runText(node) {
      let s = "";
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === "t") s += c.textContent;
        else if (ln === "tab") s += "\t";
        else if (ln === "br" || ln === "cr") s += "\n";
        else if (ln === "blip" || ln === "imagedata") { const r = await picFor(embedId(c)); if (r) s += " [picture " + r + "] "; }
        else s += await runText(c);
      }
      return s;
    }
    async function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.localName === "p") lines.push((await runText(c)).replace(/[ \t]+$/, ""));
        else if (c.localName === "tbl") {
          lines.push("[table]");
          for (let r = c.firstChild; r; r = r.nextSibling) {
            if (r.nodeType !== 1 || r.localName !== "tr") continue;
            const cells = [];
            for (let cc = r.firstChild; cc; cc = cc.nextSibling) {
              if (cc.nodeType === 1 && cc.localName === "tc") cells.push((await runText(cc)).replace(/\s+/g, " ").trim());
            }
            if (cells.join("")) lines.push("| " + cells.join(" | ") + " |");
          }
          lines.push("[end table]");
        } else await walk(c);
      }
    }
    for (const p of Object.keys(zip.files).filter(p => /^word\/header\d*\.xml$/.test(p))) {
      await walk(xml(await zip.file(p).async("string")).documentElement);
    }
    await walk(xml(await doc.async("string")).documentElement);
    // Pictures in the file that the text never pointed at.
    for (const p of Object.keys(zip.files).filter(p => /^word\/media\//.test(p)).sort()) {
      if (seen[p] === undefined) { seen[p] = ""; const b = await zipImage(zip, p); if (b) await ctx.addPicture(b, file.name + " / " + p.split("/").pop()); }
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ---------- PowerPoint (.pptx): tech packs often arrive this way ---------- */
  async function readPptx(file, ctx) {
    const zip = await zipOf(file);
    const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
    const out = [];
    const seen = {};
    for (const sp of slides) {
      const n = sp.replace(/\D/g, "");
      const rels = await relsOf(zip, "ppt/slides/_rels/slide" + n + ".xml.rels");
      const d = xml(await zip.file(sp).async("string"));
      out.push("--- slide " + n + " ---");
      const all = d.getElementsByTagName("*");
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e.localName === "p" && e.namespaceURI && e.namespaceURI.indexOf("drawingml") > -1) {
          let t = "";
          const ts = e.getElementsByTagName("*");
          for (let j = 0; j < ts.length; j++) if (ts[j].localName === "t") t += ts[j].textContent;
          if (t.trim()) out.push(t.trim());
        } else if (e.localName === "blip") {
          const target = rels[embedId(e)];
          if (!target) continue;
          const path = joinPath("ppt/slides", target);
          if (seen[path] !== undefined) continue;
          const b = await zipImage(zip, path);
          seen[path] = b ? (await ctx.addPicture(b, file.name + " / slide " + n)) || "" : "";
          if (seen[path]) out.push("[picture " + seen[path] + "]");
        }
      }
    }
    return out.join("\n");
  }

  /* ---------- Excel ---------- */
  function cellText(v) {
    if (v == null) return "";
    if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
    if (typeof v === "object") {
      if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join("");
      if ("result" in v) return cellText(v.result);
      if ("text" in v) return cellText(v.text);
      if ("error" in v) return "";
      return "";
    }
    return String(v);
  }
  async function readXlsx(file, ctx) {
    await EO.loadScript(V.exceljs);
    const wb = new window.ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const media = (wb.model && wb.model.media) || [];
    const picRef = {};
    const out = [];
    for (const ws of wb.worksheets) {
      if (ws.state && ws.state !== "visible") continue;
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        if (rows.length > 1500) return;
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, c) => {
          let t = "";
          if (!(cell.isMerged && cell.master && cell.master.address !== cell.address)) t = cellText(cell.value);
          cells[c - 1] = t.replace(/\s+/g, " ").trim();
        });
        for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        if (cells.join("")) rows.push("R" + r + ": | " + cells.join(" | ") + " |");
      });
      const notes = [];
      for (const im of (ws.getImages ? ws.getImages() : [])) {
        const m = media[Number(im.imageId)];
        if (!m || !m.buffer) continue;
        const key = String(im.imageId);
        if (!(key in picRef)) {
          const type = IMG_TYPES[String(m.extension || "").toLowerCase()];
          picRef[key] = type ? (await ctx.addPicture(new Blob([m.buffer], { type }), file.name + " / " + ws.name)) || "" : "";
        }
        if (picRef[key]) {
          const tl = im.range && im.range.tl;
          notes.push("[picture " + picRef[key] + " placed near row " + (tl ? Math.floor(tl.nativeRow != null ? tl.nativeRow : tl.row) + 1 : "?") + "]");
        }
      }
      if (rows.length || notes.length) out.push("--- sheet: " + ws.name + " ---", rows.join("\n"), notes.join("\n"));
    }
    return out.join("\n").trim();
  }
  async function readSheetJS(file) {
    await EO.loadScript(V.sheetjs);
    const wb = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: true });
    const out = [];
    for (const name of wb.SheetNames) {
      const csv = window.XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: " | ", blankrows: false, dateNF: "yyyy-mm-dd" });
      if (csv.replace(/[|\s]/g, "")) out.push("--- sheet: " + name + " ---", csv);
    }
    return out.join("\n");
  }

  /* ---------- PDF ---------- */
  async function pdfPictures(pdf, file, ctx) {
    const lib = await EO.pdfjs();
    const OPS = lib.OPS;
    const done = new Set();
    let text = "";
    const pages = Math.min(pdf.numPages, 40);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      let pageText = "";
      try {
        const tc = await page.getTextContent();
        pageText = tc.items.map(i => i.str + (i.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
      } catch (e) { pageText = ""; }
      if (pageText) text += "\n--- page " + p + " ---\n" + pageText;
      if (ctx.pictures.length >= 40) continue;
      let ops;
      try { ops = await page.getOperatorList(); } catch (e) { continue; }
      const names = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === OPS.paintImageXObject) names.push(ops.argsArray[i][0]);
      }
      // A page that is one big image with almost no text is a scan of the order, not a product picture.
      if (names.length === 1 && pageText.length < 40) continue;
      for (const name of names) {
        if (done.has(name)) continue;
        done.add(name);
        const store = String(name).startsWith("g_") ? page.commonObjs : page.objs;
        const img = await new Promise(res => {
          let settled = false;
          const t = setTimeout(() => { if (!settled) { settled = true; res(null); } }, 4000);
          try { store.get(name, v => { if (!settled) { settled = true; clearTimeout(t); res(v); } }); }
          catch (e) { settled = true; clearTimeout(t); res(null); }
        });
        if (!img || (img.width || 0) < 120 || (img.height || 0) < 120) continue;
        const cv = document.createElement("canvas");
        cv.width = img.width; cv.height = img.height;
        const c2 = cv.getContext("2d");
        try {
          if (img.bitmap) c2.drawImage(img.bitmap, 0, 0);
          else if (img.data) {
            const id = c2.createImageData(img.width, img.height);
            const src = img.data, dst = id.data;
            if (img.kind === 3) dst.set(src.subarray(0, dst.length));
            else if (img.kind === 2) { for (let i = 0, j = 0; j < dst.length; i += 3, j += 4) { dst[j] = src[i]; dst[j + 1] = src[i + 1]; dst[j + 2] = src[i + 2]; dst[j + 3] = 255; } }
            else continue;
            c2.putImageData(id, 0, 0);
          } else continue;
        } catch (e) { continue; }
        const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.9));
        if (blob) await ctx.addPicture(blob, file.name + " p" + p);
      }
    }
    return text.trim();
  }
  async function renderPdfPages(pdf, file, ctx, max) {
    const n = Math.min(pdf.numPages, max);
    for (let p = 1; p <= n; p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2, 1700 / base.width) });
      const cv = document.createElement("canvas");
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      const d = cv.toDataURL("image/jpeg", 0.82);
      const bytes = EO.dataURLBytes(d);
      if (!ctx.canInline(bytes)) break;
      ctx.parts.push({ text: "Page " + p + " of " + file.name + ":" });
      ctx.addInline("image/jpeg", d.split(",")[1], bytes);
    }
  }
  async function readPdf(file, ctx) {
    const buf = await file.arrayBuffer();
    // Gemini reads the PDF itself (layout, tables and scans included) when it fits.
    if (ctx.canInline(buf.byteLength)) {
      ctx.parts.push({ text: "=== FILE: " + file.name + " (PDF, attached below) ===" });
      ctx.addInline("application/pdf", await EO.blobToBase64(new Blob([buf], { type: "application/pdf" })), buf.byteLength);
      let text = "";
      try { const pdf = await EO.openPdf(buf.slice(0)); text = await pdfPictures(pdf, file, ctx); }
      catch (e) { ctx.warnings.push("Pictures couldn't be pulled out of " + file.name + "; add them by hand if needed."); }
      return { text, sent: true };
    }
    // Too big to attach: send its text and pictures of the first pages instead.
    const pdf = await EO.openPdf(buf);
    const text = await pdfPictures(pdf, file, ctx);
    ctx.addText("=== FILE: " + file.name + " (large PDF, text below) ===\n" + text);
    await renderPdfPages(pdf, file, ctx, 8);
    ctx.warnings.push(file.name + " is large, so only its text and first pages were read.");
    return { text, sent: true };
  }

  /* ---------- plain text family ---------- */
  function htmlToText(html) {
    const d = new DOMParser().parseFromString(html, "text/html");
    d.querySelectorAll("script,style,head").forEach(n => n.remove());
    d.querySelectorAll("tr").forEach(tr => {
      const cells = Array.from(tr.children).map(td => td.textContent.replace(/\s+/g, " ").trim());
      tr.textContent = "\n| " + cells.join(" | ") + " |";
    });
    d.querySelectorAll("br,p,div,li,h1,h2,h3,h4,table").forEach(n => n.append("\n"));
    return (d.body ? d.body.textContent : "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }
  function rtfToText(t) {
    return t.replace(/\\par[d]?/g, "\n").replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  // Old binary .doc/.msg: pull out the readable runs. Rough, but Gemini copes with the noise.
  function binaryStrings(buf) {
    const b = new Uint8Array(buf);
    const runs16 = [], runs8 = [];
    let cur = "";
    for (let i = 0; i + 1 < b.length; i += 2) {
      const code = b[i] | (b[i + 1] << 8);
      if ((code >= 32 && code < 0x2500) || code === 9 || code === 10 || code === 13) cur += String.fromCharCode(code);
      else { if (cur.trim().length >= 4) runs16.push(cur); cur = ""; }
    }
    if (cur.trim().length >= 4) runs16.push(cur);
    cur = "";
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) cur += String.fromCharCode(c);
      else { if (cur.trim().length >= 6) runs8.push(cur); cur = ""; }
    }
    const score = arr => arr.join("").replace(/[^A-Za-z]/g, "").length;
    const best = score(runs16) > score(runs8) ? runs16 : runs8;
    return best.join("\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 120000);
  }

  /* ---------- old Office binaries (.doc, Outlook .msg): the OLE container, read with SheetJS's CFB ---------- */
  async function cfbOf(file) {
    await EO.loadScript(V.sheetjs);
    return window.XLSX.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  }
  function cfbStream(cfb, suffix) {
    const i = cfb.FullPaths.findIndex(p => p.toLowerCase().endsWith(suffix.toLowerCase()));
    if (i < 0) return null;
    const c = cfb.FileIndex[i].content;
    return c ? (c instanceof Uint8Array ? c : Uint8Array.from(c)) : null;
  }
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const dec = (enc, bytes) => { try { return new TextDecoder(enc).decode(bytes); } catch (e) { return ""; } };

  // Pictures inside an old Office file: JPEG and PNG data sit whole inside its streams, so find
  // them by their signatures and cut them out. (EMF/WMF drawings can't be shown in a browser.)
  const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  function jpegEnd(b, start) {
    let p = start + 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xFF) return -1;
      while (b[p + 1] === 0xFF && p + 2 < b.length) p++;
      const m = b[p + 1];
      if (m === 0xD9) return p + 2;
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
      const len = (b[p + 2] << 8) | b[p + 3];
      if (len < 2) return -1;
      p += 2 + len;
      if (m === 0xDA) { // scan data runs to the next real marker
        while (p + 1 < b.length && !(b[p] === 0xFF && b[p + 1] !== 0x00 && !(b[p + 1] >= 0xD0 && b[p + 1] <= 0xD7))) p++;
      }
    }
    return -1;
  }
  function carveImages(b) {
    const out = [];
    for (let i = 0; i + 12 < b.length; i++) {
      if (b[i] === 0x89 && b[i + 1] === 0x50 && b[i + 2] === 0x4E && b[i + 3] === 0x47 && b[i + 4] === 0x0D && b[i + 5] === 0x0A && b[i + 6] === 0x1A && b[i + 7] === 0x0A) {
        let p = i + 8, end = -1;
        while (p + 12 <= b.length) {
          const len = be32(b, p);
          const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
          if (len > b.length) break;
          p += 12 + len;
          if (type === "IEND") { end = p; break; }
        }
        if (end > 0 && end <= b.length) { out.push({ type: "image/png", data: b.slice(i, end) }); i = end - 1; }
      } else if (b[i] === 0xFF && b[i + 1] === 0xD8 && b[i + 2] === 0xFF) {
        const end = jpegEnd(b, i);
        if (end > 0) { out.push({ type: "image/jpeg", data: b.slice(i, end) }); i = end - 1; }
      }
    }
    return out;
  }
  async function cfbPictures(cfb, file, ctx) {
    const seen = new Set();
    let n = 0;
    for (const entry of cfb.FileIndex) {
      if (!entry || !entry.content || entry.content.length < 2048) continue;
      const bytes = entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content);
      for (const img of carveImages(bytes)) {
        if (img.data.length < 3000) continue;
        const key = img.data.length + ":" + Array.from(img.data.subarray(img.data.length - 32)).join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        if (await ctx.addPicture(new Blob([img.data], { type: img.type }), file.name + " / picture " + (++n))) { /* added */ }
        if (n >= 30) return;
      }
    }
  }

  // Word 97-2003: follow the piece table to the real text, then cut out the pictures.
  async function readDoc(file, ctx) {
    const cfb = await cfbOf(file);
    try { await cfbPictures(cfb, file, ctx); }
    catch (e) { ctx.warnings.push("Pictures couldn't be pulled out of " + file.name + "; add them by hand if needed."); }
    const w = cfbStream(cfb, "/WordDocument");
    if (!w) throw new Error("not a Word file");
    const tableName = (w[0x0A] | (w[0x0B] << 8)) & 0x0200 ? "/1Table" : "/0Table";
    const t = cfbStream(cfb, tableName);
    const fcClx = u32(w, 0x01A2), lcbClx = u32(w, 0x01A6);
    if (!t || !lcbClx) throw new Error("no text table");
    let pos = fcClx;
    while (pos < fcClx + lcbClx && t[pos] === 0x01) pos += 3 + (t[pos + 1] | (t[pos + 2] << 8));
    if (t[pos] !== 0x02) throw new Error("unexpected text table");
    const lcb = u32(t, pos + 1);
    pos += 5;
    const n = Math.floor((lcb - 4) / 12);
    let out = "";
    for (let i = 0; i < n; i++) {
      const cp0 = u32(t, pos + i * 4), cp1 = u32(t, pos + (i + 1) * 4);
      const raw = u32(t, pos + (n + 1) * 4 + i * 8 + 2);
      const count = cp1 - cp0;
      if (count <= 0 || count > 5e6) continue;
      if (raw & 0x40000000) { const fc = (raw & 0x3FFFFFFF) / 2; out += dec("windows-1252", w.subarray(fc, fc + count)); }
      else { const fc = raw & 0x3FFFFFFF; out += dec("utf-16le", w.subarray(fc, fc + count * 2)); }
    }
    return out
      .replace(/\x13[^\x13\x14\x15]*\x14/g, "").replace(/\x13[^\x13\x15]*\x15/g, "").replace(/[\x14\x15]/g, "")
      .replace(/\x07/g, " | ").replace(/[\r\x0B\x0C]/g, "\n").replace(/[\x01\x08]/g, "[picture]")
      .replace(/[\x00-\x08\x0E-\x1F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Outlook .msg: subject, sender, body, and every attachment read like a dropped file.
  async function readMsg(file, ctx, depth) {
    const cfb = await cfbOf(file);
    // Top-level properties only: attachments and embedded messages carry their own copies deeper in.
    const top = id => {
      for (const suffix of ["001F", "001E"]) {
        const i = cfb.FullPaths.findIndex(p => /^[^/]*\/__substg1\.0_/i.test(p) && p.toUpperCase().endsWith("__SUBSTG1.0_" + id + suffix));
        if (i > -1 && cfb.FileIndex[i].content) {
          const b = Uint8Array.from(cfb.FileIndex[i].content);
          return dec(suffix === "001F" ? "utf-16le" : "windows-1252", b).replace(/\0+$/, "");
        }
      }
      return "";
    };
    let body = top("1000");
    if (!body) {
      const i = cfb.FullPaths.findIndex(p => /^[^/]*\/__substg1\.0_10130102$/i.test(p));
      if (i > -1 && cfb.FileIndex[i].content) body = htmlToText(dec("utf-8", Uint8Array.from(cfb.FileIndex[i].content)));
    }
    const head = ["Subject: " + top("0037"), "From: " + [top("0C1A"), top("5D01") || top("0C1F")].filter(Boolean).join(" "), "Sent: " + top("0039")].filter(l => !/: $/.test(l));
    ctx.addText("=== FILE: " + file.name + " (Outlook email) ===\n" + head.join("\n") + "\n\n" + body);
    const dirs = Array.from(new Set(cfb.FullPaths.map(p => (/^(.*\/__attach_version1\.0_#[0-9A-F]{8}\/)/i.exec(p) || [])[1]).filter(Boolean)));
    for (const d of dirs.slice(0, 20)) {
      const get = suf => { const i = cfb.FullPaths.findIndex(p => p.toLowerCase() === (d + suf).toLowerCase()); return i > -1 && cfb.FileIndex[i].content ? Uint8Array.from(cfb.FileIndex[i].content) : null; };
      const data = get("__substg1.0_37010102");
      if (!data) continue;
      const nm = get("__substg1.0_3707001F") || get("__substg1.0_3704001F");
      const name = nm ? dec("utf-16le", nm).replace(/\0+$/, "") : "attachment";
      if (depth < 2) await readOne(new File([data], name), ctx, depth + 1);
    }
  }

  // .eml / .mht: walk the MIME tree, keep the text, open the attachments.
  function mimeSplit(raw) {
    const m = /\r?\n\r?\n/.exec(raw);
    const headText = m ? raw.slice(0, m.index) : raw;
    const body = m ? raw.slice(m.index + m[0].length) : "";
    const headers = {};
    headText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach(l => {
      const k = l.indexOf(":");
      if (k > 0) headers[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim();
    });
    return { headers, body };
  }
  const param = (h, name) => { const m = new RegExp(name + '\\*?=\\s*"?([^";]+)"?', "i").exec(h || ""); return m ? m[1].replace(/^utf-8''/i, "") : ""; };
  function bytesOf(binary) { const u = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) u[i] = binary.charCodeAt(i) & 255; return u; }
  async function readMime(raw, ctx, depth, out) {
    const { headers, body } = mimeSplit(raw);
    const ct = headers["content-type"] || "text/plain";
    const type = ct.split(";")[0].trim().toLowerCase();
    if (type.startsWith("multipart/")) {
      const b = param(ct, "boundary");
      if (!b) return;
      const parts = body.split("--" + b);
      for (const p of parts.slice(1)) { if (p.startsWith("--")) break; await readMime(p.replace(/^\r?\n/, ""), ctx, depth, out); }
      return;
    }
    const enc = (headers["content-transfer-encoding"] || "").toLowerCase();
    let bin = body;
    if (enc === "base64") { try { bin = atob(body.replace(/[^A-Za-z0-9+/=]/g, "")); } catch (e) { bin = ""; } }
    else if (enc === "quoted-printable") bin = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    const filename = param(headers["content-disposition"], "filename") || param(ct, "name");
    if (!filename && (type === "text/plain" || type === "text/html")) {
      const text = dec(param(ct, "charset") || "utf-8", bytesOf(bin)) || bin;
      if (type === "text/html") { if (!out.plain) out.html = (out.html || "") + htmlToText(text) + "\n"; }
      else out.plain = (out.plain || "") + text + "\n";
      return;
    }
    if (filename && depth < 2) out.files.push(new File([bytesOf(bin)], filename, { type }));
  }
  async function readEml(file, ctx, depth) {
    const raw = dec("latin1", new Uint8Array(await file.arrayBuffer()));
    const { headers } = mimeSplit(raw);
    const out = { files: [] };
    await readMime(raw, ctx, depth, out);
    // =?UTF-8?B?...?= / =?UTF-8?Q?...?= in subjects and sender names.
    const words = s => s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, cs, how, txt) => {
      try {
        const bin = how.toUpperCase() === "B" ? atob(txt) : txt.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
        return dec(cs, bytesOf(bin)) || m;
      } catch (e) { return m; }
    });
    const head = ["subject", "from", "date"].filter(h => headers[h]).map(h => h[0].toUpperCase() + h.slice(1) + ": " + words(headers[h]));
    ctx.addText("=== FILE: " + file.name + " (email) ===\n" + head.join("\n") + "\n\n" + (out.plain || out.html || ""));
    for (const f of out.files.slice(0, 20)) await readOne(f, ctx, depth + 1);
  }

  /* ---------- one file ---------- */
  async function readOne(file, ctx, depth) {
    const ext = EO.fileExt(file.name);
    const type = (file.type || "").toLowerCase();
    const label = file.name || "pasted file";
    ctx.status("Opening " + label + "…");
    ctx.sources.push({ name: label, size: file.size });

    if (type === "application/pdf" || ext === "pdf") { await readPdf(file, ctx); return; }

    if (ext === "docx" || ext === "docm" || ext === "dotx" || type.indexOf("wordprocessingml") > -1) {
      ctx.addText("=== FILE: " + label + " (Word document) ===\n" + await readDocx(file, ctx)); return;
    }
    if (ext === "pptx" || type.indexOf("presentationml") > -1) {
      ctx.addText("=== FILE: " + label + " (PowerPoint) ===\n" + await readPptx(file, ctx)); return;
    }
    if (ext === "xlsx" || ext === "xlsm" || type.indexOf("spreadsheetml") > -1) {
      let t;
      try { t = await readXlsx(file, ctx); } catch (e) { t = await readSheetJS(file); }
      ctx.addText("=== FILE: " + label + " (Excel; each line is one row, cells between | ) ===\n" + t); return;
    }
    if (ext === "xls" || ext === "ods" || ext === "numbers" || ext === "xlsb") {
      ctx.addText("=== FILE: " + label + " (spreadsheet; each line is one row, cells between | ) ===\n" + await readSheetJS(file)); return;
    }
    if (ext === "zip" && depth < 1) {
      const zip = await zipOf(file);
      const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name)).slice(0, 30);
      for (const en of entries) {
        const blob = await en.async("blob");
        await readOne(new File([blob], en.name.split("/").pop()), ctx, depth + 1);
      }
      return;
    }
    if (type.startsWith("image/") || IMG_TYPES[ext] || ext === "heic" || ext === "heif") {
      const ref = await ctx.addPicture(file, label);
      if (ref) { ctx.texts.push("[" + label + " = picture " + ref + "]"); return; }
      // HEIC and friends: the browser can't draw it, but Gemini can read it.
      if (file.size && ctx.canInline(file.size)) {
        ctx.parts.push({ text: "=== FILE: " + label + " (photo) ===" });
        ctx.addInline(ext === "heif" ? "image/heif" : ext === "heic" ? "image/heic" : (type || "image/jpeg"), await EO.blobToBase64(file), file.size);
        return;
      }
      ctx.warnings.push("Couldn't open the picture " + label + ".");
      return;
    }
    if (ARTWORK_ONLY.includes(ext)) {
      ctx.artworkFiles.push(label);
      ctx.addText("=== FILE: " + label + " (artwork/design file, received but not readable here) ===");
      return;
    }
    if (ext === "doc" || ext === "dot") {
      let t;
      try { t = "(old Word file; its pictures are listed above)\n" + await readDoc(file, ctx); }
      catch (e) { t = "(old Word file; text recovered roughly, ignore garbage)\n" + binaryStrings(await file.arrayBuffer()); }
      ctx.addText("=== FILE: " + label + " " + t);
      return;
    }
    if (ext === "msg") {
      try { await readMsg(file, ctx, depth); }
      catch (e) { ctx.addText("=== FILE: " + label + " (Outlook email; text recovered roughly) ===\n" + binaryStrings(await file.arrayBuffer())); }
      return;
    }
    if (ext === "eml" || ext === "mht" || ext === "mhtml") { await readEml(file, ctx, depth); return; }
    let text = await file.text();
    if (ext === "html" || ext === "htm" || type === "text/html" || /^\s*<(!doctype|html)/i.test(text)) text = htmlToText(text);
    else if (ext === "rtf" || /^\{\\rtf/.test(text)) text = rtfToText(text);
    if (text.indexOf("\u0000") > -1) text = binaryStrings(await file.arrayBuffer());
    ctx.addText("=== FILE: " + label + " ===\n" + text);
  }

  /* Read every file plus any pasted text. Never throws for one bad file: it becomes a warning. */
  EO.readInputs = async function (files, pastedText, onStatus) {
    const ctx = newCtx(onStatus);
    if (pastedText && pastedText.trim()) {
      ctx.sources.push({ name: "Pasted text", size: pastedText.length });
      ctx.addText("=== PASTED TEXT (email, WhatsApp or notes) ===\n" + pastedText.trim());
    }
    for (const f of files) {
      try { await readOne(f, ctx, 0); }
      catch (e) { ctx.warnings.push("Couldn't read " + f.name + ": " + (e && e.message ? e.message : e)); }
    }
    return {
      parts: ctx.parts,
      pictures: ctx.pictures,
      sources: ctx.sources,
      artworkFiles: ctx.artworkFiles,
      warnings: ctx.warnings,
      sourceText: ctx.texts.join("\n\n").slice(0, 60000),
      hasContent: ctx.parts.length > 0
    };
  };
})(window.EO);
