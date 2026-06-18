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

      "AFTER getting the data, you MUST reason about it before calling vrse_rotator_create_from_prefab. Here's how:\n\n" +

      "1. IDENTIFY THE OBJECT: What real-world thing is this? (telephone box, cabinet, lever, valve, etc.)\n" +
      "2. CLASSIFY THE ROOT — this decides the template slot:\n" +
      "   - rootHasMesh = false → root is an empty PARENT WRAPPER (e.g. a Cabinet transform with no geometry). Pass useRootAsParent: true to Create. The PivotRotateLimiter will be placed inside it.\n" +
      "   - rootHasMesh = true → root is the STATIC HOUSING. Its mesh goes into Container as usual. Pass useRootAsParent: false.\n" +
      "3. PICK THE RIGHT INSTANCE: If matchCount > 1, choose the instance with ALL expected children (e.g., an EmergencyTelephone should have both Cap and Phone children, not just Phone).\n" +
      "4. CLASSIFY EVERY MESH — nothing gets discarded, ever. Three slots:\n" +
      "   - PARENT WRAPPER (useRootAsParent: true): the root itself when it has no mesh.\n" +
      "   - SIBLINGS → staticMeshNames (Container): non-rotating children at the same level as the rotator.\n" +
      "     · Children named 'Body', 'Frame', 'Phone', 'Contents', 'Interior', 'Button', 'Label' → STATIC sibling.\n" +
      "     · Children named 'Cap', 'Door', 'Lid', 'Handle', 'Lever', 'Flap', 'Cover' → likely ROTATING.\n" +
      "     · If a child already has localRotation != (0,0,0), that CONFIRMS it is the rotating part.\n" +
      "   - ROTATOR + ITS CHILDREN → rotatingMeshName (Grabbable): the rotating child and everything in its 'children' array moves with it automatically.\n" +
      "     · Check the rotating child's 'children' array — list them in your reasoning so they're accounted for.\n" +
      "5. DETERMINE ROTATION AXIS from the object type:\n" +
      "   - Doors, cabinet doors, gates → Y-axis (vertical hinge, swings horizontally)\n" +
      "   - Lids, flaps, mailbox doors → X-axis (horizontal hinge, opens up/down)\n" +
      "   - Dials, valves, wheels, levers → Z-axis (rotates in-plane)\n" +
      "   - Cross-check: if a child has non-zero localRotation on the chosen axis, it confirms that axis.\n" +
      "6. THE PIVOT IS THE ROTATING MESH'S WORLD POSITION — no offset calculation needed.\n" +
      "   The Create tool places the Grabbable (and hence the pivot/hinge) exactly at the rotating mesh's\n" +
      "   transform origin in world space. Art assets are authored so the mesh origin IS the physical hinge edge.\n" +
      "   If the boundsCenter offset is very large (mesh centroid is far from origin), that confirms the\n" +
      "   origin is intentionally at the hinge, not the mesh center — this is correct, do nothing extra.\n" +
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
      "The Grabbable is placed at the rotating mesh's world position (its transform origin = physical hinge).\n" +
      "MetaXRPivotRotateLimiter uses the Grabbable's own position as the pivot — no separate Pivot Transform needed.\n" +
      "The Grabbable starts at world rotation (0,0,0) so local rotation 0 = rest/closed. The wired OneGrabTransformer\n" +
      "on the Grabbable component IS the MetaXRPivotRotateLimiter. Do NOT pass pivotX/Y/Z — there are none.\n\n" +

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
        rotationAxis: {
          type: "string",
          enum: ["X", "Y", "Z"],
          description: "Y = vertical hinge (doors, cabinet doors, gates). X = horizontal hinge (lids, flaps, mailboxes). Z = in-plane rotation (dials, valves, levers). Cross-check with the rotating child's localRotation from analysis.",
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
        reasoning: {
          type: "string",
          description: "Your reasoning chain: what the object is → root classification (parent wrapper or static housing) → which part rotates and why → siblings list → children of rotator → axis choice → pivot logic → angle range.",
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
      minAngle,
      maxAngle,
      useRootAsParent = false,
      reasoning,
    }) => {
      try {
        const axisIndex = rotationAxis === "X" ? 0 : rotationAxis === "Y" ? 1 : 2;
        const result = await bridge.sendCommand("vrse/create-rotator-from-mesh/create", {
          instanceId, parentObjectPath, rotatingMeshName,
          staticMeshNames, rootMeshIsStatic, rotationAxis: axisIndex,
          minAngle, maxAngle, useRootAsParent,
        });
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ success: false, message: `Failed: ${error.message}` }, null, 2);
      }
    },
  },
];
