# External Blind Review Session

Session id: ext_20260328_071616_85056e23
Session token: b4d90bec5a6d81d0894aef14ab0a9b8f
Blind packet: /home/mj/projects/demos-agents/.desloppify/review_packet_blind.json
Template output: /home/mj/projects/demos-agents/.desloppify/external_review_sessions/ext_20260328_071616_85056e23/review_result.template.json
Claude launch prompt: /home/mj/projects/demos-agents/.desloppify/external_review_sessions/ext_20260328_071616_85056e23/claude_launch_prompt.md
Expected reviewer output: /home/mj/projects/demos-agents/.desloppify/external_review_sessions/ext_20260328_071616_85056e23/review_result.json

Happy path:
1. Open the Claude launch prompt file and paste it into a context-isolated subagent task.
2. Reviewer writes JSON output to the expected reviewer output path.
3. Submit with the printed --external-submit command.

Reviewer output requirements:
1. Return JSON with top-level keys: session, assessments, issues.
2. session.id must be `ext_20260328_071616_85056e23`.
3. session.token must be `b4d90bec5a6d81d0894aef14ab0a9b8f`.
4. Include issues with required schema fields (dimension/identifier/summary/related_files/evidence/suggestion/confidence).
5. Use the blind packet only (no score targets or prior context).
