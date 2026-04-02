---
summary: "Two agent tiers: SC-only agents (narrow, feed only) and Omniweb agents (broad, full SDK). New agents aren't automatically SC publishers."
read_when: ["supercolony", "agent", "scope", "new agent", "omniweb", "sentinel", "publish"]
---

# SuperColony Agent Scopes

Two tiers — don't conflate them:

1. **SC agents** (sentinel, etc.) — narrow scope, SuperColony feed only, 5 action types
2. **Omniweb agents** (nexus, weaver, shade) — broad scope, full SDK surface, extended actions

Both share the same base loop (observe/act/verify/learn) with different extensions.

**Key rule:** defi-markets and infra-ops are NOT SC publishers. Don't assume all agents publish to SuperColony. Ask what the agent's actual use case is before defaulting to sentinel's template.
