// VRse consolidated story tools — inspect / edit / apply.
//
// These 3 tools replace the 29 granular unity_vrse_story_* tools (now hidden behind the
// vrse_story_tool dispatcher). They make "story editing = JSON editing": every write goes through
// the Node-only read-modify-write engine in vrse-story-edit-lib.js and the emitter model shared with
// vrse_generate_story, so authoring/editing/generation speak one vocabulary and one apply/save tail.
//
// All 3 return the shared stage envelope { ok, halt, produced?, warnings?, missing[], next, stats }
// (missing[] aggregates every problem; halt:true ⇒ nothing was applied to the scene). Each declares
// `port` explicitly (vrse_* tools don't get the unity_* auto port-injection) and is independently
// usable — no required call order (edit's only precondition is an already-saved story).

import * as bridge from "../unity-editor-bridge.js";
import { unwrap, buildHarvestReport, buildStoryReport, GENERATE_STORY_TOOL } from "./vrse-stage-tools.js";
import {
  getCurrentStoryJson, applyOps, writeStory, validateStoryJson,
  opsNeedIds, deepMerge, ensureChapters, reindex, findChapter, countStats, labelOf,
} from "./vrse-story-edit-lib.js";

const env = (obj) => JSON.stringify(obj, null, 2);

// ─── vrse_story_inspect ──────────────────────────────────────────────────────

const INSPECT_TOOL = {
  name: "vrse_story_inspect",
  description:
    "Read/discovery for the active StoryCreator (read-only). One `what` facet: 'story' (chapters/moments/" +
    "sections/nodes, filterable by chapter/moment/section), 'info' (high-level + on-disk filePath), " +
    "'defaults' (global interaction/UI/warning defaults), 'nodeTypes' (action/trigger templates WITH their " +
    "Data-payload schemas — Options→Parameters/NestedParameters; use this to author a node's Data string " +
    "correctly), 'objects' (queryable scene objects + GameObjectQuery ids for target binding), 'vo' (pending " +
    "VoiceOver status), 'report' (validation report). Returns the stage envelope with the result under " +
    "produced.result. Replaces story_read / get_story_info / defaults_get / list+search_node_templates / " +
    "query_objects_list / has_pending_vo / report.",
  inputSchema: {
    type: "object",
    properties: {
      what: { type: "string", enum: ["story", "info", "defaults", "nodeTypes", "objects", "vo", "report"], description: "Facet to read (default 'info')." },
      query: { type: "string", description: "nodeTypes: fuzzy-search templates by keyword." },
      nodeType: { type: "string", description: "nodeTypes: look up a single template by name." },
      maxResults: { type: "number", description: "nodeTypes search cap (default 20)." },
      chapterIndex: { type: "number", description: "story: restrict to one chapter." },
      momentIndex: { type: "number", description: "story: restrict to one moment (needs chapterIndex)." },
      section: { type: "string", description: "story: restrict to one section (onAwake/onStart/onFirstWarning/onLastWarning/onEnd/onWrong/onRight)." },
      maxNodes: { type: "number", description: "story: max nodes to return (default 500)." },
      storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name (if multiple exist)." },
      port: { type: "number", description: "Target Unity instance port (omit to use the selected instance)." },
    },
    required: [],
  },
  handler: async (a = {}) => {
    const { what = "info", storyCreatorName, port } = a;
    const base = { storyCreatorName, port };
    let route, params = base, hint = "";
    switch (what) {
      case "story":
        route = "vrse/story-read";
        params = { ...base, chapterIndex: a.chapterIndex, momentIndex: a.momentIndex, section: a.section, maxNodes: a.maxNodes };
        hint = "Use these chapter/moment/section/node indices to address vrse_story_edit ops.";
        break;
      case "info": route = "vrse/story-get-info"; hint = "filePath is the on-disk Story JSON that vrse_story_edit reads/writes."; break;
      case "defaults": route = "vrse/story-defaults-get"; break;
      case "nodeTypes": {
        const q = a.query || a.nodeType;
        route = q ? "vrse/story-search-node-templates" : "vrse/story-list-node-templates";
        params = { ...base, query: q, maxResults: a.maxResults };
        hint = "Use each template's Options→Parameters/NestedParameters to build a node's Data payload string.";
        break;
      }
      case "objects": route = "vrse/query-objects-list"; hint = "Use these ids for updateNode { targetId } or as an idMap."; break;
      case "vo": route = "vrse/story-has-pending-vo"; break;
      case "report": route = "vrse/story/report"; break;
      default:
        return env({ ok: false, halt: true, missing: [{ kind: "BAD_FACET", detail: `unknown what:'${what}' (use story|info|defaults|nodeTypes|objects|vo|report).` }], next: "Pick a valid `what` facet.", stats: {} });
    }
    try {
      const res = unwrap(await bridge.sendCommand(route, params));
      return env({ ok: true, halt: false, produced: { what, result: res }, missing: [], next: hint, stats: {} });
    } catch (e) {
      return env({ ok: false, halt: true, error: e.message, next: "Ensure a Unity Editor with a StoryCreator in the scene is running." });
    }
  },
};

// ─── vrse_story_edit ─────────────────────────────────────────────────────────

const EDIT_TOOL = {
  name: "vrse_story_edit",
  description:
    "Batched structural + node editor for the active story, applied in ONE call via read-modify-write: " +
    "flush→read the Story JSON, apply ops[] to an in-memory clone, VALIDATE and HALT before any scene " +
    "mutation if anything is wrong, then apply (apply-json/apply-file by size) and auto-save. Covers the " +
    "granular tools AND the raw-edit gaps (reorder chapters/moments, remove a trigger set, change onRight " +
    "mode, set Node.ID / bind target by id, edit defaults non-destructively). Ops: addChapter, renameChapter, " +
    "removeChapter, moveChapter, addMoment, renameMoment, removeMoment, moveMoment, setMomentWeightage, " +
    "setDefaults, addTriggerSet, removeTriggerSet, moveTriggerSet, setOnRightMode, addAction, updateNode, " +
    "removeAction, removeNodeByName, moveAction, duplicateAction, copyActionToMoments. Precondition: an " +
    "already-saved story (else halts NEED_SAVED_STORY — use vrse_story_apply to create one). Use " +
    "vrse_story_inspect first (what:'story' for indices, what:'objects' for ids, what:'nodeTypes' for Data schemas).",
  inputSchema: {
    type: "object",
    properties: {
      ops: {
        type: "array",
        items: { type: "object" },
        description:
          "Ordered edit operations, each { op, ... }. Address chapters/moments by index (chapterIndex/" +
          "momentIndex) OR by NAME (chapter/moment) — name lookups fail loud on miss/ambiguity. " +
          "Node-addressing ops take at:{chapterIndex|chapter,momentIndex|moment," +
          "section,triggerSetIndex?,nodeKind?,nodeIndex?} (triggerSetIndex for onWrong/onRight; nodeKind " +
          "'trigger'|'action'). Nodes accept raw {Name,ID,Query,Option,Data,Type} (as op.node) OR emitter " +
          "form (op.action={action:'VoiceOver',text:'…'} / op.trigger={type:'Grab',target:'X'}). Indices " +
          "refer to state AFTER prior ops in the batch.",
      },
      idMap: { type: "object", description: "Optional name→GameObjectQuery-id map for emitter-form ops (Teleport/Timer/SFX/Place/etc). Omit to self-harvest." },
      autoHarvest: { type: "boolean", description: "Harvest idMap when omitted and an op needs ids (default true)." },
      validate: { type: "boolean", description: "Run vrse/story-validate after applying and fold into the report (default false)." },
      vo: { type: "boolean", description: "Generate VoiceOver audio after applying (default false)." },
      applyVia: { type: "string", enum: ["auto", "inline", "file"], description: "Override the apply size-heuristic (default auto)." },
      dryRun: { type: "boolean", description: "Apply ops + validate and return the mutated JSON WITHOUT touching the scene." },
      returnStory: { type: "boolean", description: "Include the full mutated story in `produced` (default false — the response is compact: per-op `changes` + `stats` + `saved`). dryRun always returns the full proposed story." },
      storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name." },
      port: { type: "number", description: "Target Unity instance port." },
    },
    required: ["ops"],
  },
  handler: async (a = {}) => {
    const { ops, idMap, autoHarvest = true, validate = false, vo = false, applyVia = "auto", dryRun = false, storyCreatorName, port } = a;
    if (!Array.isArray(ops) || ops.length === 0) {
      return env({ ok: false, halt: true, missing: [{ kind: "NO_OPS", detail: "Provide a non-empty ops[] array." }], next: "Pass ops[] (see the vrse_story_edit op catalog).", stats: {} });
    }
    try {
      const cur = await getCurrentStoryJson({ storyCreatorName, port });
      if (!cur.ok) {
        const next = cur.isNew
          ? "This StoryCreator has no saved story yet — create one with vrse_story_apply (momentTable or storyJson), then edit."
          : "Fix story-file access (is a StoryCreator loaded?), then retry.";
        return env({ ok: false, halt: true, missing: cur.missing, next, stats: {} });
      }

      let map = idMap;
      if (!map && autoHarvest && opsNeedIds(ops)) {
        const hr = buildHarvestReport(unwrap(await bridge.sendCommand("vrse/harvest-ids", { root: "", save: false })));
        if (hr.halt) return env({ ok: false, halt: true, missing: hr.missing, next: "Harvest failed before edit — " + hr.next, stats: {} });
        map = hr.produced.idMap;
      }

      const res = applyOps(cur.story, ops, { idMap: map || {} });
      const v = validateStoryJson(res.story);
      const missing = [...res.missing, ...v.missing];
      const warnings = [...(res.warnings || []), ...(v.warnings || [])];
      const wantStory = a.returnStory === true;
      // Compact "what changed" — the model already sent the ops, so a per-op landing label + stats
      // confirms the edit without echoing the whole story back into context.
      const changes = ops.map((op) => ({ op: op.op, at: labelOf(op.at || op) || undefined }));

      if (missing.length) {
        return env({ ok: false, halt: true, ...(wantStory ? { produced: { story: res.story } } : {}), ...(warnings.length ? { warnings } : {}), missing, next: "Fix the op problems (NO scene mutation happened), then retry.", stats: res.stats });
      }
      if (dryRun) {
        return env({ ok: true, halt: false, produced: { story: res.story, storyJson: JSON.stringify(res.story) }, changes, ...(warnings.length ? { warnings } : {}), missing: [], next: "dryRun — nothing applied. Re-run without dryRun to apply.", stats: res.stats });
      }

      const w = await writeStory(res.story, { applyVia, storyCreatorName, port });
      if (!w.ok) return env({ ok: false, halt: true, ...(wantStory ? { produced: { story: res.story } } : {}), missing: w.missing, next: "Apply failed — ensure a StoryCreator exists and the plugin is recompiled, then retry.", stats: res.stats });

      const out = {
        ok: true, halt: false,
        changes,
        ...(wantStory ? { produced: { story: res.story, storyJson: JSON.stringify(res.story) } } : {}),
        ...(warnings.length ? { warnings } : {}),
        missing: [], applied: w.applied, saved: w.saved, stats: res.stats,
        next: `Applied ${res.stats.opsApplied} op(s) and saved.` + (wantStory ? "" : " Pass returnStory:true for the full story."),
      };
      if (validate) out.validation = unwrap(await bridge.sendCommand("vrse/story-validate", { storyCreatorName, port }));
      if (vo) {
        const pend = unwrap(await bridge.sendCommand("vrse/story-has-pending-vo", { storyCreatorName, port }));
        out.vo = (pend && (pend.hasPending === false || pend.hasPendingVOs === false))
          ? { hasPending: false }
          : unwrap(await bridge.sendCommand("vrse/story-generate-vo", { storyCreatorName, port }));
      }
      return env(out);
    } catch (e) {
      return env({ ok: false, halt: true, error: e.message, next: "Ensure Unity is running with a StoryCreator, then retry vrse_story_edit." });
    }
  },
};

// ─── vrse_story_apply ────────────────────────────────────────────────────────

const APPLY_TOOL = {
  name: "vrse_story_apply",
  description:
    "The single generate/write door for the active story. Input mode is auto-detected (or forced via " +
    "`action`): momentTable ⇒ GENERATE the Story JSON via the emitter tables (mode:'new' replaces the whole " +
    "story; mode:'merge' splices generated chapters/moments into the existing one); storyJson ⇒ APPLY a raw " +
    "full Story JSON as-is; patch ⇒ deep-merge a partial into the current story; action:'undo' ⇒ revert the " +
    "last apply/patch. All paths VALIDATE before apply and AUTO-SAVE. Provide exactly one of " +
    "momentTable/storyJson/patch (unless undo). Replaces vrse_generate_story's authoring role + " +
    "vrse_apply_story_json + vrse_patch_story + vrse_undo_story_write.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "apply", "patch", "undo"], description: "Force the input mode; auto-detected from momentTable/storyJson/patch when omitted." },
      momentTable: { type: "object", description: "generate: build_moments-shaped spec { module, defaults?, chapters:[{ name, chapterIndex?, moments:[{ name, momentIndex, onAwake?, onStart?, onRight?:{mode,sets}, onWrong?, onFirstWarning?, onLastWarning?, onEnd? }] }] }." },
      mode: { type: "string", enum: ["new", "merge"], description: "generate only: 'new' replaces the whole story (default); 'merge' splices into the existing story." },
      at: { type: "number", description: "generate+merge: chapter index to insert generated chapters at (default: append)." },
      mergeIntoChapter: { description: "generate+merge: existing chapter name or index — splice generated MOMENTS into it instead of adding chapters." },
      storyJson: { type: "string", description: "apply: the full raw Story JSON string." },
      patch: { type: "object", description: "patch: partial story data to deep-merge (touched arrays are replaced wholesale)." },
      idMap: { type: "object", description: "generate: optional name→id map (omit to self-harvest)." },
      autoHarvest: { type: "boolean", description: "generate: harvest idMap when omitted (default true)." },
      queryObjectsParent: { type: "string", description: "generate: harvest scope (default '' = all loaded scenes, so system objects resolve)." },
      validateOnly: { type: "boolean", description: "apply/patch: validate and report without applying." },
      dryRun: { type: "boolean", description: "generate: build + validate without applying to the scene." },
      save: { type: "boolean", description: "generate+new: save after applying (default true)." },
      validate: { type: "boolean", description: "generate: run vrse/story-validate after applying." },
      vo: { type: "boolean", description: "generate: generate VoiceOver audio after applying." },
      applyVia: { type: "string", enum: ["auto", "inline", "file"], description: "Apply mechanism override (default auto)." },
      returnStory: { type: "boolean", description: "Include the full story in `produced` for merge/patch (default false — compact response). generate mode:'new' and dryRun return it regardless." },
      storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name." },
      port: { type: "number", description: "Target Unity instance port." },
    },
    required: [],
  },
  handler: async (a = {}) => {
    const { momentTable, storyJson, patch, storyCreatorName, port } = a;
    const wantStory = a.returnStory === true;
    let action = a.action;
    if (!action) {
      if (momentTable != null) action = "generate";
      else if (storyJson != null) action = "apply";
      else if (patch != null) action = "patch";
    }

    if (action === "undo") {
      try {
        const res = unwrap(await bridge.sendCommand("vrse/story-undo-write", { storyCreatorName, port }));
        const ok = !!(res && (res.success ?? !res.error));
        return env({ ok, halt: !ok, produced: { result: res }, missing: ok ? [] : [{ kind: "UNDO_FAILED", detail: (res && res.error) || "undo failed — there may be no prior apply/patch backup." }], next: ok ? "Reverted the last apply/patch." : "Undo failed — there may be no prior apply/patch backup.", stats: {} });
      } catch (e) {
        return env({ ok: false, halt: true, error: e.message, next: "Ensure Unity is running with a StoryCreator, then retry." });
      }
    }

    if (!action) return env({ ok: false, halt: true, missing: [{ kind: "NO_INPUT", detail: "Provide one of momentTable / storyJson / patch, or action:'undo'." }], next: "Pass a momentTable (spec), storyJson (raw), patch (partial), or action:'undo'.", stats: {} });
    const provided = [momentTable != null, storyJson != null, patch != null].filter(Boolean).length;
    if (provided !== 1) return env({ ok: false, halt: true, missing: [{ kind: "AMBIGUOUS_INPUT", detail: `Provide exactly one of momentTable / storyJson / patch (got ${provided}).` }], next: "Pass exactly one input mode.", stats: {} });

    try {
      if (action === "generate") {
        const mode = a.mode || "new";
        if (mode === "new") {
          // Delegate to the existing spec→JSON→apply→save engine (returns a JSON string envelope).
          return await GENERATE_STORY_TOOL.handler({
            momentTable, idMap: a.idMap, autoHarvest: a.autoHarvest, queryObjectsParent: a.queryObjectsParent,
            dryRun: a.dryRun, save: a.save, validate: a.validate, vo: a.vo, applyVia: a.applyVia, storyCreatorName, port,
          });
        }
        // merge: build the sub-story, splice into the current story, apply+save.
        let map = a.idMap, duplicates = [];
        if (!map && (a.autoHarvest ?? true)) {
          const hr = buildHarvestReport(unwrap(await bridge.sendCommand("vrse/harvest-ids", { root: a.queryObjectsParent ?? "", save: false })));
          if (hr.halt) return env({ ok: false, halt: true, missing: hr.missing, next: "Harvest failed before merge — " + hr.next, stats: {} });
          map = hr.produced.idMap; duplicates = hr.duplicates || [];
        }
        const rep = buildStoryReport(momentTable, map || {}, { duplicates });
        if (rep.halt) return env({ ...rep, next: "Fix the momentTable issues in `missing`, then retry." });

        const cur = await getCurrentStoryJson({ storyCreatorName, port });
        if (!cur.ok) return env({ ok: false, halt: true, missing: cur.missing, next: cur.isNew ? "No existing story to merge into — use mode:'new' to create one." : "Fix story-file access, then retry.", stats: {} });

        const story = cur.story;
        ensureChapters(story);
        const genChapters = rep.produced.story.chapters || [];
        if (a.mergeIntoChapter != null) {
          const target = findChapter(story, a.mergeIntoChapter);
          if (!target) return env({ ok: false, halt: true, missing: [{ kind: "NO_TARGET_CHAPTER", detail: `mergeIntoChapter '${a.mergeIntoChapter}' not found.` }], next: "Use an existing chapter name/index, or omit mergeIntoChapter to add new chapters.", stats: {} });
          if (!Array.isArray(target.moments)) target.moments = [];
          for (const gc of genChapters) target.moments.push(...(gc.moments || []));
        } else {
          let idx = (typeof a.at === "number") ? a.at : story.chapters.length;
          for (const gc of genChapters) { story.chapters.splice(idx, 0, gc); idx++; }
        }
        reindex(story);

        const v = validateStoryJson(story);
        if (v.missing.length) return env({ ok: false, halt: true, ...(wantStory ? { produced: { story } } : {}), missing: v.missing, next: "Merged story failed validation — fix and retry.", stats: countStats(story) });
        if (a.dryRun) return env({ ok: true, halt: false, produced: { story, storyJson: JSON.stringify(story) }, missing: [], next: "dryRun — nothing applied.", stats: countStats(story) });

        const w = await writeStory(story, { applyVia: a.applyVia, storyCreatorName, port });
        if (!w.ok) return env({ ok: false, halt: true, ...(wantStory ? { produced: { story } } : {}), missing: w.missing, next: "Apply failed — ensure a StoryCreator exists and the plugin is recompiled.", stats: countStats(story) });
        return env({ ok: true, halt: false, ...(wantStory ? { produced: { story, storyJson: JSON.stringify(story) } } : {}), missing: [], applied: w.applied, saved: w.saved, next: "Merged and saved." + (wantStory ? "" : " Pass returnStory:true for the full story."), stats: countStats(story) });
      }

      if (action === "apply") {
        let story;
        try { story = (typeof storyJson === "string") ? JSON.parse(storyJson) : storyJson; }
        catch (e) { return env({ ok: false, halt: true, missing: [{ kind: "BAD_JSON", detail: `storyJson is not valid JSON: ${e.message}` }], next: "Provide a valid full Story JSON string.", stats: {} }); }
        const v = validateStoryJson(story);
        if (v.missing.length) return env({ ok: false, halt: true, ...(v.warnings.length ? { warnings: v.warnings } : {}), missing: v.missing, next: "Validation failed BEFORE apply — fix the Story JSON (Data must be JSON strings, Type 0|1), then retry.", stats: countStats(story) });
        if (a.validateOnly) return env({ ok: true, halt: false, ...(v.warnings.length ? { warnings: v.warnings } : {}), missing: [], next: "validateOnly — Story JSON is valid; not applied.", stats: countStats(story) });
        const w = await writeStory(story, { applyVia: a.applyVia, storyCreatorName, port });
        if (!w.ok) return env({ ok: false, halt: true, missing: w.missing, next: "Apply failed — ensure a StoryCreator exists and the plugin is recompiled.", stats: countStats(story) });
        return env({ ok: true, halt: false, ...(v.warnings.length ? { warnings: v.warnings } : {}), missing: [], applied: w.applied, saved: w.saved, next: "Applied and saved.", stats: countStats(story) });
      }

      if (action === "patch") {
        const cur = await getCurrentStoryJson({ storyCreatorName, port });
        if (!cur.ok) return env({ ok: false, halt: true, missing: cur.missing, next: cur.isNew ? "No existing story to patch — use momentTable or storyJson to create one." : "Fix story-file access, then retry.", stats: {} });
        const merged = deepMerge(cur.story, patch);
        const v = validateStoryJson(merged);
        if (v.missing.length) return env({ ok: false, halt: true, ...(wantStory ? { produced: { story: merged } } : {}), missing: v.missing, next: "Patched story failed validation — fix the patch, then retry.", stats: countStats(merged) });
        if (a.validateOnly) return env({ ok: true, halt: false, ...(wantStory ? { produced: { story: merged } } : {}), missing: [], next: "validateOnly — patch is valid; not applied.", stats: countStats(merged) });
        const w = await writeStory(merged, { applyVia: a.applyVia, storyCreatorName, port });
        if (!w.ok) return env({ ok: false, halt: true, ...(wantStory ? { produced: { story: merged } } : {}), missing: w.missing, next: "Apply failed — ensure a StoryCreator exists and the plugin is recompiled.", stats: countStats(merged) });
        return env({ ok: true, halt: false, ...(wantStory ? { produced: { story: merged } } : {}), missing: [], applied: w.applied, saved: w.saved, next: "Patched and saved.", stats: countStats(merged) });
      }

      return env({ ok: false, halt: true, missing: [{ kind: "BAD_ACTION", detail: `unknown action '${action}'.` }], next: "Use generate|apply|patch|undo.", stats: {} });
    } catch (e) {
      return env({ ok: false, halt: true, error: e.message, next: "Ensure Unity is running with a StoryCreator, then retry vrse_story_apply." });
    }
  },
};

export const vrseStoryConsolidatedTools = [INSPECT_TOOL, EDIT_TOOL, APPLY_TOOL];
