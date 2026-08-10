"""Import jobs from public ATS job feeds (Greenhouse, Lever).

These are the vendors' OWN public JSON board APIs — no auth, no scraping,
no HTML parsing:

    Greenhouse:  https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
    Lever:       https://api.lever.co/v0/postings/<slug>?mode=json

Companies to import are listed in `backend/ats_sources.json`; only the ones
with `enabled: true` are fetched. Each posting is normalised to the fields
CareerPilot stores and saved as a Job, de-duplicated by job URL.

The network call is injectable (`fetch=`), so tests never touch the network.
"""
from __future__ import annotations

import html
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from sqlalchemy.orm import Session

from ..models import Job, User

CONFIG_PATH = Path(__file__).resolve().parents[2] / "ats_sources.json"

GREENHOUSE_URL = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
LEVER_URL = "https://api.lever.co/v0/postings/{slug}?mode=json"

FetchFn = Callable[[str], Any]


# ---------- config ----------

def load_config(path: Path | None = None) -> list[dict]:
    p = path or CONFIG_PATH
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [c for c in data.get("companies", []) if isinstance(c, dict)]


def enabled_companies(path: Path | None = None) -> list[dict]:
    return [c for c in load_config(path) if c.get("enabled") is True]


# ---------- fetch ----------

def http_get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "CareerPilot/1.0 (+local)"})
    with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 — fixed vendor hosts
        return json.loads(resp.read().decode("utf-8"))


# ---------- normalise ----------

_TAG = re.compile(r"<[^>]+>")


def _plain(text: str, limit: int = 4000) -> str:
    """HTML/entity → plain text. The feeds ship description as HTML."""
    if not text:
        return ""
    t = _TAG.sub(" ", text)
    t = html.unescape(t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit]


def _canonical(url: str) -> str:
    return (url or "").split("?")[0].split("#")[0].rstrip("/")


# ---------- region filter: Saudi Arabia / UAE / GCC / Remote ----------
#
# Boards state location as free text ("Dubai, United Arab Emirates",
# "Remote - US", "Home Based - APAC", "CHI, SF, NYC, SEA, US Remote"). Two
# rules, checked in order:
#
#   1. any GCC / Middle East token  -> keep
#   2. an open-remote token         -> keep, UNLESS the string also names a
#                                      country or region outside the GCC
#
# Rule 2's exclusion is what makes this useful: "Remote" and "Home based -
# Worldwide" are reachable from Riyadh, while "Remote - US", "Austria Remote"
# and "Home Based - APAC" are not, and every one of those appears in the real
# feeds. EMEA is deliberately allowed — the Gulf is inside it.

GCC_RE = re.compile(
    r"(saudi|riyadh|jeddah|dammam|khobar|dhahran|makkah|mecca|medina|\bksa\b|"
    r"united arab emirates|\bu\.?a\.?e\.?\b|dubai|abu dhabi|sharjah|ajman|"
    r"qatar|doha|kuwait|bahrain|manama|\boman\b|muscat|"
    r"\bgcc\b|middle east|\bmena\b)", re.I)

REMOTE_RE = re.compile(r"\b(remote|home[\s-]?based|anywhere|worldwide|global|distributed)\b", re.I)

# Places that make a "remote" posting unreachable from the Gulf. EMEA and
# Middle East are deliberately absent — they include the GCC.
#
# Two groups, because the feeds write regions both ways: word-bounded names
# ("Remote - Germany") and glued compounds ("Remote-WesternEurope", "NORAM"),
# which a \b-anchored pattern never matches. The GCC rule is checked FIRST, so
# a posting listing both ("Dubai, SF, Remote") is still kept.
_FOREIGN_WORDS = (
    r"u\.?s\.?a?\.?|united states|america[ns]?|canada|canadian|brazil|mexico|argentina|"
    r"colombia|chile|peru|"
    r"u\.?k\.?|united kingdom|england|scotland|ireland|dublin|london|"
    r"germany|france|spain|italy|portugal|poland|romania|bulgaria|netherlands|belgium|"
    r"austria|switzerland|sweden|norway|denmark|finland|greece|czech|hungary|serbia|"
    r"croatia|ukraine|turkey|israel|"
    r"india|bengaluru|bangalore|gurugram|china|beijing|shanghai|japan|korea|taiwan|taipei|"
    r"hong kong|singapore|malaysia|kuala lumpur|indonesia|thailand|vietnam|philippines|"
    r"australia|new zealand|"
    r"nigeria|kenya|ghana|south africa|egypt|cairo|morocco|pakistan|karachi|lahore|jordan|amman|"
    # US city / state shorthand that appears in multi-site strings
    r"sf|nyc|sea|chi|nj|ny|ca|il|wa|tx|dc|bay area|san francisco|new york|seattle|chicago|"
    r"austin|boston|denver|atlanta|dallas|phoenix|portland|toronto|palo alto|los angeles"
)
# glued or hyphenated region blocks — matched without a leading word boundary
_FOREIGN_COMPOUND = (
    r"europe|european|nordics?|dach|noram|latam|apac|iberia|benelux|amer(?:ica)?s?|asia|africa"
)
FOREIGN_RE = re.compile(r"(\b(?:%s)\b|(?:%s))" % (_FOREIGN_WORDS, _FOREIGN_COMPOUND), re.I)


def matches_region(location: str) -> bool:
    """True when a posting is in the GCC or is open-remote (see rules above)."""
    loc = (location or "").strip()
    if not loc:
        return False                      # unknown location is not a GCC match
    if GCC_RE.search(loc):
        return True
    if REMOTE_RE.search(loc) and not FOREIGN_RE.search(loc):
        return True
    return False


# ==========================================================================
# HARD FILTERS — a posting must pass all three to be saved.
#
#   Location : Saudi Arabia or Qatar only. UAE, Remote, Global and every
#              other country are rejected.
#   Role     : the title must be one of the target areas (network / cyber /
#              physical security, network + solutions engineering, technical
#              consulting, delivery, implementation, presales, project and
#              programme management, PSIM, ICT).
#   Salary   : reject ONLY when a salary is explicitly disclosed and falls
#              below the floor. An undisclosed salary is KEPT and marked
#              unknown — silence is not a rejection, and is never guessed at.
# ==========================================================================

SAUDI_RE = re.compile(
    r"(saudi|\bk\.?s\.?a\.?\b|riyadh|jeddah|jiddah|dammam|khobar|dhahran|jubail|yanbu|"
    r"mecca|makkah|medina|madinah|tabuk|abha|taif|hail|najran|jazan|qassim|buraidah|neom)", re.I)
QATAR_RE = re.compile(r"(qatar|doha|lusail|al[\s-]?rayyan|al[\s-]?wakrah|al[\s-]?khor)", re.I)


def location_country(location: str) -> str | None:
    """'SA', 'QA', or None. A posting that names Saudi or Qatar qualifies even
    when it also lists another site — the role is genuinely open there. Bare
    'Remote' / 'Global' name no country and are therefore rejected."""
    loc = (location or "").strip()
    if not loc:
        return None
    if SAUDI_RE.search(loc):
        return "SA"
    if QATAR_RE.search(loc):
        return "QA"
    return None


# ---------- titles that contradict the location field ----------
#
# Some boards file a posting under one country while the TITLE names another:
# "Firewall Engineer - Dubai, UAE" listed with location "Saudi Arabia". The
# location field alone would let it through, so the title is cross-checked.
#
# This is a SEPARATE list from FOREIGN_RE on purpose. FOREIGN_RE matches some
# tokens as substrings (it has to, for "Remote-WesternEurope"), and "amer"
# inside "Camera" would flag every "Security Camera Systems Engineer" — a core
# physical-security title. Every entry here is word-bounded, and there are no
# two-letter abbreviations, so a title cannot be rejected by accident.

NON_TARGET_PLACE_RE = re.compile(
    r"\b("
    # UAE and its emirates
    r"united arab emirates|u\.?a\.?e\.?|dubai|abu dhabi|sharjah|ajman|fujairah|"
    r"ras al khaimah|umm al quwain|"
    # Gulf states that are not Saudi Arabia or Qatar
    r"kuwait|bahrain|manama|oman|muscat|"
    # the rest of the region
    r"egypt|cairo|alexandria|jordan|amman|lebanon|beirut|syria|iraq|baghdad|erbil|"
    r"yemen|sudan|libya|tunisia|algeria|morocco|casablanca|"
    # frequently seen on MENA boards
    r"pakistan|karachi|lahore|islamabad|india|mumbai|delhi|bengaluru|bangalore|"
    r"turkey|istanbul|iran|tehran|"
    # further afield
    r"united states|u\.?s\.?a\.?|canada|united kingdom|england|london|ireland|"
    r"germany|berlin|france|paris|spain|italy|netherlands|poland|romania|"
    r"singapore|malaysia|philippines|indonesia|china|beijing|shanghai|japan|tokyo|"
    r"korea|australia|sydney|nigeria|kenya|south africa"
    r")\b", re.I)


def conflicting_location(title: str) -> str | None:
    """A place named in the TITLE that is outside Saudi Arabia and Qatar.

    Returns the offending place, or None. A title that names Saudi Arabia or
    Qatar is treated as a target-country role even if it also lists another
    site — the same way `location_country` treats a multi-site location field,
    so the two rules stay consistent."""
    t = (title or "").strip()
    if not t:
        return None
    if SAUDI_RE.search(t) or QATAR_RE.search(t):
        return None
    m = NON_TARGET_PLACE_RE.search(t)
    return m.group(1) if m else None


# ---------- role: the target areas ----------
#
# Matched against the job TITLE only — a description mentioning "security" is
# not a security role.
#
# Two ways a title qualifies:
#
#   1. ROLE_ALWAYS_RE — a phrase that is a target role on its own, because the
#      words themselves name the field (PSIM, ELV, ICT, OT/ICS security,
#      physical security, smart city, data centre …).
#
#   2. ROLE_DOMAIN_RE + ROLE_NOUN_RE — a technical / security / network / ICT /
#      infrastructure / solution keyword AND a role noun, in the same title.
#
# Rule 2 is what stops a generic title passing on its noun alone: "Manager",
# "Lead", "Engineer", "Consultant", "Sales" and "Analyst" carry no domain, so
# "Project Manager", "Sales Engineer" and "Data Analyst" are all rejected,
# while "Infrastructure Project Manager", "Security Sales Engineer" and
# "Cybersecurity Analyst" pass.

ROLE_ALWAYS_RE = re.compile(r"""(
      \bpsim\b
    | physical\s*security
    | security\s*systems?           | systems?\s*security
    | integrated\s*security
    | \belv\b
    | \bict\b
    | smart\s*cit(?:y|ies)
    | (?:\bot\b|\bics\b|industrial)\s*(?:cyber\s*)?security
    | data\s*cent(?:er|re)
    # "Delivery Lead" / "Delivery Manager" qualify on their own; "Service
    # Delivery Manager" does not, and needs a technical keyword via rule 2
    | (?<!service\s)delivery\s+(?:lead|manager|head)
    | implementation\s+(?:manager|lead|engineer|specialist|consultant|architect)
    | \bit\s+(?:infrastructure|security|manager|director|project\s*manager)\b
)""", re.I | re.X)

ROLE_DOMAIN_RE = re.compile(r"""(
      technical | technolog(?:y|ies)
    | solutions?
    | security | cyber\s*security | \bcybersecurity\b | infosec
    | network(?:s|ing)?
    | infrastructure
    | systems?
    | \bict\b | \bot\b | \bics\b | industrial
    | data\s*cent(?:er|re) | cloud
    | pre[\s\-]?sales
    | firewall
    | telecom(?:munications?)? | unified\s*communications?
    | integration | integrated
    | implementation
    | \belv\b | \bpsim\b | smart\s*cit(?:y|ies)
)""", re.I | re.X)

ROLE_NOUN_RE = re.compile(r"""(
      engineer | architect | consultant | specialist
    | manager | lead(?:er)? | head | director
    | administrator | \badmin\b | analyst | advisor | adviser | officer
    | technician | delivery
)""", re.I | re.X)


def matches_role(title: str) -> bool:
    """True when the job TITLE is in one of the target areas.

    A role noun alone is never enough — it must be paired with a technical,
    security, network, ICT, infrastructure or solution keyword."""
    t = title or ""
    if ROLE_ALWAYS_RE.search(t):
        return True
    return bool(ROLE_DOMAIN_RE.search(t) and ROLE_NOUN_RE.search(t))


# Monthly floors. SAR and QAR are both pegged to the US dollar, so the Qatar
# threshold is the same money: 30,000 SAR = USD 8,000 = ~29,100 QAR.
SAUDI_MIN_SAR_MONTH = 30_000
QATAR_MIN_QAR_MONTH = 29_000
_USD_PER = {"SAR": 1 / 3.75, "QAR": 1 / 3.64, "USD": 1.0}
MIN_USD_MONTH = SAUDI_MIN_SAR_MONTH * _USD_PER["SAR"]      # 8,000 USD / month

_CURRENCY = {
    "sar": "SAR", "sr": "SAR", "﷼": "SAR", "riyal": "SAR", "riyals": "SAR",
    "qar": "QAR", "qr": "QAR",
    "usd": "USD", "$": "USD", "us$": "USD",
}
# a money mention: currency before or after the amount, with an optional range
_AMOUNT = r"(\d[\d,\s]*(?:\.\d+)?)\s*(?:k\b)?"
_SALARY_RE = re.compile(
    r"(?:(?P<cur1>SAR|SR|QAR|QR|USD|US\$|\$|﷼)\s*" + _AMOUNT +
    r"(?:\s*(?:-|–|—|to|up to)\s*" + _AMOUNT.replace("(", "(?:", 1) + r")?"
    r"|" + _AMOUNT + r"\s*(?:-|–|—|to)?\s*(?:\d[\d,\s]*)?\s*(?P<cur2>SAR|SR|QAR|QR|USD|riyals?))",
    re.I)
_PERIOD_RE = re.compile(
    r"\b(per\s+month|monthly|/\s*month|/\s*mo\b|a\s+month|pm\b"
    r"|per\s+annum|per\s+year|annually|annual|yearly|/\s*year|/\s*yr\b|a\s+year|p\.?a\.?\b)", re.I)
_UNDISCLOSED_RE = re.compile(
    r"(salary\s*:?\s*(not disclosed|undisclosed|competitive|negotiable|doe|tbd|confidential)"
    r"|competitive (salary|package|compensation)|salary negotiable)", re.I)


def _to_number(raw: str) -> float | None:
    if raw is None:
        return None
    s = str(raw).replace(",", "").replace(" ", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_salary(text: str) -> dict | None:
    """Pull an explicitly stated salary out of free text.

    Returns {'monthly': <float in currency>, 'currency': 'SAR'|'QAR'|'USD'}
    or None when nothing reliable is stated. Requires BOTH a currency and a
    period — "35,000" alone is not a disclosed salary, and guessing the period
    is exactly the kind of invention this filter exists to prevent."""
    t = (text or "")
    if not t.strip():
        return None

    for m in _SALARY_RE.finditer(t):
        cur_raw = m.group("cur1") or m.group("cur2")
        if not cur_raw:
            continue
        currency = _CURRENCY.get(cur_raw.strip().lower())
        if not currency:
            continue

        nums = [_to_number(g) for g in m.groups()[1:] if g and re.match(r"^[\d,\s.]+$", str(g))]
        nums = [n for n in nums if n]
        if not nums:
            continue
        amount = max(nums)          # a disclosed range: the reachable figure

        # the period has to be stated near the money, not anywhere on the page
        window = t[max(0, m.start() - 60): m.end() + 60]
        p = _PERIOD_RE.search(window)
        if not p:
            return None             # amount with no period → not reliably parseable
        period = p.group(1).lower()
        if re.search(r"(annum|year|yr|annual|p\.?a\.?)", period):
            amount = amount / 12.0

        if amount <= 0:
            return None
        return {"monthly": amount, "currency": currency}
    return None


# ---------- nationality restrictions ----------
#
# Some Gulf postings are open only to Saudi nationals ("Cyber Security
# Consultant - Saudi Nationals Only"). They are not applicable, so they are
# rejected before they reach the board.
#
# The trap: "Saudi National" is also part of real employer names — Saudi
# National Bank, Saudi National Guard — and a job may legitimately mention
# serving Saudi nationals. So a bare mention is NEVER enough: the phrase has to
# read as an eligibility restriction ("only", "must be", "restricted to"), and
# an organisation word immediately after "National(s)" rules the match out.

_ORG_AFTER = (r"(?!\s+(?:bank|guard|institute|company|co\b|corporation|committee|"
              r"centre|center|academy|university|museum|library|airline|airlines|"
              r"council|authority|assembly|championship|team|day|program|programme))")

NATIONALITY_RESTRICTION_RE = re.compile(
    r"("
    # "Saudi Nationals Only", "Saudi National Only", "Saudi nationals candidates only"
    r"saudi\s+nationals?" + _ORG_AFTER + r"[\s,\-–—:]*(?:candidates?[\s,\-–—]*)?only\b"
    # "Only Saudi Nationals", "only open to Saudi nationals", "only for Saudi nationals"
    r"|only\s+(?:open\s+to\s+|for\s+|available\s+(?:to|for)\s+)?saudi\s+nationals?\b"
    # "open to / restricted to / limited to Saudi nationals"
    r"|(?:open|restricted|limited|available)\s+(?:only\s+)?(?:to|for)\s+saudi\s+nationals?\b"
    r"|exclusively\s+(?:to|for)\s+saudi\s+nationals?\b"
    # "must be a Saudi national", "Saudi nationality is required"
    r"|must\s+be\s+(?:a\s+)?saudi\s+national\b"
    r"|saudi\s+national(?:ity)?\s+(?:is\s+)?(?:required|mandatory|essential|a\s+must)\b"
    r")", re.I)


def nationality_restriction(text: str) -> str | None:
    """The phrase restricting a job to Saudi nationals, or None.

    Only explicit eligibility wording counts — a job that merely names the
    Saudi National Bank, or mentions serving Saudi nationals, is not
    restricted."""
    m = NATIONALITY_RESTRICTION_RE.search(text or "")
    return " ".join(m.group(0).split()) if m else None


SALARY_VERIFIED = "verified"     # disclosed and at or above the floor
SALARY_UNKNOWN = "unknown"       # not disclosed — kept, never guessed at
SALARY_BELOW = "below"           # disclosed and under the floor — rejected


def _floor_for(country: str, currency: str) -> float | None:
    """The monthly floor in the posting's own currency, or None if the pair
    makes no sense (e.g. a SAR salary on a Qatar posting)."""
    if currency == "USD":
        return MIN_USD_MONTH
    if country == "SA" and currency == "SAR":
        return float(SAUDI_MIN_SAR_MONTH)
    if country == "QA" and currency == "QAR":
        return float(QATAR_MIN_QAR_MONTH)
    return None


def assess_salary(country: str, text: str) -> dict:
    """{'status': verified|unknown|below, 'monthly':, 'currency':, 'why':}

    Undisclosed is NOT a rejection — it comes back `unknown` so the caller can
    keep the job and label it. Only a figure that is stated AND under the floor
    is `below`. Nothing is ever inferred from a missing number."""
    if _UNDISCLOSED_RE.search(text or ""):
        return {"status": SALARY_UNKNOWN, "monthly": None, "currency": None,
                "why": "salary stated as undisclosed/competitive"}
    found = parse_salary(text)
    if not found:
        return {"status": SALARY_UNKNOWN, "monthly": None, "currency": None,
                "why": "no salary disclosed"}

    amount, currency = found["monthly"], found["currency"]
    floor = _floor_for(country, currency)
    if floor is None:
        # a currency that does not belong to this country — not reliable enough
        # to judge against a floor, so treat it as undisclosed rather than guess
        return {"status": SALARY_UNKNOWN, "monthly": amount, "currency": currency,
                "why": "salary in %s on a %s posting — not comparable" % (currency, country)}
    if amount < floor:
        return {"status": SALARY_BELOW, "monthly": amount, "currency": currency,
                "why": "%.0f %s/month is below the %.0f floor" % (amount, currency, floor)}
    return {"status": SALARY_VERIFIED, "monthly": amount, "currency": currency,
            "why": "%.0f %s/month meets the %.0f floor" % (amount, currency, floor)}


def evaluate(job: dict) -> dict:
    """The single gate every posting goes through before it is saved.

    {'ok': bool, 'reason': str, 'country':, 'salary': <assess_salary result>}"""
    country = location_country(job.get("location", ""))
    if not country:
        return {"ok": False, "reason": "location not Saudi Arabia or Qatar",
                "country": None, "salary": None}

    if not matches_role(job.get("title", "")):
        return {"ok": False, "reason": "title outside the target roles",
                "country": country, "salary": None}

    text = " ".join([str(job.get("description") or ""), str(job.get("title") or "")])

    restricted = nationality_restriction(text)
    if restricted:
        return {"ok": False, "reason": 'restricted to Saudi nationals ("%s")' % restricted,
                "country": country, "salary": None}

    salary = assess_salary(country, text)
    if salary["status"] == SALARY_BELOW:
        return {"ok": False, "reason": salary["why"], "country": country, "salary": salary}
    return {"ok": True, "reason": salary["why"], "country": country, "salary": salary}


def passes_hard_filters(job: dict) -> tuple[bool, str]:
    """Backwards-compatible thin wrapper over evaluate()."""
    r = evaluate(job)
    return r["ok"], r["reason"]


def _iso_date(value: Any) -> str:
    """ISO string or epoch ms → 'YYYY-MM-DD'; '' when unknown."""
    if not value:
        return ""
    if isinstance(value, (int, float)):  # Lever: epoch milliseconds
        try:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        except (ValueError, OSError, OverflowError):
            return ""
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(value))
    return m.group(1) if m else ""


def normalize_greenhouse(company: str, payload: dict) -> list[dict]:
    out = []
    for j in (payload or {}).get("jobs", []) or []:
        url = _canonical(j.get("absolute_url", ""))
        if not url or not j.get("title"):
            continue
        loc = (j.get("location") or {}).get("name", "") if isinstance(j.get("location"), dict) else ""
        out.append({
            "title": str(j.get("title", "")).strip(),
            "company": company,
            "location": (loc or "").strip(),
            "url": url,
            "source": "Greenhouse",
            "source_job_id": f"gh-{j.get('id', '')}" or url,
            "posted_date": _iso_date(j.get("first_published") or j.get("updated_at")),
            "description": _plain(j.get("content", "")),
        })
    return out


def normalize_lever(company: str, payload: list) -> list[dict]:
    out = []
    for j in payload or []:
        url = _canonical(j.get("hostedUrl", "") or j.get("applyUrl", ""))
        if not url or not j.get("text"):
            continue
        cats = j.get("categories") or {}
        out.append({
            "title": str(j.get("text", "")).strip(),
            "company": company,
            "location": str(cats.get("location", "") or "").strip(),
            "url": url,
            "source": "Lever",
            "source_job_id": f"lv-{j.get('id', '')}" or url,
            "posted_date": _iso_date(j.get("createdAt")),
            "description": _plain(j.get("descriptionPlain") or j.get("description", "")),
        })
    return out


def fetch_company(entry: dict, fetch: FetchFn | None = None) -> list[dict]:
    fetch = fetch or http_get_json          # resolved at call time (tests can patch)
    ats = str(entry.get("ats", "")).lower()
    slug = str(entry.get("slug", "")).strip()
    company = str(entry.get("name", "")).strip() or slug
    if not slug:
        return []
    if ats == "greenhouse":
        return normalize_greenhouse(company, fetch(GREENHOUSE_URL.format(slug=slug)))
    if ats == "lever":
        return normalize_lever(company, fetch(LEVER_URL.format(slug=slug)))
    raise ValueError(f"unknown ats '{ats}' for {company}")


# ---------- import (dedupe by URL) ----------

def _existing(db: Session, user: User, job: dict) -> Job | None:
    """Already stored? Deduped on the posting's OWN identity — the ATS job id,
    and the exact apply URL. Never on a loosened/canonical URL: two distinct
    postings can share one, and merging them links a job to the wrong package."""
    by_id = (
        db.query(Job)
        .filter(Job.user_id == user.id,
                Job.source == job["source"],
                Job.source_job_id == job["source_job_id"])
        .first()
    )
    if by_id:
        return by_id
    url = (job.get("url") or "").strip()
    if not url:
        return None
    return db.query(Job).filter(Job.user_id == user.id, Job.apply_url == url).first()


def import_all(db: Session, user: User, fetch: FetchFn | None = None,
               path: Path | None = None, region: bool = True) -> dict:
    """Import every enabled company. `region=False` skips the GCC/Remote filter."""
    fetch = fetch or http_get_json          # resolved at call time (tests can patch)
    companies = enabled_companies(path)
    per_company = []
    saved_rows: list[dict] = []
    total_found = total_imported = total_skipped = total_failed = total_filtered = 0

    for entry in companies:
        name = entry.get("name", entry.get("slug", "?"))
        try:
            jobs = fetch_company(entry, fetch=fetch)
        except Exception as exc:  # noqa: BLE001 — one bad feed must not fail the rest
            per_company.append({
                "company": name, "error": str(exc),
                "found": 0, "saved": 0, "duplicate": 0, "failed": 1, "filtered": 0,
                "imported": 0, "skipped": 0,
            })
            total_failed += 1
            continue

        fetched = len(jobs)
        if region:
            # HARD filters: Saudi Arabia or Qatar, a target-area title, and no
            # disclosed-but-below-floor salary. Each survivor carries its own
            # salary verdict so the saved row can be marked.
            kept = []
            for j in jobs:
                verdict = evaluate(j)
                if verdict["ok"]:
                    j = dict(j, _salary=verdict["salary"])
                    kept.append(j)
        else:
            kept = list(jobs)
        filtered = fetched - len(kept)

        imported = skipped = failed = 0
        for job in kept:
            if _existing(db, user, job):
                skipped += 1
                continue
            # a verified salary is recorded on the row; an unknown one leaves
            # salary_disclosed False, which is how the rest of the app already
            # reads "no salary stated"
            sal = job.get("_salary") or {}
            verified = sal.get("status") == SALARY_VERIFIED
            row = Job(
                user_id=user.id,
                source=job["source"],
                source_job_id=job["source_job_id"],
                title=job["title"],
                company=job["company"],
                location=job["location"],
                description=job["description"],
                apply_url=job["url"],
                canonical_url=_canonical(job["url"]),
                posted_date=job["posted_date"],
                salary=("%.0f" % sal["monthly"]) if verified else "",
                salary_disclosed=verified,
                currency=(sal.get("currency") or "USD") if verified else "USD",
                raw={
                    "ats": entry.get("ats"), "slug": entry.get("slug"),
                    "salary_status": sal.get("status") or SALARY_UNKNOWN,
                    "salary_note": sal.get("why") or "",
                },
            )
            db.add(row)
            try:
                db.commit()
                db.refresh(row)
                imported += 1
                # the stored row, so the app can put it on the board with no second request
                saved_rows.append({
                    "id": row.id, "source": row.source, "source_job_id": row.source_job_id,
                    "title": row.title, "company": row.company, "location": row.location,
                    "apply_url": row.apply_url, "canonical_url": row.canonical_url,
                    "salary_status": sal.get("status") or SALARY_UNKNOWN,
                    "salary": row.salary, "salary_disclosed": row.salary_disclosed,
                    "currency": row.currency,
                })
            except Exception:  # noqa: BLE001 — unique-constraint race → treat as dup
                db.rollback()
                skipped += 1

        per_company.append({
            "company": name, "ats": entry.get("ats"),
            "found": len(kept), "saved": imported, "duplicate": skipped, "failed": failed,
            "filtered": filtered, "fetched": fetched,
            # legacy key names, kept so existing callers/tests keep working
            "imported": imported, "skipped": skipped,
        })
        total_found += len(kept)
        total_imported += imported
        total_skipped += skipped
        total_filtered += filtered

    return {
        "companies": len(companies),
        # the four counts the UI shows
        "found": total_found,
        "saved": total_imported,
        "duplicate": total_skipped,
        "failed": total_failed,
        # how many postings the region filter removed before saving
        "filtered": total_filtered,
        # legacy names
        "imported": total_imported,
        "skipped": total_skipped,
        "detail": per_company,
        "jobs": saved_rows,
    }


# ---------- CLI: `python -m app.services.ats_import` ----------

def _main() -> None:
    from ..database import SessionLocal, init_db
    from .seed import ensure_dev_user

    init_db()
    db = SessionLocal()
    try:
        user = ensure_dev_user(db)
        summary = import_all(db, user)
    finally:
        db.close()
    print(json.dumps(summary, indent=2))
    if not summary["companies"]:
        print("\nNo enabled companies. Set \"enabled\": true in backend/ats_sources.json.")


if __name__ == "__main__":
    _main()
