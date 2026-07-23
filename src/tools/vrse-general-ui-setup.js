import * as bridge from "../unity-editor-bridge.js";

export const vrseGeneralUISetupTools = [
  {
    name: "vrse_general_ui_setup",
    description:
      "Create, update, or remove a world-space UI panel in the scene using the VRseGlass v4 design system.\n\n" +
      "DESIGN RULES (VRseGlass v4):\n" +
      "  • Panel background: frosted glass (FrostedGlassUI material, 75px rounded corners).\n" +
      "  • Typography: Outfit Bold for titles (52px), Outfit Regular for body (28px). Always white or near-white text.\n" +
      "  • Button: solid purple pill (#9461c1, 300×100px, 500px corner radius). One primary CTA per panel.\n" +
      "  • Prefer short, action-forward button labels: 'Continue', 'Got it', 'Start', 'Next'.\n" +
      "  • Media (images/video) sits in a frosted sub-card with 50px rounded corners, aspect preserved.\n" +
      "  • Never set panelHeight — height auto-fits to content via ContentSizeFitter.\n\n" +
      "LAYOUT (VerticalLayoutGroup, top → bottom, 20px spacing, 32px padding all sides, childControlWidth=false):\n" +
      "  1. titleText  — Outfit Bold 52px, white, center-aligned (Intro_Header)\n" +
      "  2. imagePath  — frosted sub-card, aspect preserved, max height 260px\n" +
      "  3. videoPath  — frosted sub-card, 16:9, max height 260px\n" +
      "  4. bodyText   — Outfit Regular 28px, off-white, center-aligned, auto-height (Description). For media cards, this goes BELOW the image/video.\n" +
      "  5. Button     — always last, solid purple pill, label via 'text' param\n\n" +
      "PANEL WIDTH — reason about content and set panelWidth only (height is automatic):\n" +
      "  • Title + paragraph + button            → 700 (standard)\n" +
      "  • Long list / many body lines           → 760\n" +
      "  • Image/video + caption                 → 760\n" +
      "  • Narrow alert / single-line message    → 600\n" +
      "  Canvas units at scale 0.002 → 700u ≈ 1.4m wide in world space.\n\n" +
      "CONTENT GUIDE — pick params based on content type:\n" +
      "  • Instruction card            → titleText + bodyText + text='Continue'\n" +
      "  • Steps / numbered list       → titleText + bodyText, hideButton=true if display-only\n" +
      "  • Image with caption          → titleText + imagePath + bodyText + optional button\n" +
      "  • Video with description      → titleText + videoPath + bodyText\n\n" +
      "Template: Assets/VRseBuilder/_Core/Runtime/VRseGlass/Prefabs/UI/Panel_GlassUI.prefab\n\n" +
      "Actions:\n" +
      "  create — instantiate template, rename, apply v4 glass styling and content\n" +
      "  update — find by name, apply any non-null params (partial update)\n" +
      "  remove — find by name, destroy GameObject",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "remove"],
          description: "Operation to perform",
        },
        name: {
          type: "string",
          description: "Name for the new GameObject, or name to find for update/remove",
        },
        text: {
          type: "string",
          description: "Label for the primary CTA button. Short action phrases only: 'Continue', 'Got it', 'Start', 'Next'. Defaults to 'Continue'.",
        },
        titleText: {
          type: "string",
          description: "Main headline (Intro_Header). Outfit Bold 52px white. Use for the primary message or screen title.",
        },
        bodyText: {
          type: "string",
          description: "Body copy (Description). Outfit Regular 28px off-white, auto-height. For image/video cards, this is a caption/description below the media.",
        },
        hideButton: {
          type: "boolean",
          description: "If true, hides the CTA button. Use for display-only panels (infographic, status, numbered list).",
        },
        imagePath: {
          type: "string",
          description: "Asset path to a Texture2D to show in a frosted glass sub-card. Aspect ratio preserved, max height 260px.",
        },
        videoPath: {
          type: "string",
          description: "Asset path to a VideoClip to show in a frosted glass sub-card. 16:9, max height 260px.",
        },
        panelWidth: {
          type: "number",
          description: "Canvas rect width in units. At scale 0.002: 600u≈1.2m, 700u≈1.4m, 760u≈1.5m. Height auto-fits to content — do NOT set panelHeight. Default: 700.",
        },
        templateName: {
          type: "string",
          description: "Prefab name to use as template. Defaults to Panel_GlassUI. Searched in Assets/VRseBuilder/_Core/Runtime/VRseGlass/Prefabs/UI/ first, then full project.",
        },
      },
      required: ["action", "name"],
    },
    handler: async (params) => {
      try {
        const result = await bridge.sendCommand("vrse/ui/general-setup", params);
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: error.message }, null, 2);
      }
    },
  },
];
