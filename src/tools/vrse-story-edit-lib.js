// VRse Story-Edit Library — Node-only read-modify-write core for the consolidated story tools.
//
// The story tools (vrse_story_inspect / _edit / _apply) treat "story editing = JSON editing".
// There is NO plugin route that returns the raw serialized StoryCreator._story, so the source of
// truth is the on-disk Story JSON file (the MCP server runs on the same host). The cycle is:
//
//   flush (vrse/story-save) → resolve file path → readFileSync → JSON.parse
//     → applyOps() mutate the parsed graph IN PLACE (preserves serializer-added keys)
//     → validateStoryJson() (halt-before-mutate) → writeStory() (apply-json/apply-file → save)
//
// The Story object graph shape (verified against vrse-stage-tools.js _buildStory/_buildMoment and
// the byte-parity test tests/generate-story.smoke.mjs). Casing is load-bearing:
//   Node   = { Name, ID, Query, Option, Data(STRING), Type(0|1) }          // PascalCase
//   Moment = { name, momentIndex, studio, defaults(STRING),
//              onAwake/onStart/onFirstWarning/onLastWarning/onEnd:{actions:Node[]},
//              onWrong: Set[],                       // BARE array (no {sets} wrapper)
//              onRight: { mode, triggerActionSets: Set[] } }
//   Set    = { trigger:Node(Type 1), actions:Node[] }
//   Chapter= { name, chapterIndex, studio, defaults(STRING), moments:Moment[] }
//   Story  = { name, formatVersion:2.0, chapters:Chapter[], defaults(STRING) }

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import * as bridge from "../unity-editor-bridge.js";
import { unwrap, _emitAction, _emitTrigger } from "./vrse-stage-tools.js";
import { getSelectedInstance } from "../instance-discovery.js";

const LINEAR_SECTIONS = new Set(["onAwake", "onStart", "onFirstWarning", "onLastWarning", "onEnd"]);
const SET_SECTIONS = new Set(["onWrong", "onRight"]);

// ─── small structural helpers ────────────────────────────────────────────────

function inRange(arr, i) { return Array.isArray(arr) && Number.isInteger(i) && i >= 0 && i < arr.length; }
function badAddr(ctx, op, detail) { ctx.missing.push({ kind: "BAD_ADDRESS", op, detail }); }

export function ensureChapters(story) {
  if (!story || typeof story !== "object") return;
  if (!Array.isArray(story.chapters)) story.chapters = [];
}

export function emptyChapter(name) {
  return { name: name ?? "New Chapter", chapterIndex: 0, studio: { id: "" }, defaults: "", moments: [] };
}

export function emptyMoment(name) {
  return {
    name: name ?? "New Moment",
    momentIndex: 0,
    studio: { id: "" },
    defaults: "",
    onAwake: { actions: [] },
    onStart: { actions: [] },
    onRight: { mode: "InOrder", triggerActionSets: [] },
    onWrong: [],
    onFirstWarning: { actions: [] },
    onLastWarning: { actions: [] },
    onEnd: { actions: [] },
  };
}

/** Coerce any node-ish object into the canonical PascalCase node; Data is always a string. */
function normalizeNode(n, defaultType = 0) {
  n = n || {};
  let data = n.Data ?? n.data ?? "";
  if (data && typeof data === "object") data = JSON.stringify(data);
  return {
    Name: n.Name ?? n.name ?? "",
    ID: n.ID ?? n.id ?? -1,
    Query: n.Query ?? n.query ?? "",
    Option: n.Option ?? n.option ?? "",
    Data: data ?? "",
    Type: n.Type ?? n.type ?? defaultType,
  };
}

function insertAt(arr, item, index) {
  if (index == null || index < 0 || index > arr.length) arr.push(item);
  else arr.splice(index, 0, item);
}

function moveInArray(arr, from, to) {
  if (!inRange(arr, from)) return false;
  const [item] = arr.splice(from, 1);
  const dest = Math.max(0, Math.min(to ?? arr.length, arr.length));
  arr.splice(dest, 0, item);
  return true;
}

/** Renumber chapterIndex / momentIndex sequentially (mirrors C# Story.AssignChapterAndMomentIndex). */
export function reindex(story) {
  (story.chapters || []).forEach((ch, ci) => {
    ch.chapterIndex = ci;
    (ch.moments || []).forEach((m, mi) => { m.momentIndex = mi; });
  });
}

export function countStats(story) {
  let chapters = 0, moments = 0, actions = 0, triggers = 0;
  for (const ch of story.chapters || []) {
    chapters++;
    for (const m of ch.moments || []) {
      moments++;
      for (const sec of LINEAR_SECTIONS) actions += (m[sec]?.actions || []).length;
      for (const set of m.onRight?.triggerActionSets || []) { triggers++; actions += (set.actions || []).length; }
      for (const set of m.onWrong || []) { triggers++; actions += (set.actions || []).length; }
    }
  }
  return { chapters, moments, actions, triggers };
}

export function findChapter(story, ref) {
  if (ref == null) return null;
  if (typeof ref === "number") return inRange(story.chapters, ref) ? story.chapters[ref] : null;
  return (story.chapters || []).find((c) => c && c.name === ref) || null;
}

/** Object-merge; arrays are REPLACED (matches the C# story-patch MergeArrayHandling.Replace semantics). */
export function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === "object") {
    const out = (base && typeof base === "object" && !Array.isArray(base)) ? { ...base } : {};
    for (const k of Object.keys(patch)) out[k] = deepMerge(out[k], patch[k]);
    return out;
  }
  return patch;
}

function parseDefaults(s) {
  if (!s) return {};
  if (typeof s === "object") return { ...s };
  try { const o = JSON.parse(s); return o && typeof o === "object" ? o : {}; }
  catch { return {}; }
}

// ─── chapter / moment / section resolvers ────────────────────────────────────

// Address a chapter/moment by numeric index OR by name. `chapterIndex`/`momentIndex` are indices;
// `chapter`/`moment` may be an index (number) or a NAME (string). Name lookups fail LOUD on
// miss (NO_TARGET) or ambiguity (AMBIGUOUS_TARGET) — never silently edit the wrong node.
function chapterRefOf(spec) { return spec?.chapterIndex ?? spec?.chapter; }
function momentRefOf(spec) { return spec?.momentIndex ?? spec?.moment; }

function resolveChapterIdx(story, ref, ctx, op) {
  if (ref == null) { badAddr(ctx, op, "no chapter specified (chapterIndex or chapter)."); return -1; }
  if (typeof ref === "number") {
    if (!inRange(story.chapters, ref)) { badAddr(ctx, op, `chapterIndex ${ref} out of range (0..${(story.chapters?.length ?? 0) - 1}).`); return -1; }
    return ref;
  }
  const hits = [];
  (story.chapters || []).forEach((c, i) => { if (c && c.name === ref) hits.push(i); });
  if (hits.length === 0) { ctx.missing.push({ kind: "NO_TARGET", op, detail: `chapter '${ref}' not found.` }); return -1; }
  if (hits.length > 1) { ctx.missing.push({ kind: "AMBIGUOUS_TARGET", op, detail: `chapter name '${ref}' matches ${hits.length} chapters — use chapterIndex to disambiguate.` }); return -1; }
  return hits[0];
}
function resolveChapter(story, spec, ctx, op) {
  const i = resolveChapterIdx(story, chapterRefOf(spec), ctx, op);
  return i < 0 ? null : story.chapters[i];
}
function resolveMomentIdx(story, ch, ref, ctx, op) {
  if (ref == null) { badAddr(ctx, op, "no moment specified (momentIndex or moment)."); return -1; }
  if (typeof ref === "number") {
    if (!inRange(ch.moments, ref)) { badAddr(ctx, op, `momentIndex ${ref} out of range in chapter '${ch.name}'.`); return -1; }
    return ref;
  }
  const hits = [];
  (ch.moments || []).forEach((m, i) => { if (m && m.name === ref) hits.push(i); });
  if (hits.length === 0) { ctx.missing.push({ kind: "NO_TARGET", op, detail: `moment '${ref}' not found in chapter '${ch.name}'.` }); return -1; }
  if (hits.length > 1) { ctx.missing.push({ kind: "AMBIGUOUS_TARGET", op, detail: `moment name '${ref}' matches ${hits.length} moments in chapter '${ch.name}' — use momentIndex to disambiguate.` }); return -1; }
  return hits[0];
}
function resolveMoment(story, spec, ctx, op) {
  const ch = resolveChapter(story, spec, ctx, op); if (!ch) return null;
  const i = resolveMomentIdx(story, ch, momentRefOf(spec), ctx, op); if (i < 0) return null;
  return ch.moments[i];
}
/** Human-readable target label for compact change notes (e.g. "Pick up syringe/onStart"). */
export function labelOf(spec) {
  const cr = chapterRefOf(spec), mr = momentRefOf(spec);
  const parts = [];
  if (cr != null) parts.push(typeof cr === "number" ? `ch${cr}` : cr);
  if (mr != null) parts.push(typeof mr === "number" ? `m${mr}` : mr);
  if (spec?.section) parts.push(spec.section);
  return parts.join("/");
}
function ensureLinear(moment, section) {
  if (!moment[section] || typeof moment[section] !== "object") moment[section] = { actions: [] };
  if (!Array.isArray(moment[section].actions)) moment[section].actions = [];
  return moment[section].actions;
}
function getSetContainer(moment, section) {
  if (section === "onWrong") {
    if (!Array.isArray(moment.onWrong)) moment.onWrong = [];
    return moment.onWrong;
  }
  if (section === "onRight") {
    if (!moment.onRight || typeof moment.onRight !== "object") moment.onRight = { mode: "InOrder", triggerActionSets: [] };
    if (!Array.isArray(moment.onRight.triggerActionSets)) moment.onRight.triggerActionSets = [];
    return moment.onRight.triggerActionSets;
  }
  return null;
}
/** Return the Node[] where actions live for `at` (linear section, or a trigger set's actions). */
function resolveActionList(moment, at, ctx, op) {
  const section = at?.section;
  if (LINEAR_SECTIONS.has(section)) return ensureLinear(moment, section);
  const container = getSetContainer(moment, section);
  if (!container) { badAddr(ctx, op, `unknown section '${section}'.`); return null; }
  if (!inRange(container, at?.triggerSetIndex)) { badAddr(ctx, op, `triggerSetIndex ${at?.triggerSetIndex} out of range in ${section}.`); return null; }
  const set = container[at.triggerSetIndex];
  if (!Array.isArray(set.actions)) set.actions = [];
  return set.actions;
}
/** Return a mutable node reference for `at` (linear action, set trigger, or set action). */
function getNodeRef(moment, at, ctx, op) {
  const section = at?.section;
  if (LINEAR_SECTIONS.has(section)) {
    const list = ensureLinear(moment, section);
    if (!inRange(list, at?.nodeIndex)) { badAddr(ctx, op, `nodeIndex ${at?.nodeIndex} out of range in ${section}.`); return null; }
    return list[at.nodeIndex];
  }
  const container = getSetContainer(moment, section);
  if (!container) { badAddr(ctx, op, `unknown section '${section}'.`); return null; }
  if (!inRange(container, at?.triggerSetIndex)) { badAddr(ctx, op, `triggerSetIndex ${at?.triggerSetIndex} out of range in ${section}.`); return null; }
  const set = container[at.triggerSetIndex];
  if (at.nodeKind === "trigger") return set.trigger || (set.trigger = normalizeNode({}, 1));
  if (!Array.isArray(set.actions)) set.actions = [];
  if (!inRange(set.actions, at?.nodeIndex)) { badAddr(ctx, op, `nodeIndex ${at?.nodeIndex} out of range in ${section} set ${at.triggerSetIndex}.`); return null; }
  return set.actions[at.nodeIndex];
}

// ─── node builders (raw or emitter form) ─────────────────────────────────────

/** addAction nodes: emitter form (op.action = {action:"VoiceOver",...}) OR raw (op.node). */
function nodesForAdd(op, ctx) {
  if (op.action) return _emitAction(op.action, ctx);
  if (op.node) return [normalizeNode(op.node, 0)];
  ctx.missing.push({ kind: "BAD_OP", op: op.op, detail: "addAction needs `action` (emitter form) or `node` (raw)." });
  return [];
}
function buildTrigger(spec, ctx) {
  if (!spec) return normalizeNode({}, 1);
  if (spec.type) return _emitTrigger(spec, ctx); // emitter form { type:"Grab", ... }
  return normalizeNode(spec, 1);                 // raw node
}
function buildActionsList(specs, ctx) {
  const out = [];
  for (const s of specs || []) {
    if (s && s.action) out.push(..._emitAction(s, ctx));
    else out.push(normalizeNode(s, 0));
  }
  return out;
}
function applyNodeUpdate(node, op) {
  const s = op.set;
  if (s) {
    if (s.Name !== undefined) node.Name = s.Name;
    if (s.Option !== undefined) node.Option = s.Option;
    if (s.Query !== undefined) node.Query = s.Query;
    if (s.Data !== undefined) node.Data = (s.Data && typeof s.Data === "object") ? JSON.stringify(s.Data) : s.Data;
    if (s.Type !== undefined) node.Type = s.Type;
    if (s.ID !== undefined) node.ID = s.ID;
  }
  if (op.clearTarget) { node.Query = ""; return; }
  if (op.targetName !== undefined) {
    if (op.embedId && op.targetId != null) node.Query = `${op.targetName}#$${op.targetId}`;
    else { node.Query = op.targetName; if (op.targetId != null) node.ID = op.targetId; }
  }
}
function defaultsTarget(story, op, ctx, kind) {
  const scope = op.scope || "moment";
  if (scope === "story") return story;
  if (scope === "chapter") return resolveChapter(story, op, ctx, kind);
  return resolveMoment(story, op, ctx, kind);
}

// ─── the op dispatcher ───────────────────────────────────────────────────────

function applyOne(story, op, ctx) {
  const kind = op && op.op;
  const at = op && op.at;
  switch (kind) {
    case "addChapter":
      insertAt(story.chapters, emptyChapter(op.name), op.index); return;
    case "renameChapter": {
      const ch = resolveChapter(story, op, ctx, kind); if (!ch) return;
      ch.name = op.newName ?? ch.name; return;
    }
    case "removeChapter": {
      const i = resolveChapterIdx(story, chapterRefOf(op), ctx, kind); if (i < 0) return;
      story.chapters.splice(i, 1); return;
    }
    case "moveChapter":
      if (!moveInArray(story.chapters, op.fromIndex, op.toIndex)) return badAddr(ctx, kind, `fromIndex ${op.fromIndex} out of range.`);
      return;
    case "addMoment": {
      const ch = resolveChapter(story, op, ctx, kind); if (!ch) return;
      if (!Array.isArray(ch.moments)) ch.moments = [];
      insertAt(ch.moments, emptyMoment(op.name), op.index); return;
    }
    case "renameMoment": {
      const m = resolveMoment(story, op, ctx, kind); if (!m) return;
      m.name = op.newName ?? m.name; return;
    }
    case "removeMoment": {
      const ch = resolveChapter(story, op, ctx, kind); if (!ch) return;
      const mi = resolveMomentIdx(story, ch, momentRefOf(op), ctx, kind); if (mi < 0) return;
      ch.moments.splice(mi, 1); return;
    }
    case "moveMoment": {
      const ch = resolveChapter(story, op, ctx, kind); if (!ch) return;
      const destRef = op.toChapterIndex ?? op.toChapter;
      if (destRef != null && destRef !== chapterRefOf(op)) {
        const di = resolveChapterIdx(story, destRef, ctx, kind); if (di < 0) return;
        const dest = story.chapters[di];
        if (!inRange(ch.moments, op.fromIndex)) return badAddr(ctx, kind, `fromIndex ${op.fromIndex} out of range.`);
        const [m] = ch.moments.splice(op.fromIndex, 1);
        if (!Array.isArray(dest.moments)) dest.moments = [];
        insertAt(dest.moments, m, op.toIndex);
      } else if (!moveInArray(ch.moments, op.fromIndex, op.toIndex)) {
        return badAddr(ctx, kind, `fromIndex ${op.fromIndex} out of range.`);
      }
      return;
    }
    case "setMomentWeightage": {
      const m = resolveMoment(story, op, ctx, kind); if (!m) return;
      // weightage/wrongReduction live inside the moment.defaults JSON string (mirrors C#
      // ApplyMomentWeightage). Merge (non-destructive) instead of overwriting like the C# route.
      // NOTE: verify these exact key names against a real on-disk story on first run.
      const d = parseDefaults(m.defaults);
      if (op.weightage !== undefined) d.weightage = op.weightage;
      if (op.wrongReduction !== undefined) d.wrongReduction = op.wrongReduction;
      m.defaults = JSON.stringify(d); return;
    }
    case "setDefaults": {
      const target = defaultsTarget(story, op, ctx, kind); if (!target) return;
      if (op.value !== undefined) { target.defaults = (op.value && typeof op.value === "object") ? JSON.stringify(op.value) : String(op.value); return; }
      if (op.merge && typeof op.merge === "object") { const d = parseDefaults(target.defaults); Object.assign(d, op.merge); target.defaults = JSON.stringify(d); }
      return;
    }
    case "addTriggerSet": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const section = at?.section;
      if (section !== "onWrong" && section !== "onRight") return badAddr(ctx, kind, `addTriggerSet section must be onWrong|onRight (got '${section}').`);
      const container = getSetContainer(m, section);
      if (section === "onRight" && op.mode !== undefined) m.onRight.mode = op.mode;
      const set = { trigger: buildTrigger(op.trigger, ctx), actions: buildActionsList(op.actions, ctx) };
      insertAt(container, set, op.index); return;
    }
    case "removeTriggerSet": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const container = getSetContainer(m, at?.section);
      if (!container) return badAddr(ctx, kind, `section '${at?.section}' is not onWrong|onRight.`);
      if (!inRange(container, at?.triggerSetIndex)) return badAddr(ctx, kind, `triggerSetIndex ${at?.triggerSetIndex} out of range.`);
      container.splice(at.triggerSetIndex, 1); return;
    }
    case "moveTriggerSet": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const container = getSetContainer(m, at?.section);
      if (!container) return badAddr(ctx, kind, `section '${at?.section}' is not onWrong|onRight.`);
      if (!moveInArray(container, op.fromIndex, op.toIndex)) return badAddr(ctx, kind, `fromIndex ${op.fromIndex} out of range.`);
      return;
    }
    case "setOnRightMode": {
      const m = resolveMoment(story, op, ctx, kind); if (!m) return;
      if (!m.onRight || typeof m.onRight !== "object") m.onRight = { mode: "InOrder", triggerActionSets: [] };
      m.onRight.mode = op.mode; return;
    }
    case "addAction": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const list = resolveActionList(m, at, ctx, kind); if (!list) return;
      const nodes = nodesForAdd(op, ctx);
      if (op.index != null) { let idx = op.index; for (const n of nodes) insertAt(list, n, idx++); }
      else list.push(...nodes);
      return;
    }
    case "updateNode": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const node = getNodeRef(m, at, ctx, kind); if (!node) return;
      applyNodeUpdate(node, op); return;
    }
    case "removeAction": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const list = resolveActionList(m, at, ctx, kind); if (!list) return;
      if (!inRange(list, at?.nodeIndex)) return badAddr(ctx, kind, `nodeIndex ${at?.nodeIndex} out of range.`);
      list.splice(at.nodeIndex, 1); return;
    }
    case "removeNodeByName": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const list = resolveActionList(m, at, ctx, kind); if (!list) return;
      const nm = String(op.nodeName ?? "").toLowerCase();
      for (let i = list.length - 1; i >= 0; i--) if (String(list[i]?.Name ?? "").toLowerCase() === nm) list.splice(i, 1);
      return;
    }
    case "moveAction": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const list = resolveActionList(m, at, ctx, kind); if (!list) return;
      if (!moveInArray(list, op.fromIndex, op.toIndex)) return badAddr(ctx, kind, `fromIndex ${op.fromIndex} out of range.`);
      return;
    }
    case "duplicateAction": {
      const m = resolveMoment(story, at, ctx, kind); if (!m) return;
      const list = resolveActionList(m, at, ctx, kind); if (!list) return;
      if (!inRange(list, at?.nodeIndex)) return badAddr(ctx, kind, `nodeIndex ${at?.nodeIndex} out of range.`);
      list.splice(at.nodeIndex + 1, 0, structuredClone(list[at.nodeIndex])); return;
    }
    case "copyActionToMoments": {
      const from = op.from || {};
      const srcMoment = resolveMoment(story, from, ctx, kind); if (!srcMoment) return;
      const srcList = resolveActionList(srcMoment, from, ctx, kind); if (!srcList) return;
      if (!inRange(srcList, from.nodeIndex)) return badAddr(ctx, kind, `from.nodeIndex ${from.nodeIndex} out of range.`);
      const src = srcList[from.nodeIndex];
      for (const t of op.targets || []) {
        const tm = resolveMoment(story, t, ctx, kind); if (!tm) continue;
        const tAt = { section: t.section ?? from.section, triggerSetIndex: t.triggerSetIndex ?? from.triggerSetIndex };
        const list = resolveActionList(tm, tAt, ctx, kind); if (!list) continue;
        list.push(structuredClone(src));
      }
      return;
    }
    default:
      ctx.missing.push({ kind: "UNKNOWN_OP", op: kind, detail: `unknown op '${kind}'.` });
  }
}

/**
 * Apply an ordered batch of ops to a DEEP CLONE of `story`. The caller's object is never mutated.
 * All problems are aggregated into `missing[]` (nothing throws out); the caller must halt (not write)
 * when missing.length > 0. Ops apply in array order — later ops see earlier ops' results.
 * @returns {{ story, missing, warnings, stats }}
 */
export function applyOps(story, ops, { idMap = {}, duplicates = [] } = {}) {
  const clone = structuredClone(story);
  ensureChapters(clone);
  const ctx = { idMap: idMap || {}, missing: [], warnings: [], dupSet: new Set((duplicates || []).map((d) => d.name)) };
  let applied = 0;
  for (const op of ops || []) {
    const before = ctx.missing.length;
    try { applyOne(clone, op, ctx); }
    catch (e) { ctx.missing.push({ kind: "OP_ERROR", op: op && op.op, detail: e.message }); }
    if (ctx.missing.length === before) applied++;
  }
  reindex(clone);
  return { story: clone, missing: ctx.missing, warnings: ctx.warnings, stats: { ...countStats(clone), opsApplied: applied } };
}

/** True if any op uses an emitter form (action/trigger) that resolves ids from an idMap. */
export function opsNeedIds(ops) {
  for (const op of ops || []) {
    if (op?.action) return true;
    if (Array.isArray(op?.actions) && op.actions.some((a) => a && a.action)) return true;
    if (op?.trigger?.type) return true;
  }
  return false;
}

// ─── the flush→read source of truth ──────────────────────────────────────────

/**
 * Get the current full Story JSON via flush-then-read (Node-only, no plugin change):
 *   vrse/story-save (flush in-memory → disk) → resolve file path → readFileSync → JSON.parse.
 * Saving first respects the AGENTS.md pitfall "don't edit story JSON on disk while StoryCreator has
 * unsaved changes". Returns { ok, isNew, story, filePath } or { ok:false, missing:[…] }.
 */
export async function getCurrentStoryJson({ storyCreatorName, port } = {}) {
  let save;
  try { save = unwrap(await bridge.sendCommand("vrse/story-save", { storyCreatorName, port })); }
  catch (e) { return { ok: false, isNew: false, missing: [{ kind: "STORY_SAVE_FAILED", detail: `vrse/story-save failed: ${e.message}` }] }; }

  let filePath = save && (save.filePath || save.FilePath);
  if (!filePath) {
    try {
      const info = unwrap(await bridge.sendCommand("vrse/story-get-info", { storyCreatorName, port }));
      filePath = info && (info.filePath || info.fileName);
    } catch { /* fall through to NO_STORY_FILE */ }
  }
  if (!filePath) {
    return { ok: false, isNew: true, missing: [{ kind: "NO_STORY_FILE", detail: "No story file path — the StoryCreator has no saved story yet. Create one with vrse_story_apply (momentTable or storyJson) first." }] };
  }

  let abs = filePath;
  if (!isAbsolute(abs)) {
    const inst = getSelectedInstance();
    if (inst && inst.projectPath) abs = join(inst.projectPath, filePath);
  }
  try {
    const raw = readFileSync(abs, "utf-8");
    return { ok: true, isNew: false, story: JSON.parse(raw), filePath: abs, raw };
  } catch (e) {
    return { ok: false, isNew: false, filePath: abs, missing: [{ kind: "STORY_READ_FAILED", detail: `Could not read/parse story file '${abs}': ${e.message}` }] };
  }
}

// ─── write (apply-json/apply-file by size, then save) ────────────────────────

/**
 * Apply a full Story object to the scene and save it. Mirrors GENERATE_STORY_TOOL's apply/save tail:
 * >24000-char stories go via a temp file + vrse/story-apply-file (avoids the ~74KB inline field limit).
 * @returns {{ ok, via, applied?, saved?, missing? }}
 */
export async function writeStory(story, { applyVia = "auto", storyCreatorName, port } = {}) {
  const storyJson = JSON.stringify(story);
  const via = (applyVia && applyVia !== "auto") ? applyVia : (storyJson.length > 24000 ? "file" : "inline");
  let applyResp;
  if (via === "file") {
    const tmpPath = join(tmpdir(), `vrse_story_${String(story?.name || "module").replace(/[^\w.-]+/g, "_")}.json`);
    try { writeFileSync(tmpPath, storyJson, "utf-8"); }
    catch (e) { return { ok: false, via, missing: [{ kind: "APPLY_WRITE_FAILED", detail: `Could not write temp story file '${tmpPath}': ${e.message}` }] }; }
    applyResp = unwrap(await bridge.sendCommand("vrse/story-apply-file", { path: tmpPath, storyCreatorName, port }));
  } else {
    applyResp = unwrap(await bridge.sendCommand("vrse/story-apply-json", { json: storyJson, storyCreatorName, port }));
  }
  if (!applyResp || applyResp.error || applyResp.success === false) {
    return { ok: false, via, missing: [{ kind: "APPLY_FAILED", detail: (applyResp && applyResp.error) || `vrse/story-apply-${via === "file" ? "file" : "json"} failed` }] };
  }
  const save = unwrap(await bridge.sendCommand("vrse/story-save", { storyCreatorName, port }));
  return {
    ok: true,
    via,
    applied: { storyCreator: applyResp.storyCreator, chapterCount: applyResp.chapterCount },
    saved: { isSavedToFile: save && (save.isSavedToFile ?? save.success), filePath: save && save.filePath, ...(save && save.error ? { error: save.error } : {}) },
  };
}

// ─── validation (offline, halt-before-apply) ─────────────────────────────────

/**
 * Structural sanity of a full Story object (reuses the byte-parity test invariants):
 * every node.Data is a JSON-parseable string, Type ∈ {0,1}, name present, chapters/onWrong/onRight arrays.
 * node.Name outside `templateNames` (from vrse/story-list-node-templates) is a WARNING, not a halt —
 * real stories legitimately use node types beyond the emitter subset.
 * @returns {{ missing, warnings }}
 */
export function validateStoryJson(story, { templateNames } = {}) {
  const missing = [], warnings = [];
  if (!story || typeof story !== "object") { missing.push({ kind: "BAD_STORY", detail: "story is not an object." }); return { missing, warnings }; }
  if (!story.name) missing.push({ kind: "NO_STORY_NAME", detail: "story.name is required." });
  if (!Array.isArray(story.chapters)) { missing.push({ kind: "NO_CHAPTERS", detail: "story.chapters must be an array." }); return { missing, warnings }; }
  const names = templateNames ? new Set(templateNames) : null;

  const checkNode = (n, where) => {
    if (!n || typeof n !== "object") { missing.push({ kind: "BAD_NODE", detail: `${where}: node is not an object.` }); return; }
    if (typeof n.Data !== "string") missing.push({ kind: "DATA_NOT_STRING", detail: `${where}: node.Data must be a string (got ${typeof n.Data}).` });
    else if (n.Data) { try { JSON.parse(n.Data); } catch { missing.push({ kind: "DATA_NOT_JSON", detail: `${where}: node.Data ('${String(n.Data).slice(0, 40)}…') is not JSON-parseable.` }); } }
    if (n.Type !== 0 && n.Type !== 1) missing.push({ kind: "BAD_TYPE", detail: `${where}: node.Type must be 0 or 1 (got ${n.Type}).` });
    if (names && n.Name && !names.has(n.Name)) warnings.push({ kind: "UNKNOWN_NODE_NAME", detail: `${where}: node.Name '${n.Name}' is not in the template catalog (custom/unsupported node?).` });
  };

  const arr = (x) => (Array.isArray(x) ? x : []); // tolerate malformed shapes — report, don't throw
  story.chapters.forEach((ch, ci) => {
    arr(ch.moments).forEach((m, mi) => {
      const w = `ch${ci}/m${mi}`;
      for (const sec of LINEAR_SECTIONS) arr(m[sec]?.actions).forEach((n) => checkNode(n, `${w}/${sec}`));
      if (m.onRight && !Array.isArray(m.onRight.triggerActionSets)) missing.push({ kind: "BAD_ONRIGHT", detail: `${w}: onRight.triggerActionSets must be an array.` });
      arr(m.onRight?.triggerActionSets).forEach((s, si) => { checkNode(s.trigger, `${w}/onRight[${si}].trigger`); arr(s.actions).forEach((n) => checkNode(n, `${w}/onRight[${si}].action`)); });
      if (m.onWrong && !Array.isArray(m.onWrong)) missing.push({ kind: "BAD_ONWRONG", detail: `${w}: onWrong must be a bare array of sets.` });
      arr(m.onWrong).forEach((s, si) => { checkNode(s.trigger, `${w}/onWrong[${si}].trigger`); arr(s.actions).forEach((n) => checkNode(n, `${w}/onWrong[${si}].action`)); });
    });
  });
  return { missing, warnings };
}
