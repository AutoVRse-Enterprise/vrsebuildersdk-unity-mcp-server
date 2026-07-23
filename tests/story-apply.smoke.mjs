// Smoke test for vrse_story_apply's pure logic: validateStoryJson, deepMerge, merge-splice/reindex,
// and the input-mode detection guards (which return BEFORE any bridge I/O). Offline: no Unity.
import { validateStoryJson, deepMerge, reindex, ensureChapters } from "../src/tools/vrse-story-edit-lib.js";
import { buildStoryReport } from "../src/tools/vrse-stage-tools.js";
import { vrseStoryConsolidatedTools } from "../src/tools/vrse-story-tools.js";

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };
const applyTool = vrseStoryConsolidatedTools.find((t) => t.name === "vrse_story_apply");
assert(applyTool, "vrse_story_apply present");

// A known-good story straight from the generator.
const goodStory = buildStoryReport({
  module: "Mod",
  chapters: [{ name: "C0", moments: [{ name: "M0", momentIndex: 0, onStart: [{ action: "VoiceOver", text: "hi" }] }] }],
}).produced.story;

// 1) validateStoryJson passes a generator-shaped story.
{
  const { missing } = validateStoryJson(goodStory);
  assert(missing.length === 0, "validate: good story passes");
}

// 2) validateStoryJson flags object Data / missing name / bad Type / non-array onWrong.
{
  const bad = structuredClone(goodStory);
  bad.chapters[0].moments[0].onStart.actions[0].Data = { text: "oops" }; // object, not string
  assert(validateStoryJson(bad).missing.some((x) => x.kind === "DATA_NOT_STRING"), "validate: object Data flagged");

  const noName = structuredClone(goodStory); delete noName.name;
  assert(validateStoryJson(noName).missing.some((x) => x.kind === "NO_STORY_NAME"), "validate: missing name flagged");

  const badType = structuredClone(goodStory); badType.chapters[0].moments[0].onStart.actions[0].Type = 9;
  assert(validateStoryJson(badType).missing.some((x) => x.kind === "BAD_TYPE"), "validate: bad Type flagged");

  const badWrong = structuredClone(goodStory); badWrong.chapters[0].moments[0].onWrong = { nope: true };
  assert(validateStoryJson(badWrong).missing.some((x) => x.kind === "BAD_ONWRONG"), "validate: non-array onWrong flagged");

  const badJson = structuredClone(goodStory); badJson.chapters[0].moments[0].onStart.actions[0].Data = "{not json";
  assert(validateStoryJson(badJson).missing.some((x) => x.kind === "DATA_NOT_JSON"), "validate: non-parseable Data flagged");
}

// 3) node.Name outside the template catalog is a WARNING, not a halt.
{
  const { missing, warnings } = validateStoryJson(goodStory, { templateNames: ["SomethingElse"] });
  assert(missing.length === 0, "validate: unknown Name is not a halt");
  assert(warnings.some((w) => w.kind === "UNKNOWN_NODE_NAME"), "validate: unknown Name -> warning");
}

// 4) deepMerge: object-merge + array replace.
{
  const merged = deepMerge({ name: "A", chapters: [1, 2, 3], meta: { x: 1, y: 2 } }, { name: "B", chapters: [9], meta: { y: 20 } });
  assert(merged.name === "B", "deepMerge: scalar overwrite");
  assert(JSON.stringify(merged.chapters) === "[9]", "deepMerge: array replaced (not concatenated)");
  assert(merged.meta.x === 1 && merged.meta.y === 20, "deepMerge: nested object merged");
}

// 5) merge-splice: generated chapter appended to an existing story + reindex.
{
  const existing = { name: "Mod", formatVersion: 2.0, defaults: "", chapters: [{ name: "Old", chapterIndex: 0, studio: { id: "" }, defaults: "", moments: [] }] };
  ensureChapters(existing);
  const gen = buildStoryReport({ module: "Mod", chapters: [{ name: "Added", moments: [{ name: "m", momentIndex: 0 }] }] }).produced.story;
  for (const gc of gen.chapters) existing.chapters.push(gc);
  reindex(existing);
  assert(existing.chapters.length === 2 && existing.chapters[1].name === "Added", "merge-splice: chapter appended");
  assert(existing.chapters.every((c, i) => c.chapterIndex === i), "merge-splice: chapterIndex renumbered");
}

// 6) input-mode detection guards (these return before any bridge call).
{
  const noInput = JSON.parse(await applyTool.handler({}));
  assert(noInput.halt && noInput.missing[0].kind === "NO_INPUT", "apply: no input -> NO_INPUT");

  const ambiguous = JSON.parse(await applyTool.handler({ momentTable: { module: "x", chapters: [] }, storyJson: "{}" }));
  assert(ambiguous.halt && ambiguous.missing[0].kind === "AMBIGUOUS_INPUT", "apply: two inputs -> AMBIGUOUS_INPUT");

  const badJson = JSON.parse(await applyTool.handler({ action: "apply", storyJson: "{not json" }));
  assert(badJson.halt && badJson.missing[0].kind === "BAD_JSON", "apply: bad storyJson -> BAD_JSON (no bridge)");

  const invalid = JSON.parse(await applyTool.handler({ action: "apply", storyJson: JSON.stringify({ chapters: [] }) }));
  assert(invalid.halt && invalid.missing.some((x) => x.kind === "NO_STORY_NAME"), "apply: validate-before-apply halts on invalid JSON");
}

console.log("story-apply.smoke: PASS");
