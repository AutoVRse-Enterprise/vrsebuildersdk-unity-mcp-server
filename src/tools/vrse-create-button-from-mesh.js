// VRse Builder — Convert meshes into Physical (Poke) Buttons
// Two-tool AI flow: (1) analyze mesh data → agent reasons → (2) create from the PhysicalButton_Block prefab.
// Routes directly to vrse/create-button-from-mesh/* in the Unity plugin.
import * as bridge from "../unity-editor-bridge.js";

export const vrseCreateButtonFromMeshTools = [
  // ─── Tool 1: Gather mesh data for AI analysis ─────────────────────
  {
    name: "vrse_button_analyze_mesh",
    description:
      "Step 1 of 2: Gathers mesh hierarchy data from a scene GameObject so you can reason about how to convert it " +
      "into a Physical (poke) Button. Returns JSON with ALL scene instances matching the name. Each instance " +
      "includes: root mesh, every child with names / bounds / vertices / local + world transforms.\n\n" +

      "NAME MATCHING IS FUZZY: tiered exact → normalized → substring. The result reports a top-level \"matchType\".\n" +
      "  → If matchType is \"fuzzy\", confirm the resolved name with the user before calling create.\n" +
      "  → If matchCount is 0, tell the user the object wasn't found and ask for the correct name.\n\n" +

      "AFTER getting the data, reason about these four things, then IMMEDIATELY call vrse_button_create_from_prefab:\n\n" +

      "1. CLASSIFY EVERY MESH — two roles:\n" +
      "   - CAP (pushable) → capMeshName: smaller mesh that sits proud of the housing. Names like 'Button', 'Cap', " +
      "'Key', 'Top', 'Press' → CAP.\n" +
      "   - BASE (static) → baseMeshNames (comma-separated) + rootIsBase. Names like 'Base', 'Housing', 'Ring', " +
      "'Bezel', 'Panel', 'Body', 'Frame' → BASE.\n" +
      "   · rootHasMesh=true and root is the housing → rootIsBase:true (default). Cap child → capMeshName.\n" +
      "   · SOLO button mesh (one mesh, no housing) → capMeshName:'' and rootIsBase:false.\n\n" +

      "2. DETERMINE PRESS DIRECTION (pressDir) — world-space OUTWARD normal (finger travels INTO the button along " +
      "this direction).\n" +
      "   The analysis returns a PRECOMPUTED \"predictedPressDir\" field — this is exactly what auto-derive will " +
      "use (thinnest local axis, flipped away from the parent). CHECK THIS FIRST.\n" +
      "   → If predictedPressDir looks correct (points outward from the button face), omit pressDir entirely.\n" +
      "   → Only pass an explicit pressDir if predictedPressDir is clearly wrong for the physical setup.\n" +
      "   NEVER derive pressDir yourself from worldForward/worldUp/worldRight — those are raw axes and do not " +
      "account for which axis is the thin face normal. Trust predictedPressDir instead.\n\n" +

      "3. DEPTH + RADIUS (both auto from cap bounds, override only for deliberate feel):\n" +
      "   - pressDepth: metres cap sinks when fully pressed. Auto ≈ half cap thickness (0.005–0.05 m).\n" +
      "   - pressRadius: contact radius (m). Auto = cap in-plane half-extent.\n\n" +

      "4. BATCH: if the user wants multiple buttons converted, collect all instanceIds and call " +
      "vrse_button_create_from_prefab once with a targets[] array.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectName: {
          type: "string",
          description:
            "Name of the root GameObject to analyze (e.g. 'StartButton'). Returns ALL scene instances with this name.",
        },
      },
      required: ["gameObjectName"],
    },
    handler: async ({ gameObjectName }) => {
      try {
        const result = await bridge.sendCommand("vrse/create-button-from-mesh/analyze", {
          gameObjectName: gameObjectName || "",
        });
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Analyze failed: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 2: Create one OR many buttons with AI-determined parameters ─────────
  {
    name: "vrse_button_create_from_prefab",
    description:
      "Step 2 of 2: Converts one or more scene meshes into Physical (poke) Buttons. Call vrse_button_analyze_mesh " +
      "first, then call this immediately with your decisions — no intermediate tool calls needed.\n\n" +

      "Instantiates the PhysicalButton_Block prefab (PokeInteractable + MetaXRPhysicalButton + NetworkPhysicalButton " +
      "already wired), swaps in the user's meshes, positions the surface, and disables the originals.\n\n" +

      "Returns per-button: name, instanceId, pressDir used, depth, radius. If success=false, the result includes " +
      "a reason — fix the params and retry.\n\n" +

      "SINGLE: pass fields at top level (instanceId, capMeshName, …).\n" +
      "MANY: pass a targets[] array — all objects converted in one call.",
    inputSchema: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "Instance ID from analyze. REQUIRED when matchCount > 1 to target the correct object.",
        },
        parentObjectPath: {
          type: "string",
          description: "Fallback name/path if instanceId is 0. Only use when matchCount is 1.",
        },
        capMeshName: {
          type: "string",
          description:
            "Name of the child that gets PUSHED (the cap). Leave '' together with rootIsBase:false for a solo " +
            "button mesh where the root itself is the cap.",
        },
        baseMeshNames: {
          type: "string",
          description:
            "Comma-separated names of ALL static housing/ring children. Every non-cap child should be listed here so nothing is dropped.",
        },
        rootIsBase: {
          type: "boolean",
          description:
            "True (default) when the root mesh is the static housing. Set false only for a solo button mesh (root itself is the cap).",
        },
        pressDir: {
          type: "object",
          description:
            "OPTIONAL world-space OUTWARD normal the button face points (finger presses INTO it). Omit to auto-derive " +
            "from the cap's flat-face normal. Set only when the cap isn't obviously flat or auto would point wrong.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          required: ["x", "y", "z"],
        },
        pressDepth: {
          type: "number",
          description: "OPTIONAL travel distance (m) the cap sinks when pressed. Omit/0 to auto (~half cap thickness, 0.005–0.05).",
        },
        pressRadius: {
          type: "number",
          description: "OPTIONAL poke contact radius (m). Omit/0 to auto (cap in-plane half-extent).",
        },
        targets: {
          type: "array",
          description:
            "OPTIONAL — convert MANY objects in one call. Each item is the same field set as the single form " +
            "(instanceId, capMeshName, baseMeshNames, rootIsBase, pressDir, pressDepth, pressRadius). When provided, " +
            "the top-level fields are ignored.",
          items: {
            type: "object",
            properties: {
              instanceId: { type: "number" },
              parentObjectPath: { type: "string" },
              capMeshName: { type: "string" },
              baseMeshNames: { type: "string" },
              rootIsBase: { type: "boolean" },
              pressDir: {
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
                required: ["x", "y", "z"],
              },
              pressDepth: { type: "number" },
              pressRadius: { type: "number" },
            },
          },
        },
      },
    },
    handler: async (params = {}) => {
      try {
        // Flatten a single target's { pressDir:{x,y,z}, … } into the flat fields the C# Params expects.
        const flatten = (t = {}) => {
          const d = t.pressDir || null;
          return {
            instanceId: t.instanceId ?? 0,
            parentObjectPath: t.parentObjectPath ?? "",
            capMeshName: t.capMeshName ?? "",
            baseMeshNames: t.baseMeshNames ?? "",
            rootIsBase: t.rootIsBase ?? true,
            pressDirX: d ? d.x : 0,
            pressDirY: d ? d.y : 0,
            pressDirZ: d ? d.z : 0,
            pressDepth: t.pressDepth ?? 0,
            pressRadius: t.pressRadius ?? 0,
          };
        };

        const payload = Array.isArray(params.targets) && params.targets.length > 0
          ? { targets: params.targets.map(flatten) }
          : flatten(params);

        const result = await bridge.sendCommand("vrse/create-button-from-mesh/create", payload);
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ success: false, message: `Failed: ${error.message}` }, null, 2);
      }
    },
  },
];
