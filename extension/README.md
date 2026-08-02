# CareerPilot Helper — Chrome Extension

Save the job posting you're looking at into CareerPilot, and autofill application
forms from your own profile. It fills **only empty fields**, never overwrites an
answer you typed, and **never submits anything** — you always press Apply yourself.

## Load it in Chrome ("Load unpacked")

1. Open Chrome **in the profile you use for job hunting**.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select this folder:
   `C:\Users\m.awais\Desktop\Job Prject\extension`
5. Pin **CareerPilot Helper** from the puzzle-piece menu so it's one click away.
6. *(Optional, only if you open CareerPilot as a `file://` page)* on the extension's
   card click **Details** → enable **Allow access to file URLs**. If you run the app
   from **localhost** (e.g. a local server) this is not needed — the Queue → autofill
   bridge runs on `localhost`/`127.0.0.1` and `file://` alike, via the background
   service worker (no file:// dependency).

## Start the backend (required for Save + Autofill)

```
cd C:\Users\m.awais\Desktop\Job Prject\backend
.venv\Scripts\uvicorn app.main:app --port 8000
```

The extension talks only to `http://127.0.0.1:8000` — your profile never leaves
your machine.

## The three buttons

| Button | What it does |
|---|---|
| **Save Current Job** | Reads the posting (title, company, location, URL, source) off the open tab and saves it via `POST /api/jobs`. Saving the same URL twice is detected ("Already saved"). |
| **Import LinkedIn Jobs** | On an open **LinkedIn Jobs search** page (you must be logged in), reads the job cards already rendered on screen and saves each one (title, company, location, URL, `source = LinkedIn`, date found) via the same `POST /api/jobs`. Duplicates are rejected by URL, so re-running adds nothing new. Reads only the DOM you're already looking at — nothing is fetched or scraped. Scroll the results list first so more cards render. |
| **Autofill Application** | Loads your profile from `/api/profile` (+ preferences and employment), then fills **empty, visible** fields on the page across every common control — text, email, phone, number, textarea, **select dropdowns**, **radio buttons**, **checkboxes**, and the **résumé upload** — for: name, email, phone, city, country, current title/company, years of experience, nationality, gender, marital status, work authorization, sponsorship (Yes/No), relocation (Yes/No), LinkedIn. Anything it couldn't answer is listed under **Needs your answer** in the popup. |
| **Set Default Résumé** | Pick your résumé (PDF or DOCX, ≤ 2.5 MB) once. It's stored in the extension and **Autofill** attaches it to the résumé/CV file input on application forms. Use the same file as your CareerPilot master résumé. It never leaves your machine. |
| **Open CareerPilot** | Opens the app (`app/index.html`). Needs the file-URL toggle from step 6. |

Job detection has dedicated selectors for **LinkedIn, Bayt, GulfTalent, Workday,
Greenhouse, Lever**, and a generic fallback for company career pages.

## Job Discovery v1 — "Fetch Jobs Now"

The button lives in **CareerPilot → Today's Jobs**, not in this popup. Save one
search URL per portal (LinkedIn Jobs, Bayt, GulfTalent) — the address you see in
Chrome after running that search — then click **Fetch Jobs Now**.

The extension then, for each saved search:

1. opens it in a **background tab of this same Chrome**, so it runs in the session
   you are already signed into — nothing logs in, and no credential is read or stored;
2. injects `harvest.js` and reads the job cards on screen — title, company,
   location, job URL, source and the portal's own job id;
3. deduplicates by **source job id** *and* by **exact job URL**, then saves each job
   through the same `POST /api/jobs` as **Save Current Job**;
4. closes the tab and reports four plain counts: **found · saved · duplicate · failed**.

**LinkedIn is scrolled, because it has to be.** LinkedIn virtualizes its results
list — only the cards near the viewport exist in the page at any moment, and the
ones you scroll past are destroyed again. Reading a freshly opened tab once
returned a single job against a search showing "99+ results". So the LinkedIn
harvest scopes itself to the **left results list** (never the job-details panel on
the right, which carries its own `/jobs/view/` links), scrolls the results
container in rounds, and collects newly rendered cards by LinkedIn job id after
each round. It stops after **3 consecutive rounds with no new job id**, or at
**50 unique jobs**. Promoted cards repeat a posting — under the same job id, or
occasionally a second id for the same title, company and location — and are saved
once either way.

Each source reports how the read went: **scroll rounds · card candidates · unique
ids · parsed · failed cards**. If cards were clearly on screen but almost nothing
could be read, the source is reported as a **harvest failure** rather than as a
run that found one job — a silent partial result is what hid the bug the first
time. Bayt and GulfTalent render their whole results page at once, so they still
take a single read.

If a portal shows a **login wall or a CAPTCHA**, that source is marked **Needs
Attention** and nothing is harvested from it — it is reported, never worked around.
Open that saved search in Chrome, sign in or clear the CAPTCHA, and fetch again.

The saved jobs are pulled into Today's Jobs immediately. No matching, scoring,
autofill or application step runs — discovery only.

Host permissions for `linkedin.com`, `bayt.com` and `gulftalent.com` exist purely
for this; a saved search URL that doesn't belong to its portal is never opened.

## What it deliberately does NOT do

- No automatic submission — ever. Review every field, then click Apply yourself.
- No overwriting: a field with any existing value is left exactly as it is.
- No guessing: notice period and current salary aren't stored in CareerPilot, so
  they're surfaced as questions instead of being invented. Nationality is filled
  only when your work-authorization status is "Citizen".
- **No salary, ever** — current or expected salary/compensation fields are never
  filled, whatever your profile holds.
- **No consenting on your behalf** — agreement, terms, privacy, and marketing
  checkboxes are never auto-ticked; they're surfaced for you to decide.
- No CAPTCHA handling, no account creation. The only background browsing is the
  tab **Fetch Jobs Now** opens for a saved search you set yourself — it reads that
  page, scrolls its results list, and closes it. No clicking, no pagination, no
  form is ever touched there.
- No scraping behind a wall: a portal that asks for a login or a CAPTCHA is
  reported as **Needs Attention**, never bypassed.

## Troubleshooting

- **"Set Default Résumé" says it's only set for this session** — the `storage`
  permission isn't live yet. If you updated the extension files, go to
  `chrome://extensions` and click **Reload** on CareerPilot Helper so the new
  manifest (with the `storage` permission) takes effect. The popup keeps working
  meanwhile — the résumé is just held in memory until then.
