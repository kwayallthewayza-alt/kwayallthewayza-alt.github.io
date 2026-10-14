// AI marketing strategist (rule-based Phase 1 engine).
//
// Chooses the selling angle and writes copy using ONLY the saved business
// and product records. Templates interpolate stored facts; nothing here may
// invent a price, spec, stock level or claim. When a real language model is
// connected (see docs/architecture.md) it slots in behind the same interface
// and its output still passes through truth.js before approval.

import { GOALS, CTA_OPTIONS, CATEGORY_TEMPLATES, PLATFORMS } from './data.js';
import { usablePrice, usableSpecs, usableInclusions, offerIsActive, classifyClaim, availabilityLabel, conditionLabel, factLevels } from './truth.js';
import { formatDate } from './format.js';

const OPENERS = {
  professional: ['Introducing the', 'The', 'Discover the'],
  friendly: ['Say hello to the', 'Meet the', 'Get to know the'],
  bold: ['Meet the', 'Make it yours: the', 'Ready for the'],
  premium: ['Discover the', 'Presenting the', 'The'],
};

const AUDIENCE_HINTS = [
  { words: ['family', 'families', 'kids', 'children'], match: ['family', 'spacious', 'room', 'space', 'deck', 'seating', 'comfort'] },
  { words: ['business', 'lodge', 'resort', 'commercial', 'company', 'operator'], match: ['low-maintenance', 'maintenance', 'reliable', 'capacity', 'commercial', 'guests'] },
  { words: ['fishing', 'angler', 'fisher'], match: ['fishing', 'deck', 'stable', 'space', 'dams', 'rivers'] },
  { words: ['student', 'budget', 'first'], match: ['value', 'affordable', 'price', 'starter'] },
  { words: ['luxury', 'premium', 'executive'], match: ['premium', 'finish', 'design', 'comfort'] },
];

/** Contact line for a CTA, using only saved business contact details. */
export function contactFor(ctaId, business) {
  const opt = CTA_OPTIONS.find((o) => o.id === ctaId) || CTA_OPTIONS[0];
  const wa = business.whatsapp;
  const ph = business.phone;
  const em = business.email;
  const web = business.website;
  switch (opt.id) {
    // The CTA label already names the channel ("WhatsApp us"), so give just the number.
    case 'whatsapp':
      return wa || (ph ? `Call ${ph}` : em || '');
    case 'call':
      return ph || (wa ? `WhatsApp ${wa}` : em || '');
    case 'email':
      return em ? em : ph ? `Call ${ph}` : '';
    case 'online':
      return web || (ph ? `Call ${ph}` : '');
    default:
      return [wa && `WhatsApp ${wa}`, !wa && ph && `Call ${ph}`, em].filter(Boolean).slice(0, 2).join('  ·  ');
  }
}

function scoreBenefit(benefit, audience) {
  const b = benefit.toLowerCase();
  const a = String(audience || '').toLowerCase();
  let score = 0;
  for (const h of AUDIENCE_HINTS) {
    if (h.words.some((w) => a.includes(w))) score += h.match.filter((m) => b.includes(m)).length * 2;
  }
  // Direct word overlap with the audience description.
  for (const w of a.split(/[^a-z]+/).filter((x) => x.length > 3)) if (b.includes(w)) score += 1;
  return score;
}

/** Pick benefits that are safe to print (no unsupported claims), best match first. */
export function rankedBenefits(product, business, audience) {
  return (product.benefits || [])
    .filter(Boolean)
    .map((text, i) => ({ text, score: scoreBenefit(text, audience) - i * 0.01, cls: classifyClaim(text, business, product) }))
    .sort((x, y) => y.score - x.score);
}

/** Step 1–3 of the pipeline: understand, choose the angle, write the brief. */
export function buildStrategy({ business, product, campaign, now = new Date() }) {
  const goal = campaign.goal || business.goal || 'enquiries';
  const audience = campaign.audience || business.audience || '';
  const price = usablePrice(product, now);
  const offerActive = campaign.useOffer !== false && offerIsActive(product.offer, now);
  const benefits = rankedBenefits(product, business, audience);
  const safeBenefits = benefits.filter((b) => b.cls.status === 'ok' || b.cls.status === 'verified' || b.cls.status === 'marketing');
  const specs = usableSpecs(product);
  const reasoning = [];
  const omitted = [];

  let angle;
  if (campaign.message) {
    angle = { kind: 'custom', text: campaign.message };
    reasoning.push('Using the main message you supplied.');
  } else if (offerActive && ['sales', 'enquiries', 'launch'].includes(goal)) {
    angle = { kind: 'offer', text: product.offer.title };
    reasoning.push(`An active offer ("${product.offer.title}") is the strongest reason to act now for a ${GOALS[goal].label.toLowerCase()} campaign.`);
  } else if (goal === 'sales' && price) {
    angle = { kind: 'price', text: price };
    reasoning.push('Sales goal with a confirmed price: lead with the product and price so buyers can decide quickly.');
  } else if (safeBenefits.length) {
    angle = { kind: 'benefit', text: safeBenefits[0].text };
    reasoning.push(
      safeBenefits[0].score > 0
        ? `"${safeBenefits[0].text}" best matches the audience (${audience}).`
        : `Leading with the first recorded benefit; add audience details for a sharper choice.`,
    );
  } else if (specs.length) {
    angle = { kind: 'spec', text: `${specs[0].label}: ${specs[0].value}` };
    reasoning.push('No safe benefit recorded, so leading with a confirmed specification.');
  } else {
    angle = { kind: 'name', text: product.name };
    reasoning.push('Few confirmed facts available — keeping the message to the product name. Add benefits and confirm specs for stronger content.');
  }

  for (const b of benefits.filter((x) => !safeBenefits.includes(x))) {
    omitted.push(`Benefit "${b.text}" — ${b.cls.type || 'needs review'}`);
  }
  const levels = factLevels(product, business, now);
  for (const f of levels.review) omitted.push(`${f.label}${f.value ? ` "${f.value}"` : ''} — ${f.why}`);
  for (const f of levels.missing) omitted.push(`${f.label} — ${f.why}`);

  if (goal === 'awareness') reasoning.push('Awareness goal: benefit-led, light on specifications.');
  if (goal === 'bookings') reasoning.push('Bookings goal: call to action invites a viewing or appointment.');
  if (price) reasoning.push(`Price shown exactly as recorded: "${price}".`);
  else reasoning.push('Price omitted — not confirmed on the product record.');

  return {
    goal,
    goalLabel: GOALS[goal]?.label || goal,
    audience,
    angle,
    reasoning,
    omitted,
    price,
    offerActive,
    safeBenefits: safeBenefits.map((b) => b.text),
    specs,
  };
}

/** Step 3–4: headline variants, bullets, CTA and fine print for the design. */
export function buildCopy({ business, product, campaign, strategy, image }) {
  const tone = business.tone || 'professional';
  const openers = OPENERS[tone] || OPENERS.professional;
  const name = product.name || 'our product';
  const s = strategy;
  const variants = [];

  const firstSpec = s.specs[0];
  const benefit = s.safeBenefits[0];
  const secondBenefit = s.safeBenefits[1];

  switch (s.angle.kind) {
    case 'offer':
      variants.push({ headline: s.angle.text, subheadline: `${openers[0]} ${name}` });
      break;
    case 'price':
      variants.push({ headline: `${openers[0]} ${name}`, subheadline: benefit || (firstSpec ? `${firstSpec.label}: ${firstSpec.value}` : '') });
      break;
    case 'custom':
      variants.push({ headline: s.angle.text, subheadline: name });
      break;
    default:
      variants.push({ headline: name, subheadline: benefit || (firstSpec ? `${firstSpec.label}: ${firstSpec.value}` : '') });
  }
  variants.push({ headline: `${openers[1]} ${name}`, subheadline: secondBenefit || benefit || '' });
  if (firstSpec) variants.push({ headline: `${openers[2]} ${name}`, subheadline: `With ${firstSpec.value}` });
  else if (benefit) variants.push({ headline: benefit, subheadline: name });

  // Bullets: confirmed inclusions and specs for sales; benefits first for awareness.
  const inclusions = usableInclusions(product).map((t) => `Includes ${t}`);
  const specBullets = s.specs
    .filter((sp) => !inclusions.some((i) => i.toLowerCase().includes(String(sp.value).toLowerCase())))
    .map((sp) => `${sp.label}: ${sp.value}`);
  const benefitBullets = s.safeBenefits.filter((b) => b !== variants[0].subheadline);
  const marketingClaims = (product.claims || [])
    .filter((c) => {
      const cls = classifyClaim(c.text, business, product);
      return (c.status === 'verified' && c.evidence) || (c.status === 'marketing' && (cls.status === 'ok' || cls.status === 'marketing'));
    })
    .map((c) => c.text);
  const pool = s.goal === 'awareness'
    ? [...benefitBullets, ...marketingClaims, ...inclusions, ...specBullets]
    : campaign.format === 'flyer'
      ? [...inclusions, ...benefitBullets, ...marketingClaims] // specs already appear in the flyer's table
      : [...inclusions, ...specBullets, ...benefitBullets, ...marketingClaims];
  const maxBullets = { flyer: 6, story: 4, portrait: 4 }[campaign.format] || 3;
  const bullets = [...new Set(pool)].slice(0, maxBullets);

  const ctaOpt = CTA_OPTIONS.find((o) => o.id === campaign.ctaId) || CTA_OPTIONS[0];
  const cta = ctaOpt.label;
  const contact = contactFor(ctaOpt.id, business);

  const fine = [];
  if (product.excluded?.length && s.price && s.price !== 'Price on application') {
    fine.push(`Price excludes ${joinList(product.excluded.map((e) => e.toLowerCase()))}.`);
  }
  if (s.offerActive) {
    if (product.offer.conditions) fine.push(product.offer.conditions.trim().replace(/\.?$/, '.'));
    if (product.offer.end) fine.push(`Offer valid until ${formatDate(product.offer.end)}.`);
  }
  if (product.availability && product.availability !== 'in_stock') fine.push(`${availabilityLabel(product.availability)}.`);
  if (image && image.kind !== 'real') fine.push('Image is illustrative.');
  if (business.disclaimer) fine.push(business.disclaimer.trim());

  return {
    variants,
    bullets,
    cta,
    contact,
    priceText: s.price,
    offer: s.offerActive ? product.offer.title : '',
    finePrint: fine.join(' '),
  };
}

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function hashtagify(s) {
  return '#' + String(s).replace(/&/g, 'and').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('');
}

/** Platform-specific ready-to-publish copy from the same approved texts. */
export function buildCaptions({ business, product, texts }) {
  const lines = (arr) => arr.filter(Boolean).join('\n');
  const bullets = (texts.bullets || []).map((b) => `✔ ${b}`);
  const price = texts.priceText ? `💰 ${texts.priceText}` : '';
  const cta = [texts.cta, texts.contact].filter(Boolean).join(': ');
  const tags = [
    product.name && hashtagify(product.name),
    business.location && hashtagify(business.location),
    product.category && CATEGORY_TEMPLATES[product.category] && product.category !== 'general' && hashtagify(CATEGORY_TEMPLATES[product.category].label.split('/')[0]),
    business.name && hashtagify(business.name),
  ].filter(Boolean);

  const facebook = lines([
    texts.offer ? `🔔 ${texts.offer}` : '',
    texts.headline,
    texts.subheadline,
    '',
    ...bullets,
    '',
    price,
    `👉 ${cta}`,
    business.website ? `🌐 ${business.website}` : '',
    '',
    texts.finePrint,
  ]);

  const instagram = lines([
    texts.headline,
    texts.subheadline,
    '',
    ...bullets.slice(0, 3),
    price,
    '',
    `👉 ${cta}`,
    '',
    texts.finePrint,
    '',
    tags.join(' '),
  ]);

  const whatsapp = lines([
    `*${texts.headline}*`,
    texts.subheadline,
    ...bullets.slice(0, 3),
    texts.priceText ? `*${texts.priceText}*` : '',
    cta,
    texts.finePrint ? `_${texts.finePrint}_` : '',
  ]);

  const linkedin = lines([
    `${texts.headline}${texts.subheadline ? ` — ${texts.subheadline}` : ''}`,
    '',
    texts.bullets?.length ? `Key details:\n${(texts.bullets || []).map((b) => `• ${b}`).join('\n')}` : '',
    texts.priceText ? `\n${texts.priceText}.` : '',
    '',
    `${texts.cta}: ${texts.contact}`,
    '',
    texts.finePrint,
  ]);

  const tiktok = lines([
    texts.offer || texts.headline,
    ...(texts.bullets || []).slice(0, 2).map((b) => `• ${b}`),
    texts.priceText,
    cta,
    tags.slice(0, 3).join(' '),
  ]);

  // Answers to the most common enquiries, using only recorded facts.
  const inc = usableInclusions(product);
  const faq = [
    {
      q: 'Is it still available?',
      a: product.availability === 'sold_out'
        ? `Thanks for asking! The ${product.name} is currently sold out. Can we let you know when it's available again?`
        : `Thanks for your interest! The ${product.name} is ${availabilityLabel(product.availability).toLowerCase()}. ${product.purchaseProcess || ''}`.trim(),
    },
    {
      q: 'What is the price?',
      a: texts.priceText
        ? `The ${product.name} is ${texts.priceText.replace(/^Starting from/, 'priced from')}${inc.length ? `, including ${joinList(inc)}` : ''}.${product.excluded?.length ? ` This excludes ${joinList(product.excluded.map((e) => e.toLowerCase()))}.` : ''}`
        : `Please contact us for current pricing on the ${product.name}. ${texts.contact || ''}`.trim(),
    },
    {
      q: 'What condition is it in?',
      a: product.condition?.confirmed
        ? `It's ${conditionLabel(product.condition.value).toLowerCase()}.${product.condition.notes ? ' ' + product.condition.notes : ''}`
        : 'Let us confirm the condition for you — we will get back to you shortly.',
    },
  ];

  return { facebook, instagram, whatsapp, linkedin, tiktok, faq, hashtags: tags };
}

export const CAPTION_PLATFORMS = ['facebook', 'instagram', 'whatsapp', 'linkedin', 'tiktok'].map((id) => ({ id, label: PLATFORMS[id] }));
