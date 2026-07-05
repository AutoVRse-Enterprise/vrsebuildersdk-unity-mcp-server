# Skills

This folder is the **canonical source of truth** for this repo's [Agent Skills](https://agentskills.io).
It is mirrored into `.claude/skills/`, `.cursor/skills/`, and `.agents/skills/` by
`scripts/setup-skills.js` so that Claude Code, Cursor, Codex, and OpenCode all discover the
same skills natively, without any extra setup from whoever clones this repo.

Mirrors are committed to git so `git pull` delivers updated skills immediately. A `prepare`
hook in `package.json` also runs the sync on every `npm install` as a safety net — if mirrors
ever drift, the next install self-heals them.

**Never hand-edit `.claude/skills/`, `.cursor/skills/`, or `.agents/skills/` directly.**
They are generated and will be overwritten the next time the sync script runs.

## Layout

Flat only — one folder per skill directly under `skills/`, no category subfolders. Claude
Code cannot discover skills nested more than one level below a skills root, so nesting here
would silently break compatibility for that tool.

```
skills/
├── README.md
├── new-skill/          # meta-skill: how to add a new skill to this repo
│   └── SKILL.md
└── <your-skill-name>/
    ├── SKILL.md
    ├── scripts/        # optional: executable helpers
    ├── references/     # optional: docs loaded on demand
    └── assets/         # optional: templates, schemas, etc.
```

## Adding a skill

Use the `new-skill` skill (`skills/new-skill/SKILL.md`) — ask your agent to "use the
new-skill skill" or "add a new skill for X". It explains exactly where skill-creation tools
should write files and how to keep every tool's mirror in sync.

## Syncing

```bash
npm run skills:sync        # mirror skills/ -> .claude/skills/, .cursor/skills/, .agents/skills/
npm run skills:reconcile   # pull back any skill created directly in a mirror, then sync
npm run skills:check       # exit non-zero if mirrors are out of sync with skills/ (for CI)
```
