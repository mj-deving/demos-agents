---
summary: "Cross-reference catalog.json URLs with provider spec urlTemplates — variable names and query params must match exactly"
read_when: ["catalog", "spec", "api", "provider", "yaml", "urlTemplate", "source"]
---

# Catalog-Spec Consistency

catalog.json URL is the **source of truth** for variable names and query parameters.

1. Before writing any spec, read the catalog entry's `url` and `urlPattern` fields
2. Match variable names exactly (e.g., `{symbol}` not `{symbols}`)
3. Match query parameters exactly (sort order, page size, interval)
4. Run `npx tsx tools/source-test.ts --source ID` after writing to smoke-test
5. For batch work: `npx tsx tools/spec-consistency.ts`

**Gotcha:** Text/HTML response sources (like isup.me) are incompatible with the declarative engine — keep as `generic` provider.
