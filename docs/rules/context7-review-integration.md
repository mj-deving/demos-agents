---
summary: "Use Context7 MCP during planning and Codex review to verify API patterns against live docs — catches training data staleness"
read_when: ["context7", "review", "api", "sdk", "planning", "version", "docs"]
---

# Context7 MCP in Review Workflows

Use Context7 MCP alongside Codex review and during planning to verify API usage patterns against current documentation.

- **Planning:** query Context7 for APIs you're about to use, especially recent or version-bumped packages
- **Codex review:** include Context7 queries to verify API usage patterns are current
- **Skip for:** well-established patterns (basic Node.js, vitest, Zod)
- **Value:** catches subtle version mismatches, saves 10-15 min/session on API verification
