import * as bridge from "../unity-editor-bridge.js";

export const vrseStoryReportTools = [
  {
    name: "vrse_get_story_report",
    description:
      "Fetches the story validation report from the StoryReportEditor — the same report that populates " +
      "on save in the story edit window. Refreshes both issue caches before returning.\n\n" +
      "Returns two sections:\n" +
      "  momentIssues: per-moment validation problems (missing references, bad node parameters, invalid action data)\n" +
      "  flowIssues: cross-moment flow problems (PlacePoint/grabbable state inconsistencies)\n\n" +
      "Use this to get a structured overview of all story problems before editing, or to verify a story is clean after edits.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const result = await bridge.sendCommand("vrse/story/report", {});
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: error.message }, null, 2);
      }
    },
  },
];
