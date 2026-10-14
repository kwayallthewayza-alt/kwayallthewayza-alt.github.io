// Data model, industry templates, demo data and local persistence.
//
// Every product fact carries `confirmed`, `source` and `confirmedAt` so the
// truth engine can tell verified facts from unconfirmed ones.

import { uid, todayISO } from './format.js';

export const STORAGE_KEY = 'business-content-studio.v1';

/** Industry-specific specification fields. Employers can add custom rows too. */
export const CATEGORY_TEMPLATES = {
  boat: {
    label: 'Boat / marine',
    specs: ['Length', 'Beam', 'Passenger capacity', 'Engine', 'Engine power', 'Hull material', 'Fuel capacity', 'Safety equipment', 'Trailer'],
  },
  vehicle: {
    label: 'Vehicle',
    specs: ['Make & model', 'Year', 'Mileage', 'Engine', 'Transmission', 'Fuel type', 'Service history'],
  },
  laptop: {
    label: 'Laptop / electronics',
    specs: ['Processor', 'Memory', 'Storage', 'Display', 'Battery life', 'Operating system', 'Warranty'],
  },
  property: {
    label: 'Property',
    specs: ['Location', 'Floor area', 'Erf size', 'Bedrooms', 'Bathrooms', 'Parking', 'Rates & levies'],
  },
  food: {
    label: 'Food & restaurant',
    specs: ['Serving size', 'Ingredients', 'Allergens', 'Dietary', 'Available hours'],
  },
  service: {
    label: 'Service',
    specs: ['Duration', 'Service area', "What's covered", 'Turnaround time'],
  },
  general: {
    label: 'General product',
    specs: ['Dimensions', 'Weight', 'Material', 'Colour'],
  },
};

export const GOALS = {
  enquiries: { label: 'Get enquiries', cta: 'WhatsApp us to enquire' },
  sales: { label: 'Make sales', cta: 'Order now' },
  bookings: { label: 'Bookings & viewings', cta: 'Book a viewing' },
  awareness: { label: 'Build awareness', cta: 'Find out more' },
  launch: { label: 'Product launch', cta: 'Be the first to enquire' },
};

export const CTA_OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp us', needs: 'whatsapp' },
  { id: 'call', label: 'Call now', needs: 'phone' },
  { id: 'quote', label: 'Request a quote', needs: 'any' },
  { id: 'viewing', label: 'Book a viewing', needs: 'any' },
  { id: 'email', label: 'Email us', needs: 'email' },
  { id: 'online', label: 'Buy online', needs: 'website' },
];

export const FORMATS = {
  square: { label: 'Square post — Instagram / Facebook feed', w: 1080, h: 1080, platforms: ['instagram', 'facebook'] },
  portrait: { label: 'Portrait post — Instagram / Facebook 4:5', w: 1080, h: 1350, platforms: ['instagram', 'facebook'] },
  story: { label: 'Story / Reel / TikTok / WhatsApp status 9:16', w: 1080, h: 1920, platforms: ['instagram', 'facebook', 'tiktok', 'whatsapp'] },
  landscape: { label: 'Landscape — LinkedIn / Facebook link / website', w: 1200, h: 628, platforms: ['linkedin', 'facebook', 'website'] },
  flyer: { label: 'A4 sales flyer / product sheet (print)', w: 1240, h: 1754, platforms: ['print', 'website'] },
};

export const PLATFORMS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  website: 'Website',
  print: 'Print',
};

export const TONES = {
  professional: 'Professional',
  friendly: 'Friendly',
  bold: 'Bold & energetic',
  premium: 'Premium',
};

export const FONTS = ['Montserrat', 'Inter', 'Poppins', 'Merriweather', 'Oswald'];

export function emptyBusiness() {
  return {
    id: uid('biz'),
    name: '',
    industry: '',
    website: '',
    address: '',
    logo: '',
    phone: '',
    whatsapp: '',
    email: '',
    enquiryLink: '',
    colors: { primary: '#0b3d5c', secondary: '#f2f6f9', accent: '#f5a524' },
    font: 'Montserrat',
    tone: 'professional',
    audience: '',
    location: '',
    approvedClaims: [],
    prohibitedClaims: [],
    disclaimer: '',
    goal: 'enquiries',
    contactConfirmedAt: '',
  };
}

export function emptyProduct(businessId, category = 'general') {
  return {
    id: uid('prd'),
    businessId,
    name: '',
    category,
    model: '',
    sku: '',
    price: {
      amount: '',
      currency: 'ZAR',
      type: 'fixed',
      deposit: '',
      financing: '',
      fees: '',
      confirmed: false,
      source: '',
      confirmedAt: '',
      validUntil: '',
    },
    specs: (CATEGORY_TEMPLATES[category]?.specs || []).map((label) => emptySpec(label)),
    included: [],
    excluded: [],
    condition: { value: 'new', confirmed: false, notes: '' },
    availability: 'in_stock',
    benefits: [],
    claims: [],
    images: [],
    purchaseProcess: '',
    offer: { title: '', start: '', end: '', conditions: '' },
    updatedAt: todayISO(),
  };
}

export function emptySpec(label = '') {
  return { id: uid('spec'), label, value: '', confirmed: false, source: '', confirmedAt: '' };
}

/** A simple illustrative boat drawing used by the demo. It is not a product photo. */
function demoBoatIllustration() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3f4"/><stop offset="1" stop-color="#e0f4ff"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a7fa8"/><stop offset="1" stop-color="#0e4a6b"/></linearGradient></defs>
<rect width="1600" height="620" fill="url(#sky)"/><circle cx="1320" cy="170" r="80" fill="#fff6c9"/>
<path d="M0 560 Q 200 470 420 540 T 820 520 T 1250 530 T 1600 510 V 640 H0Z" fill="#6aa86b"/>
<rect y="600" width="1600" height="400" fill="url(#sea)"/>
<g transform="translate(330 470)">
<rect x="120" y="40" width="700" height="18" fill="#d9dee2"/>
<rect x="140" y="58" width="16" height="120" fill="#c3cad0"/><rect x="784" y="58" width="16" height="120" fill="#c3cad0"/>
<rect x="430" y="58" width="16" height="120" fill="#c3cad0"/>
<rect x="160" y="130" width="620" height="44" rx="6" fill="#2f5d7c"/>
<rect x="250" y="100" width="120" height="34" rx="6" fill="#e9eef2"/><rect x="520" y="100" width="160" height="34" rx="6" fill="#e9eef2"/>
<path d="M40 180 H900 L860 250 H80 Z" fill="#b8c4cc"/><path d="M40 180 H900 V205 H40Z" fill="#e3e8ec"/>
<rect x="900" y="150" width="40" height="70" rx="6" fill="#222"/><rect x="912" y="220" width="16" height="70" fill="#333"/>
</g>
<path d="M0 800 Q 200 780 400 800 T 800 800 T 1200 800 T 1600 800" stroke="#5fb0d6" stroke-width="6" fill="none" opacity=".6"/>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function demoState() {
  const today = todayISO();
  const biz = {
    ...emptyBusiness(),
    name: 'Demo Marine Sales',
    industry: 'Boat sales',
    website: 'www.example.com',
    address: 'Demo address, Western Cape, South Africa',
    phone: '+27 21 555 0100',
    whatsapp: '+27 82 555 0100',
    email: 'sales@example.com',
    colors: { primary: '#0b3d5c', secondary: '#f2f6f9', accent: '#f5a524' },
    font: 'Montserrat',
    tone: 'professional',
    audience: 'Leisure boaters, lodge and resort owners, fishing families',
    location: 'Western Cape',
    approvedClaims: ['Aluminium hull'],
    prohibitedClaims: ['unsinkable', 'cheapest in South Africa'],
    disclaimer: 'Prices include VAT. Delivery and licensing quoted separately. E&OE.',
    goal: 'enquiries',
    contactConfirmedAt: today,
  };

  const spec = (label, value, confirmed, source = '') => ({
    ...emptySpec(label),
    value,
    confirmed,
    source,
    confirmedAt: confirmed ? today : '',
  });

  const boat = {
    ...emptyProduct(biz.id, 'boat'),
    name: 'Barge Boat',
    model: 'Leisure barge',
    sku: 'DEMO-BARGE-01',
    price: {
      amount: 385000,
      currency: 'ZAR',
      type: 'from',
      deposit: '',
      financing: '',
      fees: '',
      confirmed: true,
      source: 'Owner price list (demo)',
      confirmedAt: today,
      validUntil: '',
    },
    specs: [
      spec('Engine', 'Suzuki 30HP outboard', true, 'Supplier invoice (demo)'),
      spec('Hull material', 'Aluminium', true, 'Builder spec sheet (demo)'),
      spec('Passenger capacity', '10 people', false),
      spec('Length', '', false),
      spec('Safety equipment', '', false),
      spec('Trailer', '', false),
    ],
    included: [
      { text: 'Suzuki 30HP outboard engine', confirmed: true },
      { text: 'Canopy', confirmed: false },
    ],
    excluded: ['Delivery', 'Licensing & registration'],
    condition: { value: 'new', confirmed: true, notes: '' },
    availability: 'made_to_order',
    benefits: [
      'Spacious deck for family days on the water',
      'Ideal for dams, rivers and sheltered waters',
      'Low-maintenance aluminium construction',
    ],
    claims: [
      { text: 'Stable & safe', status: 'needs_review', evidence: '' },
      { text: 'Fuel efficient', status: 'needs_review', evidence: '' },
      { text: 'Built to last', status: 'marketing', evidence: '' },
    ],
    images: [
      { id: uid('img'), src: demoBoatIllustration(), kind: 'illustrative', width: 1600, height: 1000, name: 'demo-illustration.svg' },
    ],
    purchaseProcess: 'WhatsApp or call to arrange a viewing and quote.',
    offer: { title: '', start: '', end: '', conditions: '' },
    updatedAt: today,
  };

  return {
    version: 1,
    activeBusinessId: biz.id,
    businesses: [biz],
    products: [boat],
    creatives: [],
  };
}

export function emptyState() {
  const biz = emptyBusiness();
  return { version: 1, activeBusinessId: biz.id, businesses: [biz], products: [], creatives: [] };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns an error message, or '' when saved. */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return '';
  } catch (e) {
    return e && e.name === 'QuotaExceededError'
      ? 'Browser storage is full. Use smaller images or export a backup and remove old creatives.'
      : 'Could not save to browser storage. Export a backup to keep your work.';
  }
}

export function isValidState(s) {
  return !!s && typeof s === 'object' && Array.isArray(s.businesses) && Array.isArray(s.products) && Array.isArray(s.creatives);
}
