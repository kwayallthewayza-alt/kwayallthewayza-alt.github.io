# AI Business Content & Marketing Studio — architecture

## What exists today (Phase 1 prototype, `/studio/`)

A static, browser-only app that can be hosted on GitHub Pages. No server, no API keys, nothing uploaded.

| Module | File | Role |
|---|---|---|
| Brand memory | `studio/js/data.js` | Business profiles (multi-brand), contact details, colours, font, tone, audience, approved/prohibited claims, disclaimer. Industry spec templates (boat, vehicle, laptop, property, food, service, general). Local persistence and JSON backup. |
| Product knowledge base | `studio/js/data.js` | Price (type, currency, source, confirmed date, valid-until), specs, inclusions, exclusions, condition, availability, benefits, claims with evidence, real vs illustrative images, offer dates. |
| Truth & clarity engine | `studio/js/truth.js` | Splits facts into **verified / needs review / missing**. Only verified facts reach a design. Flags risky claims (superlatives, safety, guarantees, efficiency, durability, condition, environmental, scarcity), blocks prohibited claims, catches stale or expired prices and expired offers, and runs the pre-approval quality checks. |
| Marketing strategist & copywriter | `studio/js/strategy.js` | Chooses the selling angle from goal + audience + recorded benefits, writes headline variants, bullets, CTA, fine print, platform captions (Facebook, Instagram, WhatsApp, LinkedIn, TikTok) and enquiry replies. Rule-based: it only interpolates recorded facts. |
| Design engine | `studio/js/render.js` | Canvas layout engine. Renders every word, price, phone number and logo as real text in square, portrait, story, landscape and A4 flyer formats. Reports font sizes, overflow, contrast and image upscaling for the legibility checks. |
| Workflow | `studio/js/app.js` | Create wizard → studio editor (undo/redo, versions, variants, colours, layouts) → quality report → named approval with a fingerprint of the data used → export. Unapproved exports are watermarked. If the content or product data changes, the approval is invalidated automatically. |

Tests: `cd studio && npm test` (Node 18+ built-in test runner, no dependencies).

## Rules enforced in code, not just in a prompt

- Unconfirmed specs, inclusions, prices and conditions are never placed on a design.
- Price and contact text are locked and derived from the records. Any other money amount or phone number typed into the copy fails the check.
- "Includes …" and "Spec: value" lines are re-checked against the current record on every render.
- Prohibited claims and sold-out products block approval.
- Approval records who approved, when, which warnings they accepted, and the price, source, specs, contact and image used.
- Illustrative images are labelled on the design and in the fine print.

## Phase 2+ target architecture

```
Browser (this UI) ──HTTPS──► API server (auth, tenancy, permissions)
                               ├── Database (Postgres): businesses, products, facts+sources, creatives, approvals, audit log
                               ├── Object storage: photos, logos, exports
                               ├── AI service: LLM for strategy/copy (prompt: ai-orchestration-prompt.md), image generation for backgrounds only
                               ├── Design engine: same layout code run server-side (node-canvas / headless browser) for exports
                               ├── Validation service: truth.js rules + LLM-assisted claim review
                               ├── Workflow engine: drafts → review → approval → schedule → publish
                               └── Analytics: platform APIs, enquiries, leads, sales
```

- API keys live only on the server. Never ship them to the browser.
- Every row carries `business_id`. Enforce tenant isolation in the database (row-level security) as well as in the API.
- LLM output is a **suggestion**. It passes through the same validation as human edits before approval.
- Generated images are used as visual backgrounds or concept art and labelled as illustrative. They are never presented as photos of the actual product.
- Roles: creator, reviewer, approver, admin. Approval is a permissioned action.

## Phased roadmap

1. **Phase 1 (done here):** onboarding, product database, posters and social graphics, captions and CTAs, automated fact/contact/claim checks, editable designs, exports.
2. **Phase 2:** server and accounts, LLM copy and strategy, campaign calendar, reusable templates, catalogue CSV import and bulk price updates, team approvals, research-assisted strategy, video scripts.
3. **Phase 3:** social publishing integrations, analytics and conversion tracking, A/B tests, lead capture and enquiry management, result-informed suggestions.

## Success metrics to track

Accuracy rate, first-pass approval rate, time to approved campaign, brand consistency, usable assets per campaign, cost per usable asset, and enquiries/leads/sales where measurable. Set targets after testing with real businesses.
