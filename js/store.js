/* Settings (localStorage) and saved orders (IndexedDB). Everything stays in this browser on this computer. */
(function (EO) {
  "use strict";

  const SETTINGS_KEY = "eo.settings.v1";
  const DEFAULTS = {
    name: "",
    initials: "",
    apiKey: "",
    model: "",              // last model that worked; tried first next time
    companyName: "Ennoble International",
    companyTagline: "Sportswear · Apparel · Custom Team Uniforms",
    logo: ""                // data URL, optional
  };

  function readLS(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeLS(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }

  EO.settings = function () {
    let s = {};
    try { s = JSON.parse(readLS(SETTINGS_KEY) || "{}") || {}; } catch (e) { s = {}; }
    return Object.assign({}, DEFAULTS, s);
  };
  EO.saveSettings = function (patch) {
    const s = Object.assign(EO.settings(), patch || {});
    if (!writeLS(SETTINGS_KEY, JSON.stringify(s))) EO.toast("This browser won't let the page save settings (private window?).", "bad");
    return s;
  };
  EO.isSetUp = function () {
    const s = EO.settings();
    return !!(s.name && s.initials && s.apiKey);
  };

  /* ---------- Gemini use on this computer, per day (Google's limits are per day too) ---------- */
  const usageKey = () => "eo.usage." + EO.todayISO();
  EO.usageToday = function () {
    try { return Object.assign({ reads: 0, tokens: 0 }, JSON.parse(readLS(usageKey()) || "{}")); }
    catch (e) { return { reads: 0, tokens: 0 }; }
  };
  EO.countUsage = function (tokens) {
    const u = EO.usageToday();
    u.reads += 1;
    u.tokens += Number(tokens) || 0;
    writeLS(usageKey(), JSON.stringify(u));
  };

  /* ---------- order numbers: EI-26-AA-0001, one counter per person per year ---------- */
  function counterKey(initials, yy) { return "eo.counter." + initials + "." + yy; }
  EO.cleanInitials = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  EO.peekNextNumber = function () {
    const s = EO.settings();
    const ini = EO.cleanInitials(s.initials) || "XX";
    const yy = String(new Date().getFullYear()).slice(-2);
    const n = Number(readLS(counterKey(ini, yy)) || "0") + 1;
    return { ini, yy, n, text: "EI-" + yy + "-" + ini + "-" + EO.pad(n, 4) };
  };
  EO.takeNextNumber = function () {
    const p = EO.peekNextNumber();
    writeLS(counterKey(p.ini, p.yy), String(p.n));
    return p.text;
  };
  EO.setNextNumber = function (n) {
    const p = EO.peekNextNumber();
    const v = Math.max(1, Math.floor(Number(n) || 1));
    writeLS(counterKey(p.ini, p.yy), String(v - 1));
  };

  /* ---------- saved orders (IndexedDB, falls back to memory) ---------- */
  const DB_NAME = "ennoble-orders";
  const STORE = "orders";
  let dbp = null;
  const memory = new Map();

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { res(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    });
    return dbp;
  }
  function tx(db, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(st)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("save aborted"));
    });
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  EO.saveOrder = async function (order) {
    const copy = JSON.parse(JSON.stringify(order));
    const db = await openDB();
    if (!db) { memory.set(copy.id, copy); return; }
    try { await tx(db, "readwrite", st => st.put(copy)); }
    catch (e) {
      memory.set(copy.id, copy);
      EO.toast("Couldn't save to this browser's storage (it may be full). The order is kept until you close the tab.", "bad");
    }
  };
  EO.getOrder = async function (id) {
    const db = await openDB();
    if (!db) return memory.get(id) || null;
    const v = await tx(db, "readonly", st => reqP(st.get(id)));
    return v || memory.get(id) || null;
  };
  EO.deleteOrder = async function (id) {
    memory.delete(id);
    const db = await openDB();
    if (db) await tx(db, "readwrite", st => st.delete(id));
  };
  EO.listOrders = async function () {
    const db = await openDB();
    let all = [];
    if (db) {
      try { all = await tx(db, "readonly", st => reqP(st.getAll())); } catch (e) { all = []; }
    }
    for (const v of memory.values()) if (!all.find(o => o.id === v.id)) all.push(v);
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  };
})(window.EO);
