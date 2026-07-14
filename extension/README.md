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
| **Autofill Application** | Loads your profile from `/api/profile` (+ preferences and employment), then fills **empty, visible** fields on the page: name, email, phone, city, country, current title/company, years of experience, expected salary, nationality, work authorization, sponsorship (Yes/No), relocation (Yes/No), LinkedIn. Anything it couldn't answer is listed under **Needs your answer** in the popup. |
| **Open CareerPilot** | Opens the app (`app/index.html`). Needs the file-URL toggle from step 6. |

Job detection has dedicated selectors for **LinkedIn, Bayt, GulfTalent, Workday,
Greenhouse, Lever**, and a generic fallback for company career pages.

## What it deliberately does NOT do

- No automatic submission — ever. Review every field, then click Apply yourself.
- No overwriting: a field with any existing value is left exactly as it is.
- No guessing: notice period and current salary aren't stored in CareerPilot, so
  they're surfaced as questions instead of being invented. Nationality is filled
  only when your work-authorization status is "Citizen".
- No CAPTCHA handling, no account creation, no background browsing.
