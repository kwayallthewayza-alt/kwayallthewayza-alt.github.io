// Layout engine. Renders creatives on <canvas> with real text.
//
// Images are only the visual layer; every word, price, phone number and logo
// is drawn here from the approved records so spelling and figures are exact.
// Returns a render report that truth.js uses for legibility checks.

import { readableOn } from './format.js';
import { FORMATS } from './data.js';

export const LAYOUTS = {
  hero: 'Photo top, info panel',
  overlay: 'Full-bleed photo, text overlay',
  split: 'Photo side, info panel',
  sheet: 'Product sheet (flyer)',
};

function setFont(ctx, size, weight, family) {
  ctx.font = `${weight} ${Math.round(size)}px "${family}", system-ui, sans-serif`;
}

function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else {
        out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Fit text into a box by shrinking from maxSize to minSize.
 * Returns { lines, size, height, overflow }.
 */
function fitText(ctx, text, { w, h, maxSize, minSize, weight = 700, family, lineHeight = 1.15, maxLines = 99 }) {
  if (!text) return { lines: [], size: 0, height: 0, overflow: false };
  for (let size = maxSize; size >= minSize; size -= 2) {
    setFont(ctx, size, weight, family);
    const lines = wrap(ctx, text, w);
    const height = lines.length * size * lineHeight;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length <= maxLines && height <= h && widest <= w) return { lines, size, height, overflow: false };
  }
  setFont(ctx, minSize, weight, family);
  let lines = wrap(ctx, text, w);
  const fitLines = Math.max(1, Math.min(maxLines, Math.floor(h / (minSize * lineHeight))));
  const overflow = lines.length > fitLines;
  if (overflow) {
    lines = lines.slice(0, fitLines);
    let last = lines[fitLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > w) last = last.slice(0, -1);
    lines[fitLines - 1] = last + '…';
  }
  return { lines, size: minSize, height: lines.length * minSize * lineHeight, overflow };
}

function drawLines(ctx, fit, x, y, { color, weight = 700, family, lineHeight = 1.15, align = 'left', w = 0 }) {
  if (!fit.lines.length) return y;
  setFont(ctx, fit.size, weight, family);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
  fit.lines.forEach((line, i) => ctx.fillText(line, ax, y + i * fit.size * lineHeight));
  ctx.textAlign = 'left';
  return y + fit.lines.length * fit.size * lineHeight;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw image covering the box. Returns the upscale factor (>1 means enlarged). */
function drawCover(ctx, img, x, y, w, h, focusY = 0.5) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return 1;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) * focusY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  return scale;
}

function placeholderImage(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  setFont(ctx, Math.max(18, w / 28), 600, 'Inter');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Add a product photo', x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
}

function drawLogo(ctx, logo, x, y, maxW, maxH, bg) {
  if (!logo) return;
  const iw = logo.naturalWidth || logo.width;
  const ih = logo.naturalHeight || logo.height;
  if (!iw || !ih) return;
  const s = Math.min(maxW / iw, maxH / ih);
  const w = iw * s;
  const h = ih * s;
  const pad = maxH * 0.18;
  if (bg) {
    ctx.fillStyle = bg;
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, pad);
    ctx.fill();
  }
  ctx.drawImage(logo, x, y, w, h);
}

function tag(ctx, text, x, y, size, bg, fg, family) {
  setFont(ctx, size, 600, family);
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.8;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + size * 0.6, y + h / 2);
  return { w, h };
}

function watermark(ctx, W, H) {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.atan2(H, W));
  setFont(ctx, Math.min(W, H) / 9, 800, 'Inter');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(220, 38, 38, 0.28)';
  ctx.fillText('DRAFT — NOT APPROVED', 0, 0);
  ctx.restore();
}

/**
 * Render a creative.
 * opts: { format, layout, texts, colors, font, image:{el,kind}, logo: HTMLImageElement|null,
 *         businessName, specs:[{label,value}], draft:boolean }
 */
export function renderCreative(canvas, opts) {
  const fmt = FORMATS[opts.format] || FORMATS.square;
  const W = fmt.w;
  const H = fmt.h;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const family = opts.font || 'Montserrat';
  const c = opts.colors;
  const t = opts.texts;
  const report = { canvasWidth: W, minFontPx: Infinity, minFinePrintPx: 0, overflow: [], dropped: [], imageScale: 0, contrastPairs: [] };
  const track = (fit, name) => {
    if (fit.size) report.minFontPx = Math.min(report.minFontPx, fit.size);
    if (fit.overflow) report.overflow.push(name);
  };

  let layout = opts.layout || 'hero';
  if (opts.format === 'flyer') layout = 'sheet';
  else if (opts.format === 'landscape' && layout === 'hero') layout = 'split';
  else if (layout === 'sheet') layout = 'hero';

  const panelText = readableOn(c.primary);
  const accentText = readableOn(c.accent);
  // Layout unit. Tall formats (story, flyer) get proportionally larger type so the space is used.
  const tall = layout === 'split' ? 1 : Math.min(layout === 'sheet' ? 1.2 : 1.35, Math.max(1, H / W));
  const U = (Math.min(W, H) / 100) * tall;
  const pad = U * 6;

  ctx.fillStyle = c.primary;
  ctx.fillRect(0, 0, W, H);

  // --- Image region
  let img = { x: 0, y: 0, w: W, h: H };
  let panel = { x: 0, y: 0, w: W, h: H };
  if (layout === 'hero') {
    const ratio = H / W > 1.5 ? 0.5 : H / W > 1.1 ? 0.5 : 0.48;
    img = { x: 0, y: 0, w: W, h: Math.round(H * ratio) };
    panel = { x: 0, y: img.h, w: W, h: H - img.h };
  } else if (layout === 'split') {
    img = { x: 0, y: 0, w: Math.round(W * 0.5), h: H };
    panel = { x: img.w, y: 0, w: W - img.w, h: H };
  } else if (layout === 'sheet') {
    img = { x: 0, y: 0, w: W, h: Math.round(H * 0.3) };
    panel = { x: 0, y: img.h, w: W, h: H - img.h };
  } else if (layout === 'overlay') {
    img = { x: 0, y: 0, w: W, h: H };
    panel = { x: 0, y: Math.round(H * (H / W > 1.5 ? 0.5 : 0.4)), w: W, h: H - Math.round(H * (H / W > 1.5 ? 0.5 : 0.4)) };
  }

  if (opts.image?.el) {
    report.imageScale = drawCover(ctx, opts.image.el, img.x, img.y, img.w, img.h, 0.55) * (opts.image.el.naturalWidth > 0 ? 1 : 0);
  } else {
    placeholderImage(ctx, img.x, img.y, img.w, img.h, shade(c.primary, -0.2));
  }

  let textColor = panelText;
  let panelBg = c.primary;
  if (layout === 'overlay') {
    const g = ctx.createLinearGradient(0, panel.y - U * 18, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.3, 'rgba(0,0,0,0.72)');
    g.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, panel.y - U * 18, W, H - panel.y + U * 18);
    textColor = '#ffffff';
    panelBg = '#151515';
  } else if (layout === 'sheet') {
    ctx.fillStyle = c.secondary || '#ffffff';
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    panelBg = c.secondary || '#ffffff';
    textColor = readableOn(panelBg);
  }
  report.contrastPairs.push({ name: 'Headline text', fg: textColor, bg: panelBg, large: true });
  report.contrastPairs.push({ name: 'Call-to-action text', fg: accentText, bg: c.accent, large: true });

  // Logo
  if (opts.logo) drawLogo(ctx, opts.logo, pad, pad, U * 26, U * 9, 'rgba(255,255,255,0.92)');
  else if (opts.businessName) {
    tag(ctx, opts.businessName, pad * 0.7, pad * 0.7, U * 3.2, 'rgba(255,255,255,0.92)', '#111', family);
  }

  // Illustrative label
  if (opts.image?.el && opts.image.kind !== 'real') {
    const ls = U * 3;
    setFont(ctx, ls, 600, family);
    const label = 'Illustrative image';
    const lw = ctx.measureText(label).width + ls * 1.2;
    tag(ctx, label, img.x + img.w - lw - pad * 0.6, img.y + pad * 0.6, ls, 'rgba(0,0,0,0.6)', '#fff', family);
    report.minFontPx = Math.min(report.minFontPx, ls);
  }

  // Price badge / offer ribbon on the image
  if (layout !== 'sheet' && (t.priceText || t.offer)) {
    const bx = layout === 'split' ? img.x + pad * 0.6 : pad;
    let by = img.y + img.h - pad * 0.6;
    if (t.priceText) {
      const pf = fitText(ctx, t.priceText, { w: (layout === 'split' ? img.w : W) - pad * 2.4, h: U * 9, maxSize: U * 6.2, minSize: U * 3.2, weight: 800, family, maxLines: 1 });
      track(pf, 'Price');
      setFont(ctx, pf.size, 800, family);
      const bw = ctx.measureText(pf.lines[0] || '').width + pf.size * 1.2;
      const bh = pf.size * 1.7;
      by -= bh;
      if (layout === 'overlay') by = panel.y - U * 2 - bh;
      ctx.fillStyle = c.accent;
      roundRect(ctx, bx, by, bw, bh, U * 1.4);
      ctx.fill();
      ctx.fillStyle = accentText;
      ctx.textBaseline = 'middle';
      ctx.fillText(pf.lines[0] || '', bx + pf.size * 0.6, by + bh / 2 + pf.size * 0.04);
      report.contrastPairs.push({ name: 'Price text', fg: accentText, bg: c.accent, large: true });
    }
    if (t.offer) {
      const of = fitText(ctx, t.offer.toUpperCase(), { w: (layout === 'split' ? img.w : W) * 0.7, h: U * 6, maxSize: U * 3.6, minSize: U * 2.4, weight: 800, family, maxLines: 1 });
      track(of, 'Offer');
      tag(ctx, of.lines[0] || '', bx, (by || img.y + img.h) - of.size * 2.4, of.size, '#d92d20', '#ffffff', family);
    }
  }

  // --- Text panel
  const px = panel.x + pad;
  const pw = panel.w - pad * 2;
  let y = panel.y + pad * (layout === 'overlay' ? 0.6 : 0.9);
  const bottomReserve = U * 15; // CTA + fine print
  const avail = panel.y + panel.h - bottomReserve - y;

  const hf = fitText(ctx, t.headline, { w: pw, h: avail * 0.36, maxSize: U * (layout === 'sheet' ? 7 : 8.5), minSize: U * 3.6, weight: 800, family, lineHeight: 1.08, maxLines: 3 });
  track(hf, 'Headline');
  y = drawLines(ctx, hf, px, y, { color: textColor, weight: 800, family, lineHeight: 1.08 });
  y += U * 1.4;

  if (t.subheadline) {
    const sf = fitText(ctx, t.subheadline, { w: pw, h: avail * 0.2, maxSize: U * 4.2, minSize: U * 3.2, weight: 500, family, maxLines: 3 });
    track(sf, 'Sub-headline');
    y = drawLines(ctx, sf, px, y, { color: textColor, weight: 500, family });
    y += U * 2;
  }

  if (layout === 'sheet') {
    if (t.priceText) {
      const pf = fitText(ctx, t.priceText, { w: pw, h: U * 8, maxSize: U * 6, minSize: U * 3, weight: 800, family, maxLines: 1 });
      track(pf, 'Price');
      y = drawLines(ctx, pf, px, y, { color: c.primary === panelBg ? textColor : c.primary, weight: 800, family });
      y += U * 1.6;
    }
    if (t.offer) {
      const r = tag(ctx, t.offer, px, y, U * 2.6, '#d92d20', '#fff', family);
      y += r.h + U * 1.6;
    }
    // Spec table: confirmed specs only.
    const specs = opts.specs || [];
    if (specs.length) {
      setFont(ctx, U * 2.6, 700, family);
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'top';
      ctx.fillText('Specifications', px, y);
      y += U * 4;
      const rowH = U * 4.4;
      specs.slice(0, 8).forEach((s, i) => {
        if (i % 2 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.05)';
          ctx.fillRect(px, y, pw, rowH);
        }
        setFont(ctx, U * 2.3, 600, family);
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'middle';
        ctx.fillText(s.label, px + U * 1.2, y + rowH / 2);
        const vf = fitText(ctx, s.value, { w: pw * 0.55, h: rowH, maxSize: U * 2.3, minSize: U * 1.6, weight: 400, family, maxLines: 1 });
        track(vf, `Spec "${s.label}"`);
        setFont(ctx, vf.size, 400, family);
        ctx.fillText(vf.lines[0] || '', px + pw * 0.42, y + rowH / 2);
        y += rowH;
      });
      report.minFontPx = Math.min(report.minFontPx, U * 2.3);
      y += U * 2;
    }
  }

  // Bullets
  const bullets = (t.bullets || []).filter(Boolean);
  if (bullets.length) {
    const room = panel.y + panel.h - bottomReserve - y;
    const per = room / bullets.length;
    const minB = layout === 'sheet' ? U * 2.2 : U * 3;
    const maxSize = Math.min(U * (layout === 'sheet' ? 2.8 : 3.6), per / 1.5);
    const bsize = Math.max(minB, maxSize);
    for (const [i, b] of bullets.entries()) {
      if (y + bsize * 1.3 > panel.y + panel.h - bottomReserve) {
        report.dropped.push(...bullets.slice(i));
        break;
      }
      const bf = fitText(ctx, b, { w: pw - bsize * 1.4, h: bsize * 2.6, maxSize: bsize, minSize: minB, weight: 500, family, maxLines: 2 });
      track(bf, 'Bullet point');
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(px + bf.size * 0.35, y + bf.size * 0.55, bf.size * 0.22, 0, Math.PI * 2);
      ctx.fill();
      y = drawLines(ctx, bf, px + bf.size * 1.1, y, { color: textColor, weight: 500, family });
      y += bf.size * 0.45;
    }
  }

  // CTA bar
  const ctaH = U * 8.4;
  const ctaY = panel.y + panel.h - U * 6 - ctaH;
  ctx.fillStyle = c.accent;
  roundRect(ctx, px, ctaY, pw, ctaH, U * 1.6);
  ctx.fill();
  const ctaText = [t.cta, t.contact].filter(Boolean).join(': ');
  const cf = fitText(ctx, ctaText, { w: pw - U * 4, h: ctaH * 0.8, maxSize: U * 3.6, minSize: U * 3, weight: 700, family, maxLines: 2 });
  track(cf, 'Call to action');
  drawLines(ctx, cf, px + U * 2, ctaY + (ctaH - cf.height) / 2, { color: accentText, weight: 700, family, align: 'center', w: pw - U * 4 });

  // Fine print
  if (t.finePrint) {
    const ff = fitText(ctx, t.finePrint, { w: (layout === 'split' ? pw : W - pad * 2), h: U * 5, maxSize: U * 2, minSize: U * 1.5, weight: 400, family, lineHeight: 1.2, maxLines: 3 });
    // Fine print is tracked separately: it is expected to be small, and captions repeat it in full.
    report.minFinePrintPx = ff.size;
    if (ff.overflow) report.overflow.push('Fine print');
    const fpColor = layout === 'sheet' ? textColor : layout === 'overlay' ? 'rgba(255,255,255,0.85)' : panelText;
    drawLines(ctx, ff, layout === 'split' ? px : pad, H - U * 5.4, { color: fpColor, weight: 400, family, lineHeight: 1.2, w: layout === 'split' ? pw : W - pad * 2 });
  }

  if (opts.draft) watermark(ctx, W, H);
  if (report.minFontPx === Infinity) report.minFontPx = 0;
  return report;
}

/** Lighten (amt>0) or darken (amt<0) a hex colour. */
export function shade(hex, amt) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
