---
name: new-skill
description: >-
  Scaffold a new Agent Skill for the unity-mcp-server repo so it lands in the canonical
  skills/ folder and gets mirrored to every tool-specific directory. Use when creating,
  adding, authoring, or scaffolding a new SKILL.md for this project.
---

# Creating a new skill for this repo

This repo's skills have **one source of truth**: `skills/<skill-name>/`. Everything under
`.claude/skills/`, `.cursor/skills/`, and `.agents/skills/` is a generated mirror — never
edit those directly, and don't let a skill-creation tool write into them directly either.

## Steps

1. **Create the skill directly under `skills/`**, not under any tool-specific folder.
   - Claude Code's official `skill-creator` plugin: when asked where to save the skill,
     choose the custom-path / "for sharing" option and give it `./skills` (not
     `.claude/skills`). It will create `skills/<skill-name>/SKILL.md`.
   - Cursor's `/create-skill`: tell it explicitly to save the skill as a project skill at
     `./skills/<skill-name>/`, not the default `.cursor/skills/`.
   - Writing by hand: just create `skills/<skill-name>/SKILL.md` directly.

2. **Check for double-nesting.** Skill-creator tools sometimes append the skill name twice
   (a known bug in `init_skill.py`). Verify the file ends up at
   `skills/<skill-name>/SKILL.md`, NOT `skills/<skill-name>/<skill-name>/SKILL.md`. If it's
   double-nested, move the inner folder's contents up one level and delete the empty inner
   folder — or just run `node scripts/setup-skills.js --reconcile`, which fixes this
   automatically.

3. **Keep it flat.** Do not nest skills in category subfolders under `skills/` (e.g. avoid
   `skills/vrse/story-authoring/`). Use a descriptive hyphenated name instead
   (`vrse-story-authoring`).

4. **Follow the Agent Skills spec** for `SKILL.md` frontmatter:
   - `name`: lowercase letters/numbers/hyphens only, ≤64 chars, must match the folder name.
   - `description`: ≤1024 chars, states both *what* the skill does and *when* to use it,
     written in third person, with concrete trigger keywords.
   - Keep the body under ~500 lines; move detailed reference material into `references/`,
     runnable helpers into `scripts/`, templates into `assets/`.

5. **Mirror it to every tool's directory:**
   ```bash
   npm run skills:sync
   ```
   This copies the new `skills/<skill-name>/` folder into `.claude/skills/`,
   `.cursor/skills/`, and `.agents/skills/`, and removes any stale mirrors for skills that
   no longer exist in `skills/`.

6. **Commit it all together** — `skills/<skill-name>/` and its three mirrors — in one change
   so Claude Code, Cursor, Codex, and OpenCode all pick it up identically.

## If a skill ends up in the wrong place

If a skill-creation tool ignored these instructions and wrote directly into
`.claude/skills/`, `.cursor/skills/`, or `.agents/skills/` instead of `skills/`, run:

```bash
npm run skills:reconcile
```

This pulls any skill folder that exists in a mirror but not in `skills/` back into the
canonical `skills/` directory (fixing double-nesting along the way), then re-mirrors
everywhere so all four locations match again.
