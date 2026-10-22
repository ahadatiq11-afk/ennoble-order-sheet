# Ennoble Order Sheet Maker

Turns any customer order into the same Ennoble International production order sheet, so the factory floor always works from one layout.

Drop in whatever the customer sent: a PDF, a Word or Excel file, PowerPoint, photos, WhatsApp screenshots, an email or a zip. Google Gemini reads it and fills in the sheet. You check it, fix anything, and download the PDF or Excel, or print it.

**Website:** https://ahadatiq11-afk.github.io/ennoble-order-sheet/

It's free. There's no login and no server: everything runs in the browser.

---

## One-time setup (Ahad)

1. **Get a free Gemini key.** Open https://aistudio.google.com/apikey, sign in with a Google account, and click **Create API key**. Don't turn on billing. Copy the key straight away; it starts with `AQ.` or `AIza`.
2. **Switch the website on** (once). In this GitHub repo go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, and click **Save**. After a minute or two the site is live at the address above.
3. **Set up your computer.** Open the website and type your name, your initials (for example `AA`) and the Gemini key. Click **Save and start**.
4. **Invite colleagues.** Open **Settings → Copy setup link** and send the link on WhatsApp or email. Share it only inside the company: anyone with the link can use the key's free allowance.

## For everyone who makes order sheets

**First time:** open the setup link you were sent, type your name and initials, and click **Save and start**. Bookmark the website.

**For every order:**

1. **New order:** drop all the customer's files for this one order, or paste the email or WhatsApp text. You can also press Ctrl+V to paste a screenshot.
2. Click **Read the order**. It takes 10–60 seconds.
3. **Check it.** Compare the quantities with the customer's order. Look at the **Check before production** list: these are gaps and contradictions to confirm with the customer. Tick a line once it's sorted; unticked lines print in an orange box at the top of the sheet.
4. Fix anything directly. Each item has a **colour × size grid**. Use *Quick add* to type a row like `Navy: S 10, M 14, L 8`. Team orders have a **Roster** (names, numbers, sizes) you can paste in.
5. Click **Make order sheet**. Then use **Download PDF**, **Download Excel** or **Print**.

If Gemini can't read an order, click **Fill it in by hand instead**. You get a blank sheet with the customer's text next to it.

## Good to know

- **Order numbers** look like `EI-26-AA-0001`: year, your initials, then a running number. Each person has their own series, so two computers never give out the same number. You can change the next number in **Settings**.
- **Revisions:** if you change an order after its sheet was downloaded or printed, the next sheet becomes `R2`, then `R3`. The floor can see it's a newer version.
- **Saved orders** stay in the browser on that computer (**Saved orders** in the top bar). Use **Copy as new** for repeat orders. Download a backup now and then from **Settings → Backup**.
- **Free limits:** Google's free tier allows a limited number of reads per minute and per day. If it runs out, the page says so: wait a bit (daily limits reset at midnight US Pacific time), or use a key made under a different Google account. Limits count per Google project, so a second key in the same project doesn't add anything.
- **Privacy:** on Google's free tier, Google may use what you send to improve its products, and its reviewers may read it. If that matters for a customer, turn on billing for the key in Google AI Studio. It costs cents per order, and nothing else changes.
- **What it reads:** PDF (typed or scanned), Word (.docx and old .doc), Excel (.xlsx, .xls, .csv, .ods), PowerPoint (.pptx), photos and screenshots, emails (.eml and Outlook .msg, attachments included), HTML, text and zip files. Design files (.ai, .eps, .psd, .cdr, embroidery files) are listed under *Files received*.
- **Prices** are left off the sheet on purpose: it's a production document.

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
| `js/model.js` | The order record, size sorting, totals and the automatic checks |
| `js/app.js` | Screens: intake, review, sheet, saved orders, settings |
| `js/sheet-pdf.js` | The production sheet as a PDF (pdfmake) |
| `js/sheet-xlsx.js` | The Excel copy (ExcelJS) |
| `js/store.js` | Settings (localStorage), order numbers, saved orders (IndexedDB) |

Libraries are vendored in `vendor/`: pdf.js 4.10.38, pdfmake 0.2.23 (with Helvetica/Courier metrics from pdfkit), ExcelJS 4.4.0, JSZip 3.10.1 and SheetJS 0.18.5.

SheetJS 0.18.5 is the last version on npm. It has known issues with deliberately crafted files, so it is only loaded for old `.xls`/`.ods` spreadsheets and old `.doc`/`.msg` files. pdf.js runs with `isEvalSupported: false`. The page's Content-Security-Policy only allows network calls to the Gemini API.
