<p align="center">
  <img src="icon.png" alt="VRseBuilder Unity MCP" width="180" />
</p>

# Unity MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI assistants like Claude full control over **Unity Hub** and **Unity Editor**. Built by [AutoVRse](https://github.com/AutoVRse-Enterprise).

## Features

**200+ tools** covering the full Unity workflow:

| Category | Tools |
|----------|-------|
| **Unity Hub** | List/install editors, manage modules, set install paths |
| **Scenes** | Open, save, create scenes, get full hierarchy tree with pagination |
| **GameObjects** | Create (primitives/empty), delete, duplicate, reparent, activate/deactivate, transform (world/local) |
| **Components** | Add, remove, get/set any serialized property, wire object references, batch wire |
| **Assets** | List, import, delete, search, create prefabs, create & assign materials |
| **Scripts** | Create, read, update C# scripts |
| **Builds** | Multi-platform builds (Windows, macOS, Linux, Android, iOS, WebGL) |
| **Console & Compilation** | Read/clear Unity console logs (errors, warnings, info); get C# compilation errors via CompilationPipeline (independent of console buffer) |
| **Play Mode** | Play, pause, stop |
| **Editor** | Execute menu items, run C# code, get editor state, undo/redo |
| **Project** | Project info, packages (list/add/remove/search), render pipeline, build settings |
| **Animation** | List clips & controllers, get parameters, play animations |
| **Prefab** | Open/close prefab mode, get overrides, apply/revert changes |
| **Physics** | Raycasts, sphere/box casts, overlap tests, physics settings |
| **Lighting** | Manage lights, environment, skybox, lightmap baking, reflection probes |
| **Audio** | AudioSources, AudioListeners, AudioMixers, play/stop, mixer params |
| **Terrain** | Create/modify terrains, paint heightmaps/textures, manage terrain layers, trees, details |
| **Navigation** | NavMesh baking, agents, obstacles, off-mesh links |
| **Particles** | Particle system creation, inspection, module editing |
| **UI** | Canvas, UI elements, layout groups, event system |
| **Tags & Layers** | List/add/remove tags, assign tags & layers |
| **Selection** | Get/set editor selection, find by name/tag/component/layer/tag |
| **Graphics** | Scene and game view capture (inline images for visual inspection) |
| **Input Actions** | Action maps, actions, bindings (Input System package) |
| **Assembly Defs** | List, inspect, create, update .asmdef files |
| **ScriptableObjects** | Create, inspect, modify ScriptableObject assets |
| **Constraints** | Position, rotation, scale, aim, parent constraints |
| **LOD** | LOD group management and configuration |
| **Profiler** | Start/stop profiling, stats, deep profiles, save profiler data |
| **Frame Debugger** | Enable/disable, draw call list & details, render targets |
| **Memory Profiler** | Memory breakdown, top consumers, snapshots (`com.unity.memoryprofiler`) |
| **Shader Graph** | List, inspect, create, open Shader Graphs & Sub Graphs; VFX Graphs |
| **Amplify Shader** | List, inspect, open Amplify shaders & functions (if installed) |
| **MPPM Scenarios** | List, activate, start, stop multiplayer playmode scenarios; get status & player info |
| **Multi-Instance** | Discover and switch between multiple running Unity Editor instances |
| **Multi-Agent** | List active agents, get agent action logs, queue monitoring |
| **Project Context** | Auto-inject project-specific docs and guidelines for AI agents |

## Architecture

```
Claude / AI Assistant ←→ MCP Server (this repo) ←→ Unity Editor Plugin (HTTP bridge)
                                ↕
                          Unity Hub CLI
```

This server communicates with:
- **Unity Hub** via its CLI (supports both modern `--headless` and legacy `-- --headless` syntax)
- **Unity Editor** via the companion [unity-mcp-plugin](https://github.com/AutoVRse-Enterprise/VRseBuilderSDK-mcp-plugin) which runs an HTTP API inside the editor

### Two-Tier Tool System

To avoid overwhelming MCP clients with 200+ tools, the server uses a two-tier architecture:
- **Core tools** (~70) are always exposed directly
- **Advanced tools** (~130+) are accessed via a single `unity_advanced_tool` proxy with lazy loading

This keeps the tool count manageable for clients like Claude Desktop and Cowork while still providing access to every Unity feature. Use `unity_list_advanced_tools` to discover all advanced tools by category.

### Multi-Instance Support

The server automatically discovers all running Unity Editor instances on startup. If only one instance is found, it auto-connects. If multiple instances are running (e.g., main editor + ParrelSync clones), it prompts you to select which one to work with.

**Port Resilience** — The server includes a multi-layer protection system for reliable multi-project workflows:

- **Port Identity Validation** — When restoring a saved connection, the server verifies the instance identity (project name + path) matches the expected target. If Unity restarts and a different project grabs the port, the server detects this and re-discovers the correct instance.
- **Compile-Time Resilience** — During long Unity compiles (when the editor is unresponsive), the server checks the shared instance registry. If the registry entry is fresh (updated within the last 5 minutes via heartbeat), the connection is preserved instead of dropped.
- **Crash Detection** — The plugin sends a heartbeat every 30 seconds to the instance registry. If Unity crashes and the heartbeat stops, the server detects the stale registry entry (>5 minutes old) and clears it, allowing proper re-discovery.
- **Port Affinity** — The plugin remembers its last-used port via EditorPrefs and reclaims it on restart, minimizing port swaps across editor restarts.

## Quick Start

### 1. Install the Unity Plugin

In Unity: **Window > Package Manager > + > Add package from git URL:**
```
https://github.com/AutoVRse-Enterprise/VRseBuilderSDK-mcp-plugin.git
```

### 2. Install this MCP Server

```bash
git clone https://github.com/AutoVRse-Enterprise/vrsebuildersdk-unity-mcp-server.git
cd unity-mcp-server
npm install
```

### 3. Add to Claude Desktop

Open Claude Desktop > Settings > Developer > Edit Config, and add:

```json
{
  "mcpServers": {
    "unity": {
      "command": "node",
      "args": ["C:/path/to/unity-mcp-server/src/index.js"],
      "env": {
        "UNITY_HUB_PATH": "C:\\Program Files\\Unity Hub\\Unity Hub.exe",
        "UNITY_BRIDGE_PORT": "7890"
      }
    }
  }
}
```

Restart Claude Desktop. Done!

### 4. Try It

- *"List my installed Unity editors"*
- *"Show me the scene hierarchy"*
- *"Create a red cube at position (0, 2, 0) and add a Rigidbody"*
- *"Profile my scene and show the top memory consumers"*
- *"List all Shader Graphs in my project"*
- *"Build my project for Windows"*
- *"List and start my MPPM multiplayer scenarios"*
- *"Capture a screenshot of my scene view"*
- *"Show me the active agent sessions"*

## Agent Skills

This repo ships portable [Agent Skills](https://agentskills.io) that work automatically with
**Claude Code**, **Cursor**, **Codex**, and **OpenCode** — no extra setup needed.

### For Users

Skills are ready the moment you finish setup. When you run `npm install`, a `prepare` hook
automatically syncs all skills into the directories each AI tool expects (`.claude/skills/`,
`.cursor/skills/`, `.agents/skills/`). When you `git pull` updates that include new or
changed skills, the mirrors are included in the pull — so skills stay current without any
extra step.

### For Developers

All skills live in **`skills/`** — that is the single source of truth. The mirror directories
are generated copies; never edit them directly.

```bash
# 1. Create or edit a skill
skills/my-new-skill/SKILL.md

# 2. Sync mirrors
npm run skills:sync

# 3. Commit canonical + mirrors together
git add skills/ .claude/skills/ .cursor/skills/ .agents/skills/
git commit -m "feat: add my-new-skill"
```

To scaffold a new skill the right way, ask your agent to "use the new-skill skill" — it
knows the layout rules and where to write files.

| Command | Purpose |
|---------|---------|
| `npm run skills:sync` | Mirror `skills/` → all tool directories |
| `npm run skills:reconcile` | Pull any skill created in a mirror back into `skills/`, then sync |
| `npm run skills:check` | Exit non-zero if mirrors are out of sync (for CI) |

> **Why are mirrors committed to git?** So that `git pull` delivers updated skills
> immediately — no rebuild step needed. The `prepare` hook acts as a safety net: if mirrors
> ever drift, the next `npm install` self-heals them.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `UNITY_HUB_PATH` | `C:\Program Files\Unity Hub\Unity Hub.exe` | Unity Hub executable path |
| `UNITY_BRIDGE_HOST` | `127.0.0.1` | Editor bridge host |
| `UNITY_BRIDGE_PORT` | `7890` | Editor bridge port (auto-discovered when using multi-instance) |
| `UNITY_BRIDGE_TIMEOUT` | `30000` | Request timeout in ms |
| `UNITY_PORT_RANGE_START` | `7890` | Start of port scan range for multi-instance discovery |
| `UNITY_PORT_RANGE_END` | `7899` | End of port scan range |
| `UNITY_REGISTRY_STALENESS_TIMEOUT` | `300000` | Registry entry staleness timeout in ms (crash detection) |
| `UNITY_RESPONSE_SOFT_LIMIT` | `2097152` | Response size soft limit in bytes (warning) |
| `UNITY_RESPONSE_HARD_LIMIT` | `4194304` | Response size hard limit in bytes (truncation) |
| `UNITY_MCP_DEBUG` | `false` | Enable debug logging for troubleshooting |

The Unity plugin also has its own settings accessible via the Dashboard (`Window > VRseBuilder Unity MCP`) for port, auto-start, and per-category feature toggles.

## Optional Package Support

Some tools activate automatically when their packages are detected in the Unity project:

| Package / Asset | Features Unlocked |
|----------------|-------------------|
| `com.unity.memoryprofiler` | Memory snapshot capture via MemoryProfiler API |
| `com.unity.shadergraph` | Shader Graph creation, inspection, opening |
| `com.unity.visualeffectgraph` | VFX Graph listing and opening |
| `com.unity.inputsystem` | Input Action map and binding inspection |
| `com.unity.multiplayer.playmode` | MPPM scenario listing, activation, start/stop, player info |
| Amplify Shader Editor (Asset Store) | Amplify shader listing, inspection, opening |

Features for uninstalled packages return helpful messages explaining what to install.

## Requirements

- Node.js 18+
- Unity Hub (for Hub tools)
- Unity Editor with [unity-mcp-plugin](https://github.com/AutoVRse-Enterprise/VRseBuilderSDK-mcp-plugin) installed (for Editor tools)

## Troubleshooting

**"Connection failed" errors** — Make sure Unity Editor is open and the plugin is installed. Check the Unity Console for `[MCP Bridge] Server started on port 7890`.

**"Unity Hub not found"** — Update `UNITY_HUB_PATH` in your config to match your installation.

**"Category disabled" errors** — A feature category may be toggled off. Open `Window > VRseBuilder Unity MCP` in Unity to check category settings.

**Port conflicts** — Change `UNITY_BRIDGE_PORT` in your Claude config and update the port in Unity's MCP Dashboard settings.

## License

See [LICENSE](LICENSE).
