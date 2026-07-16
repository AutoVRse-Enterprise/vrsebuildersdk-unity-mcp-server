// Smoke test for the consolidated story tools' pure logic (applyOps) + dispatcher registration.
// Offline: no Unity. Verifies the 21 ops mutate the Story graph correctly, preserve load-bearing
// casing / bare onWrong array / string Data / unknown keys, never mutate the caller on error, and
// that emitter-form addAction is byte-identical to buildStoryReport.
import { applyOps, reindex, findChapter, labelOf } from "../src/tools/vrse-story-edit-lib.js";
import { buildStoryReport, vrseStageTools } from "../src/tools/vrse-stage-tools.js";
import { vrseStoryConsolidatedTools } from "../src/tools/vrse-story-tools.js";
import { splitToolTiers } from "../src/tool-tiers.js";
import { vrseStoryOrchestrationTools } from "../src/tools/vrse-story-orchestration-tools.js";

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };
const node = (Name, Query, Option, Data, Type = 0) => ({ Name, ID: -1, Query, Option, Data, Type });

function baseStory() {
  const emptyM = (name, i) => ({
    name, momentIndex: i, studio: { id: "" }, defaults: "",
    onAwake: { actions: [] }, onStart: { actions: [] },
    onRight: { mode: "InOrder", triggerActionSets: [] }, onWrong: [],
    onFirstWarning: { actions: [] }, onLastWarning: { actions: [] }, onEnd: { actions: [] },
  });
  const m0 = emptyM("M0", 0);
  m0.defaults = '{"weightage":1,"foo":9}';
  m0.onStart.actions = [node("VoiceOver", "", "Play", '{"text":"hi"}', 0)];
  m0.onRight.triggerActionSets = [{ trigger: node("GrabbableTrigger", "Key", "Grab", "{}", 1), actions: [] }];
  m0.onWrong = [{ trigger: node("HandTouchTrigger", "Btn", "Touch", "{}", 1), actions: [node("ToastMessage", "", "Show", '{"message":"no"}', 0)] }];
  return {
    name: "Mod", formatVersion: 2.0, defaults: "",
    chapters: [
      { name: "C0", chapterIndex: 0, studio: { id: "" }, defaults: "", moments: [m0, emptyM("M1", 1)] },
      { name: "C1", chapterIndex: 1, studio: { id: "" }, defaults: "", moments: [emptyM("M0b", 0)] },
    ],
  };
}

// 1) addChapter appends + reindexes; caller is never mutated.
{
  const base = baseStory();
  const { story, missing } = applyOps(base, [{ op: "addChapter", name: "NEW" }]);
  assert(missing.length === 0, "addChapter: no problems");
  assert(story.chapters.length === 3, "addChapter: 3 chapters");
  assert(story.chapters[2].name === "NEW", "addChapter: name");
  assert(story.chapters.every((c, i) => c.chapterIndex === i), "addChapter: reindexed");
  assert(base.chapters.length === 2, "addChapter: caller NOT mutated");
}

// 2) moveChapter reorders + reindexes.
{
  const { story, missing } = applyOps(baseStory(), [{ op: "moveChapter", fromIndex: 1, toIndex: 0 }]);
  assert(missing.length === 0 && story.chapters[0].name === "C1" && story.chapters[0].chapterIndex === 0, "moveChapter");
}

// 3) emitter-form addAction is byte-identical to buildStoryReport's VoiceOver.
{
  const { story, missing } = applyOps(baseStory(), [
    { op: "addAction", at: { chapterIndex: 0, momentIndex: 1, section: "onStart" }, action: { action: "VoiceOver", text: "Hello" } },
  ]);
  assert(missing.length === 0, "addAction emitter: no problems");
  const added = story.chapters[0].moments[1].onStart.actions[0];
  const ref = buildStoryReport({ module: "X", chapters: [{ name: "c", moments: [{ name: "m", momentIndex: 0, onStart: [{ action: "VoiceOver", text: "Hello" }] }] }] }).produced.story.chapters[0].moments[0].onStart.actions[0];
  assert(JSON.stringify(added) === JSON.stringify(ref), "addAction emitter: byte-parity with buildStoryReport");
  assert(added.Data === '{"text":"Hello","waitForCompletion":true}', "addAction emitter: Data string");
}

// 4) raw addAction with object Data is coerced to a string.
{
  const { story } = applyOps(baseStory(), [
    { op: "addAction", at: { chapterIndex: 0, momentIndex: 1, section: "onEnd" }, node: { Name: "X", Data: { a: 1 }, Type: 0 } },
  ]);
  const n = story.chapters[0].moments[1].onEnd.actions[0];
  assert(typeof n.Data === "string" && n.Data === '{"a":1}', "raw addAction: Data object -> string");
  assert(n.ID === -1 && n.Query === "" && n.Option === "", "raw addAction: node defaults filled");
}

// 5) onWrong stays a BARE array through add/remove of trigger sets.
{
  const { story } = applyOps(baseStory(), [
    { op: "addTriggerSet", at: { chapterIndex: 0, momentIndex: 1, section: "onWrong" }, trigger: { type: "Touch", target: "Btn" } },
    { op: "removeTriggerSet", at: { chapterIndex: 0, momentIndex: 0, section: "onWrong", triggerSetIndex: 0 } },
  ]);
  assert(Array.isArray(story.chapters[0].moments[1].onWrong), "onWrong stays a bare array (add)");
  assert(Array.isArray(story.chapters[0].moments[0].onWrong) && story.chapters[0].moments[0].onWrong.length === 0, "onWrong bare array after remove");
}

// 6) setOnRightMode changes the mode on an existing moment (a former raw-C# gap).
{
  const { story } = applyOps(baseStory(), [{ op: "setOnRightMode", chapterIndex: 0, momentIndex: 0, mode: "Any" }]);
  assert(story.chapters[0].moments[0].onRight.mode === "Any", "setOnRightMode");
}

// 7) updateNode set.ID + bind-by-id embeds Query as name#$id (gap-closing).
{
  const { story, missing } = applyOps(baseStory(), [
    { op: "updateNode", at: { chapterIndex: 0, momentIndex: 0, section: "onRight", triggerSetIndex: 0, nodeKind: "trigger" }, set: { ID: 5 }, targetName: "Valve", targetId: 87, embedId: true },
  ]);
  assert(missing.length === 0, "updateNode: no problems");
  const trig = story.chapters[0].moments[0].onRight.triggerActionSets[0].trigger;
  assert(trig.Query === "Valve#$87" && trig.ID === 5, "updateNode: embed id + set.ID");
}

// 8) setMomentWeightage merges into moment.defaults WITHOUT dropping other keys (non-lossy).
{
  const { story } = applyOps(baseStory(), [{ op: "setMomentWeightage", chapterIndex: 0, momentIndex: 0, weightage: 2 }]);
  const d = JSON.parse(story.chapters[0].moments[0].defaults);
  assert(d.weightage === 2 && d.foo === 9, "setMomentWeightage: non-destructive merge (foo survives)");
}

// 9) bad index -> aggregated into missing, NOTHING mutated (clone discarded, caller intact).
{
  const base = baseStory();
  const { story, missing } = applyOps(base, [{ op: "removeChapter", chapterIndex: 99 }]);
  assert(missing.length === 1 && missing[0].kind === "BAD_ADDRESS", "bad index -> BAD_ADDRESS");
  assert(story.chapters.length === 2 && base.chapters.length === 2, "bad index -> no mutation");
}

// 10) moveMoment across chapters + reindex.
{
  const { story } = applyOps(baseStory(), [{ op: "moveMoment", chapterIndex: 0, fromIndex: 0, toIndex: 0, toChapterIndex: 1 }]);
  assert(story.chapters[0].moments.length === 1 && story.chapters[1].moments.length === 2, "moveMoment: counts");
  assert(story.chapters[1].moments.every((m, i) => m.momentIndex === i), "moveMoment: reindexed");
}

// 11) reindex + findChapter helpers.
{
  const s = baseStory();
  s.chapters.reverse();
  reindex(s);
  assert(s.chapters[0].chapterIndex === 0 && s.chapters[1].chapterIndex === 1, "reindex renumbers");
  assert(findChapter(s, "C0") && findChapter(s, 0) === s.chapters[0], "findChapter by name + index");
  assert(findChapter(s, "nope") === null, "findChapter miss -> null");
}

// 12) NAME-based addressing — add to a moment by name (no indices, no pre-read).
{
  const { story, missing } = applyOps(baseStory(), [
    { op: "addAction", at: { chapter: "C0", moment: "M0", section: "onEnd" }, action: { action: "VoiceOver", text: "bye" } },
  ]);
  assert(missing.length === 0, "name addressing: no problems");
  assert(story.chapters[0].moments[0].onEnd.actions[0]?.Name === "VoiceOver", "name addressing: landed in C0/M0/onEnd");
}

// 13) name miss -> NO_TARGET (loud fail, no mutation).
{
  const { missing } = applyOps(baseStory(), [{ op: "renameMoment", chapter: "C0", moment: "Nope", newName: "X" }]);
  assert(missing.length === 1 && missing[0].kind === "NO_TARGET", "name miss -> NO_TARGET");
}

// 14) duplicate name -> AMBIGUOUS_TARGET (refuses to guess).
{
  const s = baseStory();
  s.chapters[0].moments.push({ name: "M0", momentIndex: 2, studio: { id: "" }, defaults: "", onAwake: { actions: [] }, onStart: { actions: [] }, onRight: { mode: "InOrder", triggerActionSets: [] }, onWrong: [], onFirstWarning: { actions: [] }, onLastWarning: { actions: [] }, onEnd: { actions: [] } });
  const { missing } = applyOps(s, [{ op: "setOnRightMode", chapter: "C0", moment: "M0", mode: "Any" }]);
  assert(missing.length === 1 && missing[0].kind === "AMBIGUOUS_TARGET", "duplicate name -> AMBIGUOUS_TARGET");
}

// 15) name addressing on op-level chapter/moment fields too.
{
  const { story, missing } = applyOps(baseStory(), [{ op: "setOnRightMode", chapter: "C0", moment: "M1", mode: "Random" }]);
  assert(missing.length === 0 && story.chapters[0].moments[1].onRight.mode === "Random", "name addressing: setOnRightMode by name");
}

// 16) labelOf produces readable targets (used for compact `changes`).
assert(labelOf({ chapter: "C0", moment: "M0", section: "onStart" }) === "C0/M0/onStart", "labelOf name label");
assert(labelOf({ chapterIndex: 0, momentIndex: 1 }) === "ch0/m1", "labelOf index label");

// ─── registration / dispatcher ───
assert(vrseStoryConsolidatedTools.length === 3, "3 consolidated tools");
assert(
  vrseStoryConsolidatedTools.map((t) => t.name).sort().join(",") === "vrse_story_apply,vrse_story_edit,vrse_story_inspect",
  "consolidated tool names"
);
{
  const { metaTools, coreTools } = splitToolTiers([], { storyTools: vrseStoryOrchestrationTools });
  assert(metaTools.find((t) => t.name === "vrse_story_tool"), "vrse_story_tool in metaTools");
  assert(metaTools.find((t) => t.name === "vrse_list_story_tools"), "vrse_list_story_tools in metaTools");
  assert(!coreTools.find((t) => String(t.name).startsWith("unity_vrse_story")), "no granular story tools in core");
  const listed = JSON.parse(await metaTools.find((t) => t.name === "vrse_list_story_tools").handler());
  assert(listed.length === vrseStoryOrchestrationTools.length, `dispatcher lists all ${vrseStoryOrchestrationTools.length} granular story tools`);
  const disp = metaTools.find((t) => t.name === "vrse_story_tool");
  assert(/Unknown story tool/.test(await disp.handler({ tool: "nope" })), "dispatcher errors on unknown tool");
  assert(/'tool' parameter is required/.test(await disp.handler({})), "dispatcher requires tool");
}
assert(vrseStageTools.find((t) => t.name === "vrse_generate_story"), "vrse_generate_story still registered (delegated by apply)");

console.log("story-edit.smoke: PASS");
