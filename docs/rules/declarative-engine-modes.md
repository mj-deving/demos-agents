---
summary: "Declarative engine single-object mode ignores items.jsonPath — use json-path mode for nested responses like Etherscan $.result"
read_when: ["declarative", "engine", "mode", "jsonPath", "single-object", "json-path", "object-entries", "spec"]
---

# Declarative Engine Parse Modes

- **`single-object`**: Passes FULL root object as-is. **Ignores `items.jsonPath` entirely.**
- **`json-path`**: Evaluates `items.jsonPath` against root. Use for nested responses (e.g., `$.result`).
- **`object-entries`**: Iterates over object keys — good for `{"bitcoin": {...}, "ethereum": {...}}`.

**Rule of thumb:**
- API wraps data in envelope (Etherscan `$.result`) → `json-path` with `jsonPath: "$.result"`
- API returns data at root → `single-object`
- API returns arrays → `json-path` with `$[*]` or `$.data[*]`
- Always smoke-test with a representative response fixture
