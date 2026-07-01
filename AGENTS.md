# Agent instructions — unity-mcp-server

This repo is a Model Context Protocol (MCP) server exposing Unity Editor + VRseBuilder
tooling as `unity_*` / `vrse_*` tools. See `README.md` for the full tool catalog and
architecture.

## Skills

This repo ships portable [Agent Skills](https://agentskills.io). The canonical source of
truth is `skills/`; it is mirrored into `.claude/skills/`, `.cursor/skills/`, and
`.agents/skills/` so Claude Code, Cursor, Codex, and OpenCode all discover the same skills
natively — no setup required after cloning.

- Adding a new skill? Use the `new-skill` skill (`skills/new-skill/SKILL.md`) — it explains
  exactly where skill-creation tools should write files and how to sync them.
- After editing anything under `skills/`, run `npm run skills:sync` before committing.
- Never hand-edit `.claude/skills/`, `.cursor/skills/`, or `.agents/skills/` directly — they
  are generated and will be overwritten by the sync script.

## Adding a new `unity_*` tool

This server uses a two-tier system (`src/tool-tiers.js`) to keep the exposed tool list small
enough for MCP clients (a flat 268-tool list once broke client registration). When adding a
new tool, decide whether it belongs in `CORE_TOOLS` (always exposed individually) or should
stay "advanced" (routed through `unity_advanced_tool`, discoverable via
`unity_list_advanced_tools`) — see the README's "Two-Tier Tool System" section before wiring
it in.
