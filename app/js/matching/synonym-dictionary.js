/* ============================================================
   SynonymDictionary — configurable vocabulary for job matching
   (Sprint 29).

   TWO different relationships, deliberately kept apart:

   • GROUPS — terms that mean the SAME thing.
       "Network Security" ≡ "Cybersecurity" ≡ "SOC" ≡ "Blue Team"
     A job asking for one is satisfied by a candidate holding another.

   • THEMES — terms that live in the same FIELD without being the same.
       Python, PowerShell and Bash are all "Automation", but knowing
     Python does not mean you know PowerShell. A theme match is worth
     partial credit (transferable), and themes are what group the
     "missing skills" list into something a human can read.

   Nothing here is hardcoded into the engine: groups and themes are data,
   and addGroup / addTheme / configure extend them at runtime. No storage,
   no DOM, no network — a pure lookup table.
   ============================================================ */

const SynonymDictionary = (() => {

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();
  const norm = s => lc(s).replace(/[^a-z0-9+#./ ]+/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------- groups: the same thing, said differently ---------- */
  const DEFAULT_GROUPS = [
    { id: 'network-security', canonical: 'Network Security',
      terms: ['network security', 'cybersecurity', 'cyber security', 'information security', 'infosec',
        'soc', 'security operations', 'security operations center', 'blue team', 'defensive security'] },

    { id: 'psim', canonical: 'PSIM',
      terms: ['psim', 'physical security', 'security management platform',
        'physical security information management', 'physical security systems'] },

    { id: 'infrastructure', canonical: 'Infrastructure',
      terms: ['infrastructure', 'systems', 'datacenter', 'data center', 'data centre',
        'systems engineering', 'on-premise infrastructure'] },

    { id: 'presales', canonical: 'Presales',
      terms: ['presales', 'pre-sales', 'pre sales', 'solutions engineer', 'solution engineer',
        'solutions engineering', 'solutions architect', 'solution architect', 'sales engineer',
        'technical presales'] },

    { id: 'consulting', canonical: 'Technical Consultant',
      terms: ['technical consultant', 'implementation consultant', 'professional services',
        'delivery consultant', 'implementation engineer', 'solutions consultant',
        'professional services engineer'] },

    /* technology equivalences */
    { id: 'containers', canonical: 'Kubernetes',
      terms: ['kubernetes', 'k8s', 'container orchestration', 'openshift', 'eks', 'aks', 'gke'] },
    { id: 'iac', canonical: 'Terraform',
      terms: ['terraform', 'infrastructure as code', 'iac', 'cloudformation', 'pulumi'] },
    { id: 'cloud', canonical: 'Cloud',
      terms: ['cloud', 'cloud computing', 'public cloud', 'cloud migration', 'cloud transformation'] },
    { id: 'observability', canonical: 'Observability',
      terms: ['observability', 'monitoring', 'apm', 'telemetry', 'logging'] },
    { id: 'client-delivery', canonical: 'Client delivery',
      terms: ['client delivery', 'customer delivery', 'client engagement', 'customer success',
        'stakeholder management', 'client facing'] },
  ];

  /* ---------- themes: the same field, not the same skill ---------- */
  const DEFAULT_THEMES = [
    { id: 'automation', label: 'Automation',
      terms: ['python', 'powershell', 'bash', 'shell scripting', 'scripting', 'ansible',
        'automation', 'ci/cd', 'jenkins', 'github actions', 'perl', 'ruby'] },

    { id: 'cloud-infra', label: 'Cloud & infrastructure',
      terms: ['azure', 'aws', 'gcp', 'terraform', 'kubernetes', 'docker', 'cloud migration',
        'infrastructure', 'systems', 'datacenter', 'linux', 'windows server', 'vmware', 'iac'] },

    { id: 'networking', label: 'Networking',
      terms: ['routing', 'switching', 'bgp', 'ospf', 'sd-wan', 'tcp/ip', 'firewall',
        'juniper', 'cisco', 'network security', 'load balancing', 'vpn'] },

    { id: 'security', label: 'Security',
      terms: ['network security', 'cybersecurity', 'information security', 'soc', 'siem',
        'psim', 'physical security', 'firewall', 'blue team', 'iam', 'zero trust', 'ids', 'ips'] },

    { id: 'data', label: 'Data',
      terms: ['sql', 'postgresql', 'mysql', 'data pipelines', 'reporting', 'etl',
        'observability', 'analytics', 'bi'] },

    { id: 'delivery', label: 'Client delivery',
      terms: ['client delivery', 'stakeholder management', 'workshops', 'requirements discovery',
        'professional services', 'technical demos', 'poc delivery', 'presales', 'api integration'] },
  ];

  let GROUPS = DEFAULT_GROUPS.map(g => Object.assign({}, g, { terms: g.terms.slice() }));
  let THEMES = DEFAULT_THEMES.map(t => Object.assign({}, t, { terms: t.terms.slice() }));

  /* ---------- configuration ---------- */

  function addGroup(group) {
    if (!group || !group.id || !Array.isArray(group.terms)) return null;
    const existing = GROUPS.find(g => g.id === group.id);
    if (existing) {
      group.terms.forEach(t => { if (!existing.terms.some(x => norm(x) === norm(t))) existing.terms.push(t); });
      if (group.canonical) existing.canonical = group.canonical;
      return existing;
    }
    const g = { id: group.id, canonical: group.canonical || group.terms[0], terms: group.terms.slice() };
    GROUPS.push(g);
    return g;
  }

  function addTheme(theme) {
    if (!theme || !theme.id || !Array.isArray(theme.terms)) return null;
    const existing = THEMES.find(t => t.id === theme.id);
    if (existing) {
      theme.terms.forEach(t => { if (!existing.terms.some(x => norm(x) === norm(t))) existing.terms.push(t); });
      if (theme.label) existing.label = theme.label;
      return existing;
    }
    const t = { id: theme.id, label: theme.label || theme.id, terms: theme.terms.slice() };
    THEMES.push(t);
    return t;
  }

  function configure(cfg) {
    (cfg && cfg.groups || []).forEach(addGroup);
    (cfg && cfg.themes || []).forEach(addTheme);
    return { groups: GROUPS.length, themes: THEMES.length };
  }

  function reset() {
    GROUPS = DEFAULT_GROUPS.map(g => Object.assign({}, g, { terms: g.terms.slice() }));
    THEMES = DEFAULT_THEMES.map(t => Object.assign({}, t, { terms: t.terms.slice() }));
  }

  function groups() { return GROUPS; }
  function themes() { return THEMES; }

  /* ---------- lookup ---------- */

  /* A dictionary entry matches a term when the ENTRY appears inside the TERM
     as whole words — "azure" matches "azure cloud". The reverse is NOT true:
     the term "Systems" must not match the PSIM entry "physical security
     systems" just because the word appears in it. That direction is what
     makes a short, generic word collide with every long phrase containing it. */
  function phraseIn(term, entry) {
    const t = norm(term), e = norm(entry);
    if (!t || !e) return false;
    if (t === e) return true;
    const esc = e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^| )' + esc + '( |$)').test(t);
  }

  /* how specifically does this entry match? (0 = not at all) */
  function matchLength(term, entryTerms) {
    let best = 0;
    entryTerms.forEach(x => { if (phraseIn(term, x)) best = Math.max(best, norm(x).length); });
    return best;
  }

  function hit(term, entryTerms) { return matchLength(term, entryTerms) > 0; }

  /* the MOST SPECIFIC group wins: "infrastructure as code" is IaC, not the
     generic "infrastructure" group that also matches it */
  function groupOf(term) {
    let best = null, bestLen = 0;
    GROUPS.forEach(g => {
      const len = matchLength(term, g.terms);
      if (len > bestLen) { bestLen = len; best = g; }
    });
    return best;
  }
  function canonical(term) {
    const g = groupOf(term);
    return g ? g.canonical : String(term || '').trim();
  }
  function synonymsOf(term) {
    const g = groupOf(term);
    return g ? g.terms.slice() : [];
  }
  /* the same thing, written differently */
  function sameGroup(a, b) {
    const ga = groupOf(a);
    if (!ga) return false;
    return ga === groupOf(b);
  }

  function themesOf(term) { return THEMES.filter(t => hit(term, t.terms)); }
  function themeLabel(term) {
    const t = themesOf(term)[0];
    return t ? t.label : null;
  }
  /* the same field, without being the same skill */
  function sameTheme(a, b) {
    const ta = themesOf(a);
    if (!ta.length) return false;
    const tb = themesOf(b);
    return ta.some(x => tb.some(y => y.id === x.id));
  }

  return {
    DEFAULT_GROUPS, DEFAULT_THEMES,
    addGroup, addTheme, configure, reset, groups, themes,
    groupOf, canonical, synonymsOf, sameGroup,
    themesOf, themeLabel, sameTheme, norm, phraseIn, matchLength,
  };
})();
