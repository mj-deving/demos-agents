# docs-site

Static public docs surface for GitHub Pages.

Source-of-truth rules:

- Canonical package truth lives in `packages/omniweb-toolkit/`.
- Canonical repo architecture and research live in `docs/`.
- `docs-site/` is the public-facing summary layer and should stay smaller than either source set.

Update workflow:

1. edit canonical repo docs first
2. refresh the public summary pages here only if the outside-facing framing changed
3. merge to `main`
4. GitHub Pages deploys the static artifact from `docs-site/`
