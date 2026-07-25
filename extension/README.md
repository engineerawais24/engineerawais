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
6. *(Optional, for the "Open CareerPilot" button)* on the extension's card click
   **Details** → enable **Allow access to file URLs** — the app is a local file.

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
- No CAPTCHA handling, no account creation, no background browsing.

## Troubleshooting

- **"Set Default Résumé" says it's only set for this session** — the `storage`
  permission isn't live yet. If you updated the extension files, go to
  `chrome://extensions` and click **Reload** on CareerPilot Helper so the new
  manifest (with the `storage` permission) takes effect. The popup keeps working
  meanwhile — the résumé is just held in memory until then.
