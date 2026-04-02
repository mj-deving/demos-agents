---
summary: "Default to --oversight autonomous for session-runner. Manual phase-by-phase only when Marius asks for verbose visibility."
read_when: ["autonomous", "session", "session-runner", "oversight", "phase", "live session"]
---

# Autonomous Sessions

Default: `npx tsx tools/session-runner.ts --agent NAME --oversight autonomous --pretty`

Do NOT manually run each phase (audit, scan, engage, gate, publish, verify) one by one unless Marius specifically asks for verbose step-by-step visibility. The `--oversight autonomous` mode doesn't need tty.
