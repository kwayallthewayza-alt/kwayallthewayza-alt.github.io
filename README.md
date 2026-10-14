# kwayallthewayza-alt.github.io
Official site for Furkraalsa

## Business Content Studio (Phase 1 prototype)

An AI-assisted business marketing studio that turns verified business and product records into accurate, on-brand posters, social graphics, product sheets and captions.

- **Open it:** https://kwayallthewayza-alt.github.io/studio/ (after this branch is merged and Pages is enabled), or locally with `cd studio && python3 -m http.server 8080`, then open http://localhost:8080
- **What it does:** brand memory · product knowledge base with verified / needs-review / missing facts · rule-based strategist and copywriter · canvas layout engine that renders exact text · automated price, contact, claim and legibility checks · named approvals with an audit trail · PNG and caption exports
- **Data:** stored only in your browser (export a JSON backup from *Data & backup*)
- **Tests:** `cd studio && npm test`
- **Docs:** [architecture & roadmap](docs/architecture.md) · [AI orchestration prompt](docs/ai-orchestration-prompt.md)
