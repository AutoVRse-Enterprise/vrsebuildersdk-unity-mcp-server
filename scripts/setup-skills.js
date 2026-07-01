#!/usr/bin/env node
// Syncs skills/ (canonical source of truth) -> .claude/skills/, .cursor/skills/, .agents/skills/
// so Claude Code, Cursor, Codex, and OpenCode all discover the same skills natively.
//
// Usage:
//   node scripts/setup-skills.js               sync skills/ -> all mirrors
//   node scripts/setup-skills.js --reconcile   pull any mirror-only skills back into skills/ first, then sync
//   node scripts/setup-skills.js --check       exit 1 if any mirror is out of sync (for CI)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CANONICAL_DIR = path.join(ROOT, "skills");
const MIRROR_DIRS = [
  path.join(ROOT, ".claude", "skills"),
  path.join(ROOT, ".cursor", "skills"),
  path.join(ROOT, ".agents", "skills"),
];

const args = process.argv.slice(2);
const RECONCILE = args.includes("--reconcile");
const CHECK_ONLY = args.includes("--check");

function listSkillDirs(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

function skillMdPath(dir) {
  return path.join(dir, "SKILL.md");
}

// Fixes the known skill-creator double-nesting bug:
// skills/<name>/<name>/SKILL.md -> skills/<name>/SKILL.md
function flattenDoubleNesting(skillDir, name) {
  const nested = path.join(skillDir, name);
  if (fs.existsSync(skillMdPath(skillDir))) return; // already correct
  if (!fs.existsSync(skillMdPath(nested))) return; // nothing to fix

  console.log(`  fixing double-nested skill: ${name}`);
  for (const entry of fs.readdirSync(nested)) {
    fs.renameSync(path.join(nested, entry), path.join(skillDir, entry));
  }
  fs.rmSync(nested, { recursive: true, force: true });
}

function copyDirClean(src, dest) {
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function dirsEqual(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  const norm = (entries) => entries.sort((x, y) => x.name.localeCompare(y.name));
  const aEntries = norm(fs.readdirSync(a, { withFileTypes: true }));
  const bEntries = norm(fs.readdirSync(b, { withFileTypes: true }));
  if (aEntries.length !== bEntries.length) return false;

  for (let i = 0; i < aEntries.length; i++) {
    if (aEntries[i].name !== bEntries[i].name) return false;
    if (aEntries[i].isDirectory() !== bEntries[i].isDirectory()) return false;

    const pa = path.join(a, aEntries[i].name);
    const pb = path.join(b, bEntries[i].name);
    if (aEntries[i].isDirectory()) {
      if (!dirsEqual(pa, pb)) return false;
    } else if (!fs.readFileSync(pa).equals(fs.readFileSync(pb))) {
      return false;
    }
  }
  return true;
}

function main() {
  fs.mkdirSync(CANONICAL_DIR, { recursive: true });

  // Fix double-nesting in canonical skills first.
  for (const name of listSkillDirs(CANONICAL_DIR)) {
    flattenDoubleNesting(path.join(CANONICAL_DIR, name), name);
  }

  // Reconcile: pull any skill created directly in a mirror back into skills/.
  if (RECONCILE) {
    for (const mirror of MIRROR_DIRS) {
      for (const name of listSkillDirs(mirror)) {
        const mirrorSkillDir = path.join(mirror, name);
        flattenDoubleNesting(mirrorSkillDir, name);

        const canonicalSkillDir = path.join(CANONICAL_DIR, name);
        if (!fs.existsSync(skillMdPath(canonicalSkillDir))) {
          console.log(
            `[reconcile] pulling "${name}" from ${path.relative(ROOT, mirror)} into skills/`
          );
          copyDirClean(mirrorSkillDir, canonicalSkillDir);
        }
      }
    }
  }

  const canonicalSkills = listSkillDirs(CANONICAL_DIR);
  const outOfSync = [];

  for (const mirror of MIRROR_DIRS) {
    const relMirror = path.relative(ROOT, mirror);

    if (!CHECK_ONLY) fs.mkdirSync(mirror, { recursive: true });
    const existing = listSkillDirs(mirror);

    // Remove mirrored skills that no longer exist in the canonical folder.
    for (const name of existing) {
      if (canonicalSkills.includes(name)) continue;
      if (CHECK_ONLY) {
        outOfSync.push(`${relMirror}/${name} (stale — no longer in skills/)`);
        continue;
      }
      console.log(`  removing stale mirror: ${relMirror}/${name}`);
      fs.rmSync(path.join(mirror, name), { recursive: true, force: true });
    }

    // Add/update mirrors for every canonical skill.
    for (const name of canonicalSkills) {
      const src = path.join(CANONICAL_DIR, name);
      const dest = path.join(mirror, name);

      if (dirsEqual(src, dest)) continue;
      if (CHECK_ONLY) {
        outOfSync.push(`${relMirror}/${name}`);
        continue;
      }
      copyDirClean(src, dest);
      console.log(`  synced ${name} -> ${relMirror}/`);
    }
  }

  if (CHECK_ONLY) {
    if (outOfSync.length > 0) {
      console.error("Skill mirrors are out of sync with skills/:");
      for (const p of outOfSync) console.error(`  - ${p}`);
      console.error("\nRun: npm run skills:sync");
      process.exit(1);
    }
    console.log("All skill mirrors are in sync with skills/.");
    return;
  }

  console.log(
    `\nDone. ${canonicalSkills.length} skill(s) mirrored to: ${MIRROR_DIRS.map((d) =>
      path.relative(ROOT, d)
    ).join(", ")}`
  );
}

main();
