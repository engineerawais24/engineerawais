/* ============================================================
   SkillMatcher — skill confidence and readable gaps (Sprint 29).

   A required skill is matched at one of three confidences:

     exact        you have that skill                      credit 1.00
     related      you have a SYNONYM of it                 credit 0.75
                  ("Cybersecurity" for "Network Security")
     transferable you have a different skill from the same credit 0.40
                  field ("Python" against "PowerShell")
     none         nothing in that field at all             credit 0

   The confidence is internal — it drives the score and the explanation.
   It changes no UI.

   Missing skills are grouped by theme, so a card can say "Automation"
   instead of listing Python, PowerShell and Bash separately.
   ============================================================ */

const SkillMatcher = (() => {

  const CREDIT = { exact: 1, related: 0.75, transferable: 0.4, none: 0 };

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  /* the loose equality the board has always used */
  function looseEqual(a, b) {
    const x = lc(a), y = lc(b);
    if (!x || !y) return false;
    return x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
  }

  const dict = () => (typeof SynonymDictionary !== 'undefined') ? SynonymDictionary : null;

  /* how well does the candidate cover ONE required skill? */
  function classify(required, userSkills) {
    const mine = (userSkills || []).filter(Boolean);

    const exact = mine.find(s => looseEqual(s, required));
    if (exact) return { skill: required, level: 'exact', via: exact, credit: CREDIT.exact };

    const d = dict();
    if (d) {
      const related = mine.find(s => d.sameGroup(s, required));
      if (related) {
        return {
          skill: required, level: 'related', via: related, credit: CREDIT.related,
          note: `${related} is the same as ${d.canonical(required)}`,
        };
      }
      const transferable = mine.find(s => d.sameTheme(s, required));
      if (transferable) {
        return {
          skill: required, level: 'transferable', via: transferable, credit: CREDIT.transferable,
          note: `${transferable} is ${d.themeLabel(required) || 'the same field'}`,
        };
      }
    }
    return { skill: required, level: 'none', via: null, credit: CREDIT.none };
  }

  /* the whole required list at once */
  function evaluate(required, userSkills) {
    const list = (required || []).filter(Boolean);
    const results = list.map(s => classify(s, userSkills));

    const pick = level => results.filter(r => r.level === level).map(r => r.skill);
    const credit = results.reduce((n, r) => n + r.credit, 0);

    return {
      results,
      exact: pick('exact'),
      related: pick('related'),
      transferable: pick('transferable'),
      missing: pick('none'),
      /* the board's long-standing "matched" list = anything we can stand behind */
      matched: results.filter(r => r.level === 'exact' || r.level === 'related').map(r => r.skill),
      credit,
      /* 0–1: the share of what the posting asked for that you can cover */
      ratio: list.length ? credit / list.length : null,
      required: list,
    };
  }

  /* ---------- readable gaps ----------
     Python + PowerShell + Bash → one line: "Automation" */
  function groupMissing(missing) {
    const d = dict();
    const groups = [];
    (missing || []).forEach(skill => {
      const label = (d && d.themeLabel(skill)) || 'Other';
      const g = groups.find(x => x.theme === label);
      if (g) g.skills.push(skill);
      else groups.push({ theme: label, skills: [skill] });
    });
    /* the biggest gap first */
    return groups.sort((a, b) => b.skills.length - a.skills.length);
  }

  /* one short line for the explanation: "Automation (Python, PowerShell)" */
  function describeGaps(missing) {
    return groupMissing(missing).map(g =>
      g.skills.length > 1 ? `${g.theme} (${g.skills.join(', ')})` : g.skills[0]);
  }

  return { CREDIT, looseEqual, classify, evaluate, groupMissing, describeGaps };
})();
