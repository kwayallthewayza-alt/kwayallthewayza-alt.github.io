// Truth & clarity engine.
//
// Decides which product facts may appear in a creative (verified),
// which must be flagged (needs review) and which are absent (missing),
// and runs the pre-approval quality checks on a finished draft.
// Pure functions only, so it can be unit tested in Node.

import {
  priceLine,
  findMoney,
  parseMoney,
  findPhones,
  normalisePhone,
  isPlausiblePhone,
  isPlausibleEmail,
  daysBetween,
  todayISO,
  contrastRatio,
} from './format.js';

export const STALE_PRICE_DAYS = 90;
export const MIN_MOBILE_FONT_PX = 11; // effective size on a 375px-wide phone screen
export const MOBILE_WIDTH_PX = 375;
export const MIN_FINE_PRINT_PX = 6; // fine print may be smaller, but not unreadable

/**
 * Phrases that read as factual claims and need evidence before publishing.
 * `suggest` is safer wording the employer can use instead.
 */
export const RISKY_CLAIMS = [
  { re: /\b(best|#\s?1|number one|no\.?\s?1|leading|top[- ]rated|world[- ]class)\b/i, type: 'Superlative', suggest: 'Describe the specific feature instead, or attach evidence (award, survey, ranking).' },
  { re: /\b(cheapest|lowest price|best price|best value|unbeatable)\b/i, type: 'Price comparison', highRisk: true, suggest: 'Price comparisons need current competitor evidence. State your own price instead.' },
  { re: /\b(guarantee[ds]?|guaranteed|100\s?%|risk[- ]free|no risk)\b/i, type: 'Guarantee', highRisk: true, suggest: 'Only promise what a written warranty or policy covers, and name it.' },
  { re: /\b(safe|safest|safety|stable)\b/i, type: 'Safety claim', highRisk: true, suggest: 'Avoid guaranteeing safety. Name certified equipment or ratings, e.g. "Supplied with life jackets".' },
  { re: /\b(fuel[- ]efficient|economical|low running costs?|saves? (you )?money)\b/i, type: 'Efficiency claim', suggest: 'Quote a measured figure with its source, or remove.' },
  { re: /\b(built to last|durable|lifetime|indestructible|unbreakable)\b/i, type: 'Durability claim', suggest: 'Treat as a marketing claim; prefer a warranty period or material spec.' },
  { re: /\b(excellent condition|like new|mint condition|as new|perfect condition)\b/i, type: 'Condition claim', highRisk: true, suggest: 'Use only if the condition of this specific item has been confirmed.' },
  { re: /\b(eco[- ]friendly|green|sustainable|carbon[- ]neutral|environmentally friendly)\b/i, type: 'Environmental claim', suggest: 'Environmental claims need specific, verifiable support.' },
  { re: /\b(clinically|proven|scientifically|certified|approved by)\b/i, type: 'Certification / proof', highRisk: true, suggest: 'Name the certificate or study and keep a copy on the product record.' },
  { re: /\b(only \d+ left|last (one|few)|selling fast|limited stock)\b/i, type: 'Scarcity claim', highRisk: true, suggest: 'Use only if the stock level is confirmed on the product record.' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Classify a single claim text.
 * Returns { status: 'verified'|'needs_review'|'prohibited'|'ok', type, suggest }.
 */
export function classifyClaim(text, business = {}, product = {}) {
  const t = norm(text);
  if (!t) return { status: 'ok' };

  for (const p of business.prohibitedClaims || []) {
    if (p && t.includes(norm(p))) {
      return { status: 'prohibited', type: 'Prohibited by brand rules', match: p, suggest: 'Remove — your brand rules prohibit this claim.' };
    }
  }

  const approved = [
    ...(business.approvedClaims || []),
    ...(product.claims || []).filter((c) => c.status === 'verified').map((c) => c.text),
  ].map(norm);

  const hits = RISKY_CLAIMS.filter((r) => r.re.test(t));
  if (!hits.length) return { status: 'ok' };

  // A risky phrase is fine when the whole phrase is an approved/verified claim.
  if (approved.some((a) => a && (t === a || t.includes(a)) && hits.every((h) => h.re.test(a)))) {
    return { status: 'verified', type: hits[0].type };
  }
  // Puffery the business has labelled as a marketing claim ("Built to last") may be used,
  // but never for high-risk types such as safety, guarantees or price comparisons.
  const marketing = (product.claims || []).filter((c) => c.status === 'marketing').map((c) => norm(c.text));
  if (hits.every((h) => !h.highRisk) && marketing.some((m) => m && t.includes(m) && hits.every((h) => h.re.test(m)))) {
    return { status: 'marketing', type: hits[0].type };
  }
  return { status: 'needs_review', type: hits.map((h) => h.type).join(', '), suggest: hits[0].suggest, match: (t.match(hits[0].re) || [])[0] };
}

/** Facts split into the three levels the creative pipeline uses. */
export function factLevels(product, business, now = new Date()) {
  const verified = [];
  const review = [];
  const missing = [];
  const today = todayISO(now);

  // Price
  const p = product.price || {};
  if (p.type === 'poa') {
    verified.push({ key: 'price', label: 'Price', value: 'Price on application' });
  } else if (p.amount === '' || p.amount === null || p.amount === undefined) {
    missing.push({ key: 'price', label: 'Price', why: 'No price recorded. Enter it or choose "Price on application".' });
  } else if (!p.confirmed) {
    review.push({ key: 'price', label: 'Price', value: priceLine(p), why: 'Price has not been confirmed by the business.' });
  } else if (p.validUntil && p.validUntil < today) {
    review.push({ key: 'price', label: 'Price', value: priceLine(p), why: `Price validity expired on ${p.validUntil}.` });
  } else if (p.confirmedAt && daysBetween(p.confirmedAt, now) > STALE_PRICE_DAYS) {
    review.push({ key: 'price', label: 'Price', value: priceLine(p), why: `Price last confirmed ${daysBetween(p.confirmedAt, now)} days ago — reconfirm before publishing.` });
  } else {
    verified.push({ key: 'price', label: 'Price', value: priceLine(p), source: p.source, confirmedAt: p.confirmedAt });
  }

  // Specs
  for (const s of product.specs || []) {
    if (!s.label) continue;
    if (!String(s.value || '').trim()) {
      missing.push({ key: `spec:${s.id}`, label: s.label, why: 'Not recorded — will be left out.' });
    } else if (!s.confirmed) {
      review.push({ key: `spec:${s.id}`, label: s.label, value: s.value, why: 'Not confirmed — left out of the creative until confirmed.' });
    } else {
      verified.push({ key: `spec:${s.id}`, label: s.label, value: s.value, source: s.source, confirmedAt: s.confirmedAt });
    }
  }

  // Inclusions
  for (const inc of product.included || []) {
    if (!inc.text) continue;
    (inc.confirmed ? verified : review).push({
      key: `inc:${inc.text}`,
      label: 'Included',
      value: inc.text,
      why: inc.confirmed ? undefined : 'Confirm this is included in the advertised price.',
    });
  }

  // Condition
  const c = product.condition || {};
  if (c.value) {
    (c.confirmed ? verified : review).push({
      key: 'condition',
      label: 'Condition',
      value: conditionLabel(c.value),
      why: c.confirmed ? undefined : 'Condition not confirmed for this specific item.',
    });
  } else {
    missing.push({ key: 'condition', label: 'Condition', why: 'Condition not recorded.' });
  }

  // Claims
  for (const cl of product.claims || []) {
    if (!cl.text) continue;
    const cls = classifyClaim(cl.text, business, product);
    if (cl.status === 'verified' && cl.evidence) {
      verified.push({ key: `claim:${cl.text}`, label: 'Claim', value: cl.text, source: cl.evidence });
    } else if (cls.status === 'prohibited') {
      review.push({ key: `claim:${cl.text}`, label: 'Claim', value: cl.text, why: 'Prohibited by brand rules.' });
    } else if (cl.status === 'marketing' && (cls.status === 'ok' || cls.status === 'marketing')) {
      verified.push({ key: `claim:${cl.text}`, label: 'Marketing claim', value: cl.text });
    } else {
      review.push({
        key: `claim:${cl.text}`,
        label: 'Claim',
        value: cl.text,
        why: cl.status === 'verified' ? 'Marked verified but no evidence recorded.' : cls.suggest || 'Needs evidence before use.',
      });
    }
  }

  // Images
  const real = (product.images || []).filter((i) => i.kind === 'real');
  if (!real.length) {
    missing.push({ key: 'image', label: 'Product photo', why: (product.images || []).length ? 'Only illustrative images — they will be labelled "Illustrative image".' : 'No product image uploaded.' });
  }

  // Business contact
  if (!business.phone && !business.whatsapp && !business.email) {
    missing.push({ key: 'contact', label: 'Contact details', why: 'Add a phone, WhatsApp or email to the business profile.' });
  }

  return { verified, review, missing };
}

export function conditionLabel(v) {
  return { new: 'New', used: 'Pre-owned', refurbished: 'Refurbished', demo: 'Demo model', custom: 'Custom-built' }[v] || v;
}

export function availabilityLabel(v) {
  return { in_stock: 'In stock', made_to_order: 'Made to order', limited: 'Limited quantity', sold_out: 'Sold out', pre_order: 'Pre-order' }[v] || v;
}

/** Specs and inclusions that may be printed: confirmed ones only. */
export function usableSpecs(product) {
  return (product.specs || []).filter((s) => s.label && String(s.value || '').trim() && s.confirmed);
}

export function usableInclusions(product) {
  return (product.included || []).filter((i) => i.text && i.confirmed).map((i) => i.text);
}

/** Can the price be printed? Returns the exact string, or '' when it must be omitted. */
export function usablePrice(product, now = new Date()) {
  const p = product.price || {};
  if (p.type === 'poa') return 'Price on application';
  if (!p.confirmed || p.amount === '' || p.amount === undefined || p.amount === null) return '';
  if (p.validUntil && p.validUntil < todayISO(now)) return '';
  return priceLine(p);
}

export function offerIsActive(offer, now = new Date()) {
  if (!offer || !offer.title) return false;
  const t = todayISO(now);
  if (offer.start && offer.start > t) return false;
  if (offer.end && offer.end < t) return false;
  return true;
}

/**
 * Full pre-approval check on a draft.
 *
 * draft: { texts: {headline, subheadline, bullets[], cta, priceText, finePrint, caption},
 *          format, campaign, renderReport: {minFontPx, canvasWidth, overflow[], imageScale, contrastPairs[]} }
 * Returns [{ level: 'pass'|'warn'|'fail', area, message }]
 */
export function runQualityChecks({ draft, product, business, now = new Date() }) {
  const out = [];
  const add = (level, area, message) => out.push({ level, area, message });
  const texts = draft.texts || {};
  const campaign = draft.campaign || {};
  const allCopy = [
    ['Headline', texts.headline],
    ['Sub-headline', texts.subheadline],
    ...(texts.bullets || []).map((b, i) => [`Bullet ${i + 1}`, b]),
    ['Call to action', texts.cta],
    ['Offer', texts.offer],
    ['Caption', texts.caption],
  ].filter(([, v]) => v);

  // 1. Price consistency
  const recordPrice = usablePrice(product, now);
  const p = product.price || {};
  if (!recordPrice && p.type !== 'poa') {
    if (p.amount === '' || p.amount === undefined) add('warn', 'Price', 'No price on record — price omitted from the creative.');
    else add('warn', 'Price', 'Price is unconfirmed or expired — omitted from the creative until confirmed.');
  } else {
    add('pass', 'Price', `Displayed price matches the product record: "${recordPrice}".`);
    if (p.confirmedAt && daysBetween(p.confirmedAt, now) > STALE_PRICE_DAYS) {
      add('warn', 'Price', `Price last confirmed ${daysBetween(p.confirmedAt, now)} days ago. Reconfirm before publishing.`);
    }
  }
  if (texts.priceText && texts.priceText !== recordPrice) {
    add('fail', 'Price', `Poster price "${texts.priceText}" does not match the record "${recordPrice || 'none'}".`);
  }
  const recordAmount = Number(p.amount);
  for (const [where, text] of allCopy) {
    for (const m of findMoney(text)) {
      const val = parseMoney(m);
      const allowed = [recordAmount, Number(p.deposit)].filter((x) => !Number.isNaN(x) && x > 0);
      if (!allowed.includes(val)) {
        add('fail', 'Price', `${where} mentions "${m}", which does not match any confirmed price on the product record.`);
      } else if (!recordPrice && val === recordAmount) {
        add('fail', 'Price', `${where} mentions "${m}" but the price is not confirmed.`);
      }
    }
  }
  if ((product.excluded || []).length && recordPrice && recordPrice !== 'Price on application') {
    const fine = String(texts.finePrint || '').toLowerCase();
    const missingExcl = product.excluded.filter((e) => !fine.includes(String(e).toLowerCase()));
    if (missingExcl.length) add('warn', 'Price', `Exclusions not disclosed in fine print: ${missingExcl.join(', ')}.`);
    else add('pass', 'Price', 'Price exclusions are disclosed in the fine print.');
  }

  // 2. Contact details
  const contacts = [business.phone, business.whatsapp].filter(Boolean);
  if (!contacts.length && !business.email) {
    add('fail', 'Contact', 'No contact details in the business profile.');
  }
  for (const c of contacts) {
    if (!isPlausiblePhone(c)) add('fail', 'Contact', `"${c}" does not look like a valid phone number.`);
  }
  if (business.email && !isPlausibleEmail(business.email)) add('fail', 'Contact', `"${business.email}" does not look like a valid email address.`);
  const knownPhones = contacts.map(normalisePhone);
  for (const [where, text] of allCopy) {
    for (const ph of findPhones(text)) {
      if (!knownPhones.includes(normalisePhone(ph))) {
        add('fail', 'Contact', `${where} contains phone number "${ph}", which is not in the business profile.`);
      }
    }
  }
  const needs = campaign.ctaNeeds;
  if (needs && needs !== 'any' && !business[needs]) {
    add('fail', 'Contact', `The call to action needs a ${needs} contact, but the business profile has none.`);
  } else if (contacts.length || business.email) {
    add('pass', 'Contact', 'Contact details are taken from the saved business profile.');
  }

  // 3. Claims in copy
  let claimIssues = 0;
  for (const [where, text] of allCopy) {
    const cls = classifyClaim(text, business, product);
    if (cls.status === 'prohibited') {
      claimIssues++;
      add('fail', 'Claims', `${where}: "${cls.match}" is prohibited by your brand rules.`);
    } else if (cls.status === 'needs_review') {
      claimIssues++;
      add('warn', 'Claims', `${where}: "${cls.match}" (${cls.type}) needs evidence. ${cls.suggest}`);
    }
  }
  if (!claimIssues) add('pass', 'Claims', 'No unsupported claims found in the copy.');

  // 4. Product facts / omissions
  const levels = factLevels(product, business, now);
  const omitted = levels.review.filter((f) => f.key.startsWith('spec:') || f.key.startsWith('inc:'));
  if (omitted.length) {
    add('warn', 'Facts', `Left out because unconfirmed: ${omitted.map((f) => `${f.label}${f.label === 'Included' ? ` (${f.value})` : ''}`).join(', ')}.`);
  }
  // Bullets that state a spec or inclusion must still match the current record
  // (an approved design can go stale when a product record changes).
  const confirmedSpecs = usableSpecs(product);
  const allSpecLabels = (product.specs || []).map((s) => norm(s.label)).filter(Boolean);
  const inclusions = usableInclusions(product).map(norm);
  for (const b of texts.bullets || []) {
    const inc = String(b).match(/^includes\s+(.+)$/i);
    if (inc && !inclusions.includes(norm(inc[1]))) {
      add('fail', 'Facts', `"${b}" is not a confirmed inclusion on the product record.`);
      continue;
    }
    const kv = String(b).match(/^([^:]{2,40}):\s*(.+)$/);
    if (kv && allSpecLabels.includes(norm(kv[1]))) {
      const spec = confirmedSpecs.find((s) => norm(s.label) === norm(kv[1]));
      if (!spec) add('fail', 'Facts', `"${kv[1]}" is not confirmed on the product record.`);
      else if (norm(spec.value) !== norm(kv[2])) add('fail', 'Facts', `"${b}" does not match the record ("${spec.label}: ${spec.value}").`);
    }
  }

  if (product.availability === 'sold_out' && ['sales', 'enquiries', 'bookings'].includes(campaign.goal)) {
    add('fail', 'Facts', 'Product is marked sold out — do not run a sales or enquiry campaign for it.');
  }
  if (product.condition?.value && !product.condition.confirmed && /condition|new|pre-owned|refurbished/i.test(allCopy.map((x) => x[1]).join(' '))) {
    add('warn', 'Facts', 'Copy refers to condition, but the condition is not confirmed.');
  }

  // 5. Offer
  const offer = product.offer || {};
  if (texts.offer) {
    if (!offerIsActive(offer, now)) add('fail', 'Offer', 'An offer is shown but it is not active on the product record (check dates).');
    else if (!offer.end) add('warn', 'Offer', 'Offer has no end date. Add one so it does not quietly run forever.');
    else add('pass', 'Offer', `Offer is valid until ${offer.end}.`);
    if (offer.conditions && !String(texts.finePrint || '').toLowerCase().includes(String(offer.conditions).toLowerCase().slice(0, 20))) {
      add('warn', 'Offer', 'Offer conditions are not included in the fine print.');
    }
  } else if (offer.title && offer.end && offer.end < todayISO(now)) {
    add('pass', 'Offer', `Expired offer "${offer.title}" was correctly left out.`);
  }

  // 6. Images
  const img = draft.image;
  if (!img) {
    add('warn', 'Image', 'No product image in the design.');
  } else if (img.kind !== 'real') {
    add('warn', 'Image', 'Illustrative image used — it is labelled "Illustrative image" on the design. Use a real photo where product accuracy matters.');
  } else {
    add('pass', 'Image', 'Real product photograph used.');
  }
  const rr = draft.renderReport || {};
  if (img && rr.imageScale && rr.imageScale > 1.5) {
    add('warn', 'Image', `Photo is being enlarged ${rr.imageScale.toFixed(1)}× — it may look blurry. Upload a higher-resolution photo.`);
  }

  // 7. Legibility
  if (rr.minFontPx && rr.canvasWidth) {
    const eff = (rr.minFontPx * MOBILE_WIDTH_PX) / rr.canvasWidth;
    const isPrint = draft.format === 'flyer';
    if (!isPrint && eff < MIN_MOBILE_FONT_PX) {
      add('warn', 'Legibility', `Smallest text renders at about ${eff.toFixed(1)}px on a phone (minimum ${MIN_MOBILE_FONT_PX}px). Shorten the text.`);
    } else {
      add('pass', 'Legibility', isPrint ? 'Text sizes suit print.' : `Smallest text is about ${eff.toFixed(1)}px on a phone screen.`);
    }
  }
  for (const o of rr.overflow || []) add('fail', 'Legibility', `${o} does not fit in its space even at the minimum size. Shorten it.`);
  if ((rr.dropped || []).length) {
    add('warn', 'Legibility', `No room for ${rr.dropped.length} key point(s), left off the design: ${rr.dropped.map((d) => `"${d}"`).join(', ')}. They still appear in the captions.`);
  }
  if (rr.minFinePrintPx && rr.canvasWidth && draft.format !== 'flyer') {
    const effFine = (rr.minFinePrintPx * MOBILE_WIDTH_PX) / rr.canvasWidth;
    if (effFine < MIN_FINE_PRINT_PX) add('warn', 'Legibility', `Fine print is about ${effFine.toFixed(1)}px on a phone — shorten it, and keep full terms in the caption.`);
  }
  for (const pair of rr.contrastPairs || []) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    if (ratio < (pair.large ? 3 : 4.5)) {
      add('warn', 'Legibility', `${pair.name} has low contrast (${ratio.toFixed(1)}:1). Choose a darker or lighter colour.`);
    }
  }

  // 8. Text hygiene (not a full spellcheck — the editor uses the browser spellchecker)
  for (const [where, text] of allCopy) {
    const dup = String(text).match(/\b(\w+)\s+\1\b/i);
    if (dup) add('warn', 'Spelling', `${where}: repeated word "${dup[1]}".`);
    if (/\s{2,}/.test(text.replace(/\n/g, ' '))) add('warn', 'Spelling', `${where}: double spaces.`);
    if (/[!?]{2,}/.test(text)) add('warn', 'Spelling', `${where}: repeated punctuation looks unprofessional.`);
  }
  if ((texts.headline || '').length > 60) add('warn', 'Clarity', 'Headline is long — aim for under 60 characters.');

  // 9. Brand
  if (!business.logo) add('warn', 'Brand', 'No logo in the business profile.');
  if (business.disclaimer && !String(texts.finePrint || '').includes(business.disclaimer)) {
    add('warn', 'Brand', 'Required business disclaimer is missing from the fine print.');
  }

  return out;
}

export function summarise(checks) {
  return {
    fail: checks.filter((c) => c.level === 'fail').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    pass: checks.filter((c) => c.level === 'pass').length,
  };
}
