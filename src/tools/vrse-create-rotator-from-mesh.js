// VRse Builder Advanced Mesh & Physics MCP Tools
// Two-tool AI flow: (1) Analyze mesh data → Agent reasons → (2) Create with explicit params
// Routes directly to vrse/create-rotator-from-mesh/* in the Unity plugin.
import * as bridge from "../unity-editor-bridge.js";

export const vrseCreateRotatorFromMeshTools = [
  // ─── Tool 1: Gather mesh data for AI analysis ─────────────────────
  {
    name: "vrse_rotator_analyze_mesh",
    description:
      "Step 1 of 2: Gathers mesh hierarchy data from a scene GameObject so you can reason about how to set up a rotator (PivotRotateLimiter). " +
      "Returns JSON with ALL scene instances matching the name (use instanceId to pick the right one — multiple objects often share names). " +
      "Each instance includes: root mesh, all children with names/bounds/positions/vertices/rotations.\n\n" +

      "NAME MATCHING IS FUZZY: matching is tiered (exact → normalized → substring), so an approximate name " +
      "('Switch On Off') still resolves the real object ('Switch_ON_OFF_Machine'). The result reports a top-level " +
      "\"matchType\" and a per-instance \"matchType\" of \"exact\" or \"fuzzy\".\n" +
      "  → If matchType is \"fuzzy\", you MUST confirm the resolved name with the user before calling create " +
      "(e.g. \"I found 'Switch_ON_OFF_Machine' — use that?\"). Only proceed once they confirm.\n" +
      "  → If matchCount is 0, tell the user the object wasn't found and ask for the correct name.\n\n" +

      "AFTER getting the data, you MUST reason about it before calling vrse_rotator_create_from_prefab. Here's how:\n\n" +

      "1. IDENTIFY THE OBJECT: What real-world thing is this? (telephone box, cabinet, lever, valve, dial, door, etc.)\n" +
      "2. CLASSIFY THE ROOT — this decides the template slot:\n" +
      "   - rootHasMesh = false → root is an empty PARENT WRAPPER. Pass useRootAsParent: true. PivotRotateLimiter lands inside it.\n" +
      "   - rootHasMesh = true AND childCount > 0 → root is the STATIC HOUSING. Children are the rotating/static parts.\n" +
      "   - rootHasMesh = true AND childCount = 0 → SOLO ROTATING MESH (dial, knob, door leaf with no sub-meshes).\n" +
      "     Pass rotatingMeshName: '' and rootMeshIsStatic: false. The root itself becomes the Grabbable mesh.\n" +
      "3. PICK THE RIGHT INSTANCE: If matchCount > 1, choose the instance with ALL expected children.\n" +
      "4. CLASSIFY EVERY MESH — nothing gets discarded, ever. Three slots:\n" +
      "   - PARENT WRAPPER (useRootAsParent: true): the root itself when it has no mesh.\n" +
      "   - SIBLINGS → staticMeshNames (Container): non-rotating children at the same level as the rotator.\n" +
      "     · Children named 'Body', 'Frame', 'Phone', 'Contents', 'Interior', 'Button', 'Label' → STATIC sibling.\n" +
      "     · Children named 'Cap', 'Door', 'Lid', 'Handle', 'Lever', 'Flap', 'Cover' → likely ROTATING.\n" +
      "     · If a child already has localRotation != (0,0,0), that CONFIRMS it is the rotating part.\n" +
      "   - ROTATOR + ITS CHILDREN → rotatingMeshName (Grabbable): the rotating child and everything in its 'children' array moves with it automatically.\n" +
      "     · Check the rotating child's 'children' array — list them in your reasoning so they're accounted for.\n" +
      "5. DETERMINE ROTATION KIND — classify HOW it rotates; the tool derives the exact WORLD axis\n" +
      "   from geometry. You do NOT pick an axis letter or reason about scene orientation. Set\n" +
      "   rotationKind:\n" +
      "   - 'hinge' = rotates about an EDGE: doors, cabinet doors, gates, lids, flaps.\n" +
      "       The tool uses the hinge edge — from hingeWorldDir if you give one, else the vertical edge.\n" +
      "   - 'spin' = rotates about its OWN SHAFT / face normal: dials, knobs, valves, wheels.\n" +
      "       The tool uses the mesh's thinnest axis (the face normal), so a panel-mounted dial spins\n" +
      "       around the panel's outward normal automatically — no matter how it's oriented.\n" +
      "   This classification is reliable and orientation-independent. (rotationAxis is now just a\n" +
      "   fallback used only if the mesh can't be read.)\n" +
      "6. DETERMINE THE HINGE — give a WORLD DIRECTION, do NOT compute coordinates or name local faces:\n" +
      "   Create takes 'hingeWorldDir' = a world-space direction pointing from the panel center toward\n" +
      "   the hinge. The tool excludes the panel's thinnest axis (thickness is never a hinge) and snaps\n" +
      "   to the width face that best matches your direction. You reason ONLY in world space — never\n" +
      "   about local mesh axes. (Local face names were ambiguous: a door's width can run along any\n" +
      "   world axis, so 'left'/'right' often landed on the thin thickness edge.)\n\n" +
      "   Decide using rootBoundsCenter and the doors' world positions:\n" +
      "   · rootBoundsCenter has a large offset on a width axis (art origin already at the hinge), OR\n" +
      "     the object is a DIAL/KNOB/VALVE (spins on its own shaft): OMIT hingeWorldDir → hinge at origin.\n" +
      "   · rootBoundsCenter ≈ (0,0,0) (origin at panel CENTER): set hingeWorldDir toward the hinge edge.\n" +
      "       DOUBLE DOOR: away from the other leaf → normalize(thisLeaf.worldPosition − otherLeaf.worldPosition).\n" +
      "         e.g. DoorLeft at smaller Z, DoorRight at larger Z → DoorLeft {x:0,y:0,z:-1}, DoorRight {x:0,y:0,z:1}.\n" +
      "       SINGLE DOOR: toward the hinge side (opposite the handle).\n" +
      "   A coarse direction is fine — thickness-exclusion + best-face snap make it orientation-robust.\n" +
      "7. DETERMINE ANGLE RANGE AND SIGN — this is the step most likely to go wrong:\n" +
      "   The Analyze result now includes worldForward, worldRight, worldUp for each child. Use these\n" +
      "   to determine which way positive rotation swings the door, BEFORE picking min/maxAngle.\n\n" +
      "   RIGHT-HAND RULE: positive rotation around an axis = counterclockwise when viewed from the\n" +
      "   positive end of that axis (e.g. positive Y = counterclockwise when viewed from above).\n\n" +
      "   FOR Y-AXIS DOORS:\n" +
      "   - Look at worldRight of the rotating mesh. This is the direction the door panel extends from the hinge.\n" +
      "   - Positive Y rotation sweeps worldForward TOWARD the direction of Cross(worldUp, worldForward).\n" +
      "     Simpler rule: if worldRight.z is POSITIVE (panel extends toward +Z), positive Y rotation swings\n" +
      "     the panel AWAY from +Z (closing). If worldRight.z is NEGATIVE, positive Y rotation swings\n" +
      "     the panel AWAY from -Z (toward +Z).\n" +
      "   - Determine which direction is 'open' (away from the cabinet body), then pick the sign:\n" +
      "     · Door opens with POSITIVE rotation → minAngle=0, maxAngle=+N\n" +
      "     · Door opens with NEGATIVE rotation → minAngle=-N, maxAngle=0\n\n" +
      "   FOR X-AXIS LIDS:\n" +
      "   - worldForward points away from the hinge (toward the free edge of the lid)\n" +
      "   - Positive X rotation sweeps the free edge DOWNWARD (closing). Negative sweeps it UP (opening).\n" +
      "   - A lid that opens upward: minAngle=-110, maxAngle=0\n\n" +
      "   IMPORTANT: Do NOT default to 0-to-positive just because 'that sounds like a door opening'.\n" +
      "   ALWAYS reason about worldForward/worldRight to get the sign right.\n\n" +
      "   Typical magnitudes (sign depends on analysis above):\n" +
      "   - Doors: ±90° to ±120°\n" +
      "   - Lids/flaps: ±90° to ±110°\n" +
      "   - Levers: ±30° to ±45°\n" +
      "   - Dials/valves: full 360° or constrained subset\n\n" +

      "RECOMMENDED WORKFLOW — use these companion tools for better results:\n" +
      "- BEFORE analyzing: Call unity_selection_set(path) then unity_selection_focus_scene_view() to focus camera on the object.\n" +
      "- BEFORE analyzing: Call unity_graphics_scene_capture or unity_screenshot_scene to VISUALLY SEE the object. Visual context helps you understand what it is (door vs lid vs lever) much better than mesh data alone.\n" +
      "- AFTER analyzing: If unsure about a child's role, call unity_gameobject_info(path) for more details.\n" +
      "- AFTER creating: Call unity_scene_hierarchy(parentPath, maxDepth=5) to verify the created hierarchy is correct.\n" +
      "- AFTER creating: Call unity_graphics_scene_capture to visually verify it looks correct.\n\n" +

      "Example reasoning for EmergencyTelephone (instanceId -77174, 2 children):\n" +
      "- rootHasMesh = true (1705 verts) → STATIC HOUSING, useRootAsParent: false\n" +
      "- EmergencyTelephone_Cap (878 verts, localRotation Y=36.6°, children: []) = door/cap → ROTATES on Y-axis (confirmed by existing Y rotation)\n" +
      "- EmergencyTelephone_Phone (294 verts, children: []) = phone handset inside → STATIC SIBLING → staticMeshNames\n" +
      "- Cap boundsCenter.x = -0.108 → mesh geometry offset from origin confirms origin IS the hinge edge (art convention)\n" +
      "- Grabbable will be placed at Cap's world position (the physical hinge) — no pivot offset needed\n" +
      "- Door swing: 0° to 120°",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectName: {
          type: "string",
          description:
            "Name of the root GameObject to analyze (e.g., 'EmergencyTelephone'). Returns ALL scene instances with this name.",
        },
      },
      required: ["gameObjectName"],
    },
    handler: async ({ gameObjectName }) => {
      try {
        const result = await bridge.sendCommand("vrse/create-rotator-from-mesh/analyze", { gameObjectName: gameObjectName || "" });
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Analyze failed: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 2: Create with AI-determined parameters ─────────────────
  {
    name: "vrse_rotator_create_from_prefab",
    description:
      "Step 2 of 2: Builds a fully functional rotator (PivotRotateLimiter) in Unity from the reasoning you did in vrse_rotator_analyze_mesh. " +
      "Call vrse_rotator_analyze_mesh FIRST, then call this with your decisions.\n\n" +

      "HOW IT WORKS INTERNALLY:\n" +
      "Instantiates the real PivotRotateLimiter_Block prefab (which has ALL required components already correctly wired: " +
      "Grabbable, HandGrabInteractable, GrabInteractable, SnapInteractor, MetaXRGrabbableWrapper, NetworkGrabbableWrapper, NetworkObject, NetworkRigidbody3D) " +
      "then swaps in the user's meshes and sets the rotation config. This is the correct approach — never build from scratch.\n\n" +

      "CRITICAL RULES:\n" +
      "- NEVER discard any mesh. Every mesh from the original object must appear in the output.\n" +
      "- Static meshes (root housing + non-rotating children) go in '[Name]_Container'.\n" +
      "- The rotating mesh goes inside the Grabbable's mesh node — it rotates around the pivot.\n" +
      "- rootMeshIsStatic is almost always true (the root is the frame/housing that doesn't move).\n" +
      "- Always provide instanceId when matchCount > 1 to target the correct object.\n\n" +

      "HOW PIVOT/HINGE WORKS:\n" +
      "The tool positions a Pivot node at the hinge and wires it to MetaXRPivotRotateLimiter, which captures that\n" +
      "world position ONCE at Start() and uses it statically — so the pivot never drifts even though the Pivot node\n" +
      "is a child of the rotating Grabbable.\n\n" +
      "Set the hinge with 'hingeWorldDir' = a WORLD direction from the panel center toward the hinge. The tool\n" +
      "excludes the panel's thinnest (thickness) axis and snaps to the width face best matching that direction —\n" +
      "you do NOT pass coordinates or reason about local axes.\n" +
      "  · OMIT hingeWorldDir → hinge at the mesh origin (dials, or art authored with origin at the hinge edge)\n" +
      "  · double door: away from the other leaf, e.g. {x:0,y:0,z:-1} / {x:0,y:0,z:1}\n" +
      "pivotWorldPosition remains only as an advanced override for irregular geometry.\n\n" +

      "Output hierarchy (from the real prefab):\n" +
      "  PivotRotateLimiter_[Name] (root — at hinge world position, identity rotation)\n" +
      "  ├── [Name]_Container (static housing mesh + static children)\n" +
      "  └── [Name]_Grabbable (Rigidbody, Grabbable [OneGrabTransformer=MetaXRPivotRotateLimiter],\n" +
      "      │                  HandGrabInteractable, GrabInteractable, SnapInteractor,\n" +
      "      │                  MetaXRGrabbableWrapper, NetworkGrabbableWrapper,\n" +
      "      │                  NetworkObject, NetworkRigidbody3D, MetaXRPivotRotateLimiter)\n" +
      "      └── Mesh\n" +
      "          └── GameObject_Mesh (rotating mesh + all its children go here)\n\n" +

      "AFTER CREATION — verify your work:\n" +
      "- Call unity_scene_hierarchy(parentPath='PivotRotateLimiter_[Name]', maxDepth=5) to confirm all meshes are present.\n" +
      "- Call unity_selection_set then unity_selection_focus_scene_view to focus on the result.\n" +
      "- Call unity_graphics_scene_capture to visually verify it looks correct.",
    inputSchema: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "Instance ID from vrse_rotator_analyze_mesh. REQUIRED when matchCount > 1 to target the correct object. Use the instance that has all expected children.",
        },
        parentObjectPath: {
          type: "string",
          description: "Fallback name/path if instanceId is 0. Only use when matchCount is 1.",
        },
        rotatingMeshName: {
          type: "string",
          description: "Name of the child that ROTATES. Identify by: name contains Cap/Door/Lid/Handle/Lever, OR has non-zero localRotation in the analysis data.",
        },
        staticMeshNames: {
          type: "string",
          description: "Comma-separated names of ALL non-rotating children. Every child not listed as rotating MUST be listed here. Nothing gets discarded.",
        },
        rootMeshIsStatic: {
          type: "boolean",
          description: "Almost always true. The root mesh is typically the housing/frame/body that stays fixed. Only false if the entire root object itself is the rotating part (rare).",
        },
        rotationKind: {
          type: "string",
          enum: ["hinge", "spin"],
          description:
            "How the object rotates — this is what determines the axis (the tool derives the exact WORLD axis from geometry):\n" +
            "- 'hinge' = rotates about an EDGE: doors, cabinet doors, gates, lids, flaps. The tool uses the hinge edge (from hingeWorldDir, or the vertical edge for doors).\n" +
            "- 'spin' = rotates about its OWN SHAFT / face normal: dials, knobs, valves, wheels. The tool uses the mesh's thinnest axis (the face normal).\n" +
            "Classify by what the object is — this is reliable and orientation-independent. Always set it.",
        },
        rotationAxis: {
          type: "string",
          enum: ["X", "Y", "Z"],
          description: "FALLBACK ONLY — the world axis is derived from geometry + rotationKind. This value is used only if the mesh can't be read. Pass your best guess (usually Y).",
        },
        minAngle: {
          type: "number",
          description: "Start angle in degrees. Almost always 0 (the resting/closed position). Use negative only for symmetric objects (e.g., lever at rest = 0, tilts -30 to +30).",
        },
        maxAngle: {
          type: "number",
          description: "End angle in degrees. Choose based on real-world physics of the object.",
        },
        useRootAsParent: {
          type: "boolean",
          description: "True when the source root is an empty wrapper (rootHasMesh=false from analysis). The new PivotRotateLimiter will be placed inside the source root instead of the QueryObjects hierarchy. Most objects do NOT need this — only set true when rootHasMesh was false.",
        },
        hingeWorldDir: {
          type: "object",
          description:
            "WORLD-space direction pointing from the panel center toward the hinge. The tool computes the exact hinge itself: it excludes the panel's thinnest axis (a door never hinges on its thickness face) and snaps to the width face whose outward world normal best matches this direction. You do NOT do coordinate math and do NOT reason about local vs world axes — just give a rough outward direction.\n" +
            "- OMIT entirely for dials/knobs/valves that spin on their own shaft, OR art whose origin is already at the hinge (rootBoundsCenter has a large offset on the hinge axis). Hinge stays at the mesh origin.\n" +
            "- DOOR: direction from the panel toward its hinge edge. For a DOUBLE DOOR this is the direction AWAY from the other leaf: hingeWorldDir = normalize(thisLeaf.worldPosition − otherLeaf.worldPosition). So if DoorLeft is at smaller Z and DoorRight at larger Z, DoorLeft → {x:0,y:0,z:-1}, DoorRight → {x:0,y:0,z:1}.\n" +
            "- SINGLE DOOR: point toward the hinge side (opposite the handle).\n" +
            "A coarse/approximate direction is fine — the thickness-exclusion + best-face snap make it robust to orientation.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          required: ["x", "y", "z"],
        },
        pivotWorldPosition: {
          type: "object",
          description: "ADVANCED escape hatch — only when hingeWorldDir cannot express the hinge (irregular geometry). Raw world position; overrides hingeWorldDir. Normally omit and use hingeWorldDir instead.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          required: ["x", "y", "z"],
        },
        reasoning: {
          type: "string",
          description: "Your reasoning chain: what the object is → root classification → solo mesh or has children → which part rotates → siblings → axis choice → pivot check (is origin at hinge or center?) → pivotWorldPosition calculation if needed → angle range.",
        },
      },
      required: [
        "rotatingMeshName",
        "rotationAxis",
        "minAngle",
        "maxAngle",
        "reasoning",
      ],
    },
    handler: async ({
      instanceId = 0,
      parentObjectPath = "",
      rotatingMeshName,
      staticMeshNames = "",
      rootMeshIsStatic = true,
      rotationAxis,
      rotationKind = "",
      minAngle,
      maxAngle,
      useRootAsParent = false,
      hingeWorldDir = null,
      pivotWorldPosition = null,
      reasoning,
    }) => {
      try {
        const axisIndex = rotationAxis === "X" ? 0 : rotationAxis === "Y" ? 1 : 2;
        // pivotWorldPosition is an explicit override; hingeWorldDir is the normal path — the C#
        // tool excludes the thickness face and snaps to the best width edge along this world direction.
        const pivotParams = pivotWorldPosition
          ? { overridePivot: true, pivotX: pivotWorldPosition.x, pivotY: pivotWorldPosition.y, pivotZ: pivotWorldPosition.z }
          : { overridePivot: false, pivotX: 0, pivotY: 0, pivotZ: 0 };
        const hingeDir = hingeWorldDir
          ? { hingeDirX: hingeWorldDir.x, hingeDirY: hingeWorldDir.y, hingeDirZ: hingeWorldDir.z }
          : { hingeDirX: 0, hingeDirY: 0, hingeDirZ: 0 };
        const result = await bridge.sendCommand("vrse/create-rotator-from-mesh/create", {
          instanceId, parentObjectPath, rotatingMeshName,
          staticMeshNames, rootMeshIsStatic, rotationAxis: axisIndex, rotationKind,
          minAngle, maxAngle, useRootAsParent,
          ...hingeDir,
          ...pivotParams,
        });
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ success: false, message: `Failed: ${error.message}` }, null, 2);
      }
    },
  },
];
