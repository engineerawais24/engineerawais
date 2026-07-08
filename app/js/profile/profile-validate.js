/* ============================================================
   ProfileValidate — validation rules for the Career Profile.
   Pure functions: state in, errors object out (keyed by field
   path, e.g. errors['contact.email']). No DOM access here.
   ============================================================ */

const ProfileValidate = (() => {

  const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const URL_RE      = /^https?:\/\/[^\s]+\.[^\s]{2,}$/i;
  const LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com\/(in|pub)\/[A-Za-z0-9\-_%]+\/?([?#].*)?$/i;

  function isEmail(v)    { return EMAIL_RE.test(v); }
  function isUrl(v)      { return URL_RE.test(v); }
  function isLinkedIn(v) { return LINKEDIN_RE.test(v); }

  function validate(p) {
    const errors = {};

    /* required fields */
    if (!p.personal.firstName.trim()) errors['personal.firstName'] = 'First name is required';
    if (!p.personal.lastName.trim())  errors['personal.lastName']  = 'Last name is required';
    if (!p.personal.headline.trim())  errors['personal.headline']  = 'Headline is required — the matcher scores against it';

    /* email: required + format */
    const email = p.contact.email.trim();
    if (!email) {
      errors['contact.email'] = 'Email is required';
    } else if (!isEmail(email)) {
      errors['contact.email'] = 'Enter a valid email address';
    }

    /* linkedin: optional, but must be a real linkedin.com/in/... URL */
    const li = p.links.linkedin.trim();
    if (li && !isLinkedIn(li)) {
      errors['links.linkedin'] = 'Use a full LinkedIn profile URL, e.g. https://linkedin.com/in/your-name';
    }

    /* other links: optional, generic URL check */
    for (const key of ['github', 'portfolio', 'other']) {
      const v = p.links[key].trim();
      if (v && !isUrl(v)) {
        errors['links.' + key] = 'Enter a full URL starting with https://';
      }
    }

    return errors;
  }

  return { validate, isEmail, isUrl, isLinkedIn };
})();
