/* Password protection, all inside the browser.
   - The company password opens the tool. On each computer it unwraps a random data key that encrypts
     the saved orders and the Gemini key(s) stored there.
   - The worker link carries the company settings and (optionally) the company Gemini key, encrypted
     with the company password, so the link alone is useless.
   - The admin password (a salted hash in the settings) unlocks the settings for the session. */
(function (EO) {
  "use strict";

  const ITER = 310000; // PBKDF2-SHA256 rounds: slow enough to make guessing a leaked link expensive
  const VAULT = "eo.vault", SECRET = "eo.secret", SESSION = "eo.session", ADMIN = "eo.admin";
  const te = new TextEncoder(), td = new TextDecoder();

  const store = area => ({
    get(k) { try { return area().getItem(k); } catch (e) { return null; } },
    set(k, v) { try { area().setItem(k, v); } catch (e) { /* storage blocked: stays in memory */ } },
    del(k) { try { area().removeItem(k); } catch (e) { /* nothing to remove */ } }
  });
  const ls = store(() => localStorage), ss = store(() => sessionStorage);

  function toB64(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const rand = n => crypto.getRandomValues(new Uint8Array(n));

  async function baseKey(password) {
    return crypto.subtle.importKey("raw", te.encode(String(password)), "PBKDF2", false, ["deriveKey", "deriveBits"]);
  }
  async function kek(password, salt) {
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, await baseKey(password),
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function hashBits(password, salt) {
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, await baseKey(password), 256));
  }
  async function sealBytes(key, bytes) {
    const iv = rand(12);
    return { iv, ct: new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes)) };
  }
  async function openBytes(key, box) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.iv }, key, box.ct));
  }
  const sealJSON = async (key, obj) => sealBytes(key, te.encode(JSON.stringify(obj)));
  const openJSON = async (key, box) => JSON.parse(td.decode(await openBytes(key, box)));
  const boxOut = b => ({ iv: toB64(b.iv), ct: toB64(b.ct) });
  const boxIn = b => ({ iv: fromB64(b.iv), ct: fromB64(b.ct) });

  let dek = null;      // this computer's data key, only while unlocked
  let secrets = null;  // { companyKey, ownKey, useOwn }
  const blankSecrets = () => ({ companyKey: "", ownKey: "", useOwn: false });

  const V = EO.vault = {};
  V.isProtected = () => !!ls.get(VAULT);
  V.isUnlocked = () => !!dek;
  V.secrets = () => Object.assign(blankSecrets(), secrets);
  // The key Gemini calls use: the worker's own key when they chose it, else the company key.
  V.activeKey = function () {
    const s = V.secrets();
    return s.useOwn && s.ownKey ? s.ownKey : (s.companyKey || s.ownKey || "");
  };

  async function saveSecrets() { ls.set(SECRET, JSON.stringify(boxOut(await sealJSON(dek, V.secrets())))); }
  V.setSecrets = async function (patch) { secrets = Object.assign(V.secrets(), patch); await saveSecrets(); };

  async function useDek(raw) {
    dek = await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
    ss.set(SESSION, toB64(raw)); // reloads in this tab stay unlocked; closing the browser locks again
    const stored = ls.get(SECRET);
    secrets = stored ? await openJSON(dek, boxIn(JSON.parse(stored))) : blankSecrets();
  }
  async function wrap(password, raw) {
    const salt = rand(16);
    ls.set(VAULT, JSON.stringify({ v: 1, salt: toB64(salt), wrapped: boxOut(await sealBytes(await kek(password, salt), raw)) }));
  }
  async function unwrapWith(password, vault) {
    try { return await openBytes(await kek(password, fromB64(vault.salt)), boxIn(vault.wrapped)); }
    catch (e) { return null; }
  }

  V.resume = async function () {
    const raw = ss.get(SESSION);
    if (!raw || !V.isProtected()) return false;
    try { await useDek(fromB64(raw)); return true; }
    catch (e) { ss.del(SESSION); dek = null; return false; }
  };
  V.unlock = async function (password) {
    const raw = await unwrapWith(password, JSON.parse(ls.get(VAULT)));
    if (!raw) return false;
    await useDek(raw);
    return true;
  };
  V.lock = function () { dek = null; secrets = null; ss.del(SESSION); ss.del(ADMIN); };
  V.create = async function (password, initial) {
    const raw = rand(32);
    await wrap(password, raw);
    ls.del(SECRET); // anything left over was sealed with another data key
    await useDek(raw);
    secrets = Object.assign(blankSecrets(), initial);
    await saveSecrets();
  };
  V.changePassword = async function (newPassword) {
    await wrap(newPassword, new Uint8Array(await crypto.subtle.exportKey("raw", dek)));
  };
  V.destroy = function () { ls.del(VAULT); ls.del(SECRET); V.lock(); };

  /* ---------- admin password ---------- */
  V.makeAdmin = async function (password) {
    const salt = rand(16);
    return { salt: toB64(salt), hash: toB64(await hashBits(password, salt)) };
  };
  V.checkAdmin = async function (password) {
    const a = EO.settings().admin;
    if (!a || !a.salt) return false;
    if (toB64(await hashBits(password, fromB64(a.salt))) !== a.hash) return false;
    ss.set(ADMIN, "1");
    return true;
  };
  // No admin password set (an unprotected computer): everyone may change settings.
  V.isAdmin = () => !(EO.settings().admin && EO.settings().admin.hash) || ss.get(ADMIN) === "1";

  /* ---------- saved orders ---------- */
  V.sealOrder = async order => ({ id: order.id, updatedAt: order.updatedAt || 0, enc: await sealJSON(dek, order) });
  V.openOrder = async rec => openJSON(dek, rec.enc);

  /* ---------- the worker link ---------- */
  V.checkPassword = async password => !!(await unwrapWith(password, JSON.parse(ls.get(VAULT))));
  V.makeJoinLink = async function (password, payload) {
    if (!(await V.checkPassword(password))) throw new Error("That isn't the company password.");
    const salt = rand(16);
    const box = await sealJSON(await kek(password, salt), payload);
    const packed = btoa(JSON.stringify({ v: 1, lv: payload.lv || 1, s: toB64(salt), i: toB64(box.iv), c: toB64(box.ct) }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return location.origin + location.pathname + "#join=" + packed;
  };
  const unpack = packed => JSON.parse(atob(packed.replace(/-/g, "+").replace(/_/g, "/")));
  // The version shown on the outside lets an old link be turned away before any password is typed.
  V.joinVersion = function (packed) {
    try { return Number(unpack(packed).lv) || 1; } catch (e) { return 1; }
  };
  V.readJoin = async function (packed, password) {
    try {
      const o = unpack(packed);
      return await openJSON(await kek(password, fromB64(o.s)), { iv: fromB64(o.i), ct: fromB64(o.c) });
    } catch (e) { return null; }
  };

  /* ---------- site-wide rules from access.json in the repo: who may open the tool, which links still work ---------- */
  const ACCESS = "eo.access";
  let access = { locked: true, linkVersion: 1 };
  V.loadAccess = async function () {
    try {
      const r = await fetch("access.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("access.json: " + r.status);
      const a = await r.json();
      access = { locked: a.locked !== false, linkVersion: Math.max(1, Math.floor(Number(a.linkVersion) || 1)) };
      ls.set(ACCESS, JSON.stringify(access));
    } catch (e) {
      // offline or missing: keep the last rules this computer saw
      try { Object.assign(access, JSON.parse(ls.get(ACCESS) || "{}")); } catch (err) { /* keep the defaults */ }
    }
    return access;
  };
  V.access = () => Object.assign({}, access);

  /* ---------- backups: records stay encrypted, the data key travels wrapped by the password ---------- */
  V.backupHeader = () => JSON.parse(ls.get(VAULT));
  V.recordOut = rec => ({ id: rec.id, updatedAt: rec.updatedAt, enc: boxOut(rec.enc) });
  V.openBackup = async function (header, records, password) {
    const raw = await unwrapWith(password, header);
    if (!raw) return null;
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const out = [];
    for (const r of records) { try { out.push(await openJSON(key, boxIn(r.enc))); } catch (e) { /* damaged record: skipped */ } }
    return out;
  };
})(window.EO);
