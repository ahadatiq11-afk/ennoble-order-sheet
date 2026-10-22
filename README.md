# Ennoble Order Sheet Maker

Turns any customer order into the same Ennoble International production order sheet, so the factory floor always works from one layout.

Drop in whatever the customer sent: a PDF, a Word or Excel file, PowerPoint, photos, WhatsApp screenshots, an email or a zip. Google Gemini reads it and fills in the sheet. You check it, fix anything, and download the PDF or Excel, or print it.

**Website:** https://ahadatiq11-afk.github.io/ennoble-order-sheet/

It's free. There's no server: everything runs in the browser. A company password keeps it closed to anyone outside the company.

---

## One-time setup (Ahad)

1. **Get a free Gemini key.** Open https://aistudio.google.com/apikey, sign in with a Google account, and click **Create API key**. Don't turn on billing. Copy the key straight away; it starts with `AQ.` or `AIza`.
2. **Switch the website on** (once). In this GitHub repo go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, and click **Save**. After a minute or two the site is live at the address above.
3. **Set up your computer.** Open the website and type your name, your initials (for example `AA`) and the Gemini key. Click **Save and start**. (On a brand-new setup the site first shows "Ennoble staff only": set `"locked": false` in `access.json`, do steps 3 and 4, then set it back to `true`.)
4. **Turn on the password.** Open **Settings → Password & access**. Choose a **company password** (workers type it to open the tool) and a different **admin password** (only you; it unlocks the settings). Click **Turn on password**.
5. **Invite workers.** In **Settings → Give the tool to a worker**, choose whether the link includes your Gemini key and whether workers may use their own key instead. Then click **Copy worker link**. Send the link on WhatsApp or email, and tell them the company password **separately** (in person or by phone).

## For everyone who makes order sheets

**First time:** open the worker link you were sent and type the company password. Then type your name and initials, choose **Use the company key** (or **Use my own key** and paste your own free key), and click **Save and start**. Bookmark the website.

**After that:** the site asks for the company password each time you open it in a new browser window. **Lock** in the top bar locks it straight away.

**For every order:**

1. **New order:** drop all the customer's files for this one order, or paste the email or WhatsApp text. You can also press Ctrl+V to paste a screenshot.
2. Click **Read the order**. It takes 10–60 seconds.
3. **Check it.** Compare the quantities with the customer's order. Look at the **Check before production** list: these are gaps and contradictions to confirm with the customer. Tick a line once it's sorted; unticked lines print in a red box at the top of the sheet.
4. Fix anything directly. Each item has a **colour × size grid**; use *Quick add* to type a row like `Navy: S 10, M 14, L 8`. Team orders have a **Players** table (name, number, size, plus any extra columns such as length, chest or tailored). Spec boxes and side-by-side descriptions go under **Construction & design details**, and Pantone/CMYK codes under **Colour specifications**.
5. Click **Make order sheet**. Then use **Download PDF**, **Download Excel** or **Print**.

If Gemini can't read an order, click **Fill it in by hand instead**. You get a blank sheet with the customer's text next to it.

## Password and access

- **Staff only:** a computer that wasn't set up with a worker link sees only "Ennoble staff only". This is switched on by `"locked": true` in [`access.json`](access.json).
- **Company password:** needed to open the tool on every computer that was set up with a link. On each computer it also encrypts the saved orders and the Gemini key(s) (AES-256), so someone who opens the browser's storage sees only scrambled data.
- **Admin password:** only Ahad has it. Workers can read orders, make sheets, download backups, choose between the company key and their own, and change their own name, initials and next order number. They can't change the sheet header, the company key or the passwords, make worker links, or restore backups. To change a setting on a worker's computer, open **Settings** there and type the admin password: it unlocks the settings until that browser window is closed or **Lock** is pressed.
- **Worker link:** carries the company name, the admin lock and (if ticked) the company Gemini key, all encrypted with the company password. The link alone is useless, so send the password separately.
- **Links don't expire by themselves.** A link keeps working for anyone who knows the password it was made with, even after you change the password.
- **Cancelling every old link (for example, someone left):**
  1. In AI Studio, make a new Gemini key and delete the old one. This is the real off switch: the old key in old links and on old computers stops working at once.
  2. Open **Settings**, paste the new key into **Company key** and save. If you like, change the company password too.
  3. On GitHub, open [`access.json`](access.json), click the pencil, raise `linkVersion` by 1 (for example `1` to `2`) and click **Commit changes**. Within about 10 minutes every older link is refused, and computers set up with an older link show "Open your new worker link" until they do.
  4. Reload the tool. Your own computer shows the same screen: type the **admin password** to carry on.
  5. In **Settings**, click **Copy worker link** and send the new link (and password) to the people who should keep access. A computer opening it keeps its saved orders. If the password changed, it asks once for the old one.
- **Keep a link for yourself.** Save one current worker link somewhere safe (your notes app). With it, the company password and the admin password you can set up any new computer or phone as admin. If you ever lose every set-up computer, set `"locked": false` in `access.json`, set one computer up again, turn the password on, and set it back to `true`.
- **Their own key:** a worker who chooses **Use my own key** uses their own free daily allowance, which leaves the company key's 20 orders a day for everyone else.
- **The website itself:** workers only use it. Only the people with write access to this GitHub repository can change the site, so keep that to yourself (**Settings → Collaborators**).
- **What it can't stop:** it all runs in the browser and the code is public. Someone who knows the company password can open the browser's developer tools and dig out the company key, or switch off the admin lock or the link check on their own computer. A technical stranger could also run a copy of the code with their own key; they still get none of your orders or keys. That only changes their own copy, never the website or anyone else's computer. Give the password only to people you trust with the key, and use a strong password (at least 8 characters, ideally a short sentence) because a stolen link can be guessed against offline.
- **Backups** made while the password is on stay encrypted. Restoring one asks for the company password that was in use when it was made.

## Good to know

- **Order numbers** look like `EI-26-AA-0001`: year, your initials, then a running number. Each person has their own series, so two computers never give out the same number. You can change the next number in **Settings**.
- **Revisions:** if you change an order after its sheet was downloaded or printed, the next sheet becomes `R2`, then `R3`. The floor can see it's a newer version.
- **Saved orders** stay in the browser on that computer (**Saved orders** in the top bar). Use **Copy as new** for repeat orders. Download a backup now and then from **Settings → Backup**.
- **Free limits:** Google's free tier allows a limited number of reads per minute and per day. If it runs out, the page says so: wait a bit (daily limits reset at midnight US Pacific time, around noon in Pakistan) or fill that order in by hand. For more capacity, turn on billing for the key. Don't make extra keys under other Google accounts to get around the limit: Google's API terms forbid getting around usage limits.
- **Privacy:** on Google's free tier, Google may use what you send to improve its products, and its reviewers may read it. If that matters for a customer, turn on billing for the key in Google AI Studio. It costs cents per order, and nothing else changes.
- **What it reads:** PDF (typed or scanned), Word (.docx and old .doc), Excel (.xlsx, .xls, .csv, .ods), PowerPoint (.pptx), photos and screenshots, emails (.eml and Outlook .msg, attachments included), HTML, text and zip files. Design files (.ai, .eps, .psd, .cdr, embroidery files) are listed under *Files received*.
- **Prices, customer contact people, phone numbers, emails and delivery addresses** are left off on purpose: the sheet goes to the floor and only carries what production needs. Gemini is told not to pick them up, and orders saved by older versions have them removed.
- **What the sheet shows:** an URGENT banner for rush orders; production notes first; approvals (mock-up, pre-print test, customer confirmation, sample); Pantone/CMYK colours; then each item with its specs, colour × size grid, player list and its own mock-ups; size charts and general pictures at the end.
- **Pictures and paper:** each mock-up prints under its own item; size charts and pictures for the whole order go at the end. To save paper the site tries a few picture sizes (down to four in a row) and keeps the version with the fewest pages and no empty page. That takes 3–5 seconds. To move a picture, pick a different item in the box under it in the review screen.
- **Player lists:** if Gemini leaves out a player table, the site rebuilds the list from the customer's own table (Word, Excel) and adds a line to *Check before production* so someone checks it.
- **Usage:** the review screen shows how many tokens Gemini used for that order, and the home screen shows today's reads on that computer. A typical order uses 15,000–25,000 tokens; Google's free limit is counted in requests per day, per key, shared by everyone using that key.

## For developers

Static site, no build step. To run it locally:

```
python3 -m http.server 8000
# open http://localhost:8000
```

| Path | What it does |
| --- | --- |
| `index.html`, `css/app.css` | Page and styles |
| `js/readers.js` | Turns any dropped file into text, PDFs and pictures for Gemini |
| `js/gemini.js` | Picks the best free Flash model, sends the order, falls back on quota or errors |
| `js/model.js` | The order record, size sorting, totals, the automatic checks, upgrading old saved orders |
| `js/app.js` | Screens: intake, review, sheet, saved orders, settings |
| `js/sheet-pdf.js` | The production sheet as a PDF (pdfmake) |
| `js/sheet-xlsx.js` | The Excel copy (ExcelJS) |
| `js/store.js` | Settings (localStorage), order numbers, saved orders (IndexedDB) |
| `js/vault.js` | Company password: encryption of saved orders and keys, the worker link, the admin lock, encrypted backups, the rules in `access.json` |
| `access.json` | Site-wide rules: `locked` (staff only) and `linkVersion` (raise it to cancel old worker links) |

Libraries are vendored in `vendor/`: pdf.js 4.10.38, pdfmake 0.2.23 (with Helvetica/Courier metrics from pdfkit), ExcelJS 4.4.0, JSZip 3.10.1 and SheetJS 0.18.5.

SheetJS 0.18.5 is the last version on npm. It has known issues with deliberately crafted files, so it is only loaded for old `.xls`/`.ods` spreadsheets and old `.doc`/`.msg` files. pdf.js runs with `isEvalSupported: false`. The page's Content-Security-Policy only allows network calls to the Gemini API.

Password protection uses Web Crypto only. Each computer has a random AES-GCM-256 data key, wrapped with a key derived from the company password (PBKDF2-SHA256, 310,000 rounds). Saved orders and the Gemini keys are sealed with that data key. The unwrapped data key sits in `sessionStorage` while the tab is open, so a reload doesn't ask again. The worker link (`#join=`) is the company settings sealed with a key derived from the password and a fresh salt; it is removed from the address bar as soon as the page reads it. The admin password is stored as a salted PBKDF2 hash.
