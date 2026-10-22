/* Small shared helpers. Everything hangs off window.EO so the files can load as plain scripts. */
window.EO = window.EO || {};
(function (EO) {
  "use strict";

  EO.$ = (s, root) => (root || document).querySelector(s);
  EO.$$ = (s, root) => Array.from((root || document).querySelectorAll(s));

  // el("div", {class: "x", onclick: fn}, child, "text", ...)
  EO.el = function (tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else if (k === "value") n.value = v;
        else if (k === "checked") n.checked = !!v;
        else n.setAttribute(k, v === true ? "" : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => x != null && x !== false && n.append(x.nodeType ? x : String(x)));
      else n.append(c.nodeType ? c : String(c));
    }
    return n;
  };

  EO.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  EO.pad = (n, w) => String(n).padStart(w, "0");

  EO.todayISO = function () {
    const d = new Date();
    return d.getFullYear() + "-" + EO.pad(d.getMonth() + 1, 2) + "-" + EO.pad(d.getDate(), 2);
  };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // "2026-10-21" -> "21 Oct 2026"; anything else passes through untouched.
  EO.humanDate = function (s) {
    if (!s) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if (!m) return String(s);
    return Number(m[3]) + " " + MON[Number(m[2]) - 1] + " " + m[1];
  };
  EO.isISODate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());

  EO.debounce = function (fn, ms) {
    let t = null;
    const d = function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(null, args); }, ms);
    };
    d.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    return d;
  };

  EO.str = v => (v == null ? "" : typeof v === "string" ? v.trim() : String(v).trim());
  EO.int = function (v) {
    if (v == null || v === "") return 0;
    const n = Math.round(Number(String(v).replace(/[, ]/g, "")));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  EO.intOrNull = function (v) {
    if (v == null || v === "") return null;
    const n = Math.round(Number(String(v).replace(/[, ]/g, "")));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  EO.fileExt = name => ((/\.([a-z0-9]+)$/i.exec(name || "") || [])[1] || "").toLowerCase();

  EO.blobToDataURL = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error || new Error("could not read file"));
    r.readAsDataURL(blob);
  });
  EO.blobToBase64 = async blob => (await EO.blobToDataURL(blob)).split(",")[1] || "";
  EO.dataURLBytes = d => Math.round(((d || "").length - (d || "").indexOf(",") - 1) * 0.75);

  const loaded = {};
  EO.loadScript = function (src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => res();
        s.onerror = () => { delete loaded[src]; rej(new Error("Could not load " + src + ". Check the internet connection and reload.")); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  };

  EO.downloadBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = EO.el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  EO.safeFilename = s => String(s || "order").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "order";

  let toastTimer = null;
  EO.toast = function (msg, kind) {
    let t = EO.$("#toast");
    if (!t) { t = EO.el("div", { id: "toast", role: "status", "aria-live": "polite" }); document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ""; }, kind === "bad" ? 6000 : 3200);
  };
})(window.EO);
