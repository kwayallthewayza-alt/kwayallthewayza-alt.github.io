import { test } from 'node:test';
import assert from 'node:assert/strict';

// data.js touches localStorage only inside functions, so it imports cleanly in Node.
import { demoState } from '../js/data.js';
import { classifyClaim, factLevels, runQualityChecks, usablePrice, usableSpecs, summarise } from '../js/truth.js';
import { buildStrategy, buildCopy, buildCaptions } from '../js/strategy.js';
import { formatMoney, priceLine, findMoney, parseMoney, findPhones, contrastRatio } from '../js/format.js';

const NOW = new Date();
const fresh = () => {
  const s = demoState();
  return { business: s.businesses[0], product: s.products[0] };
};

test('formats the barge boat price exactly', () => {
  assert.equal(formatMoney(385000, 'ZAR'), 'R385,000');
  assert.equal(priceLine({ amount: 385000, currency: 'ZAR', type: 'from' }), 'Starting from R385,000');
  assert.equal(priceLine({ type: 'poa' }), 'Price on application');
});

test('finds and parses money and phone numbers in free text', () => {
  assert.deepEqual(findMoney('Now only R350 000 or R 385,000!'), ['R350 000', 'R 385,000']);
  assert.equal(parseMoney('R385,000'), 385000);
  assert.equal(parseMoney('$1,299.99'), 1299.99);
  assert.deepEqual(findPhones('Call 082 555 0199 today'), ['082 555 0199']);
});

test('contrast ratio matches WCAG reference values', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);
});

test('classifies risky and prohibited claims', () => {
  const { business, product } = fresh();
  assert.equal(classifyClaim('Stable & safe', business, product).status, 'needs_review');
  assert.equal(classifyClaim('The best boat in SA', business, product).status, 'needs_review');
  assert.equal(classifyClaim('Practically unsinkable', business, product).status, 'prohibited');
  assert.equal(classifyClaim('Spacious deck for families', business, product).status, 'ok');
  // Labelled marketing puffery is allowed, but safety never is.
  assert.equal(classifyClaim('Built to last', business, product).status, 'marketing');
  product.claims.push({ text: 'Safe for kids', status: 'marketing', evidence: '' });
  assert.equal(classifyClaim('Safe for kids', business, product).status, 'needs_review');
});

test('unconfirmed facts are never usable; confirmed ones are', () => {
  const { business, product } = fresh();
  const specs = usableSpecs(product).map((s) => s.label);
  assert.deepEqual(specs, ['Engine', 'Hull material']);
  const levels = factLevels(product, business, NOW);
  assert.ok(levels.review.some((f) => f.label === 'Passenger capacity'));
  assert.ok(levels.review.some((f) => f.value === 'Stable & safe'));
  assert.ok(levels.missing.some((f) => f.key === 'image'));
});

test('price is omitted when unconfirmed, stale or expired', () => {
  const { product } = fresh();
  assert.equal(usablePrice(product, NOW), 'Starting from R385,000');
  product.price.confirmed = false;
  assert.equal(usablePrice(product, NOW), '');
  product.price.confirmed = true;
  product.price.validUntil = '2000-01-01';
  assert.equal(usablePrice(product, NOW), '');
});

test('generated copy uses only verified facts and passes with no failures', () => {
  const { business, product } = fresh();
  const campaign = { goal: 'enquiries', ctaId: 'whatsapp', format: 'square' };
  const strategy = buildStrategy({ business, product, campaign, now: NOW });
  const copy = buildCopy({ business, product, campaign, strategy, image: product.images[0] });
  const all = JSON.stringify(copy);
  assert.ok(!all.includes('Stable'), 'unverified safety claim must not be used');
  assert.ok(!all.includes('Fuel efficient'), 'unverified efficiency claim must not be used');
  assert.ok(!all.includes('10 people'), 'unconfirmed capacity must not be used');
  assert.ok(!all.includes('Canopy'), 'unconfirmed inclusion must not be used');
  assert.ok(copy.bullets.includes('Includes Suzuki 30HP outboard engine'));
  assert.equal(copy.priceText, 'Starting from R385,000');
  assert.match(copy.finePrint, /excludes delivery and licensing & registration/i);
  assert.match(copy.finePrint, /Image is illustrative/);

  const v = copy.variants[0];
  const texts = { ...v, bullets: copy.bullets, cta: copy.cta, contact: copy.contact, priceText: copy.priceText, offer: copy.offer, finePrint: copy.finePrint };
  texts.caption = buildCaptions({ business, product, texts }).facebook;
  const checks = runQualityChecks({
    draft: { texts, campaign: { ...campaign, ctaNeeds: 'whatsapp' }, format: 'square', image: product.images[0], renderReport: { minFontPx: 30, canvasWidth: 1080, overflow: [], contrastPairs: [] } },
    product,
    business,
    now: NOW,
  });
  assert.equal(summarise(checks).fail, 0, JSON.stringify(checks.filter((c) => c.level === 'fail')));
});

test('quality checks catch a wrong price, unknown phone number and unsupported claim', () => {
  const { business, product } = fresh();
  const texts = {
    headline: 'Best barge in SA — now R350,000!',
    subheadline: 'Call 083 111 2222',
    bullets: ['Stable & safe'],
    cta: 'WhatsApp us',
    priceText: 'Starting from R385,000',
    finePrint: '',
  };
  const checks = runQualityChecks({ draft: { texts, campaign: { goal: 'sales' }, image: null, renderReport: {} }, product, business, now: NOW });
  const fails = checks.filter((c) => c.level === 'fail').map((c) => c.message).join('\n');
  const warns = checks.filter((c) => c.level === 'warn').map((c) => c.message).join('\n');
  assert.match(fails, /R350,000/);
  assert.match(fails, /083 111 2222/);
  assert.match(warns, /Superlative/);
  assert.match(warns, /Safety claim/);
  assert.match(warns, /Exclusions not disclosed/);
});

test('expired offers are left out and sold-out products block sales campaigns', () => {
  const { business, product } = fresh();
  product.offer = { title: 'Winter special', start: '2000-01-01', end: '2000-02-01', conditions: '' };
  const strategy = buildStrategy({ business, product, campaign: { goal: 'sales' }, now: NOW });
  assert.equal(strategy.offerActive, false);
  product.availability = 'sold_out';
  const checks = runQualityChecks({ draft: { texts: { headline: 'x' }, campaign: { goal: 'sales' }, renderReport: {} }, product, business, now: NOW });
  assert.ok(checks.some((c) => c.level === 'fail' && /sold out/.test(c.message)));
});
