# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Summary

The MCP server moved from a monolithic, heuristic-driven prototype to a modular After Effects 2024 implementation. ExtendScript execution, expression generation, tool registration, generated output, tests, and documentation are separated into maintainable source surfaces.

The rework replaces synthetic bridge success responses with result-file and structured MCP error handling, while adding AE 2024-specific APIs and native PNG verification.

### Before vs. After

| Area | Previous Implementation | Reworked Implementation |
|---|---|---|
| IPC & Result Channel | COM stdout heuristics and a 3-second sleep fallback | Unique result-file job protocol for Windows COM and `AfterFX.exe -r`, plus macOS `osascript` |
| Error Handling | Raw or wrapped text responses could hide bridge failure | Structured `{ ok, data, error, line, requestId }` envelopes and MCP `isError: true` |
| ExtendScript Safety | Generated scripts lacked a consistent ES3/result wrapper | ES3 wrapper, JSON polyfill, `app.beginUndoGroup()` / `app.endUndoGroup()` in `try/finally` |
| Visual Feedback | Execution returned text only | `saveFrameToPng` with Node-side PNG signature, IEND trailer, and stability validation |
| After Effects 2024 APIs | No verified font, renderer, track-matte, or frame-capture tools | `app.fonts.allFonts`, exact renderer matchNames, `setTrackMatte`, `sourceRectAtTime`; no `aerender` integration |
| MCP Protocol & Transports | Legacy `server.tool`, stdio-only, no resources or prompts | `registerTool` registrations, annotations, resources, prompts, stdio, and Streamable HTTP |
| Codebase & Git Hygiene | 1,076-line monolithic server and vendored tracked dependencies | Modular `src/`, `.gitignore`, a `node:test` suite, and CI workflow |

### Added

- AE 2024 font discovery through `list_fonts`.
- Exact composition renderer control through `set_composition_renderer`.
- Track-matte setting/removal through `set_track_matte`.
- Native MCP PNG image output through `capture_frame_to_png`.
- Source-rect anchor centering through `center_anchor_on_source_rect`.
- MCP resources `ae://project`, `ae://active-composition`, and `ae://rules/2024`.
- MCP prompt `ae2024-production-workflow`.
- Streamable HTTP mode through `AE_MCP_HTTP_PORT`.
- Result-file bridge payloads with request IDs and timeout failure envelopes.
- `.gitignore`, Node test coverage, and CI workflow.

### Changed

- MCP tool registrations now use `registerTool` and include annotations and output schemas.
- Tool failures return MCP `isError: true` with structured details.
- Windows bridge discovery supports AE COM and `AfterFX.exe -r` candidates.
- macOS bridge execution uses `osascript` and After Effects `DoScript`.
- `set_layer_properties` now applies `blendingMode`.
- Raw ExtendScript remains available through `execute_extendscript`; `execute_raw_extendscript` is retained as a compatibility alias.

### Fixed

- Bridge paths no longer fabricate success after a 3-second sleep.
- Invalid, missing, or timed-out bridge result files produce explicit failure envelopes.
- AE project bit depth is set through `app.project.bitsPerChannel`.
- Composition renderer requests are verified against runtime `comp.renderers`.

### Removed

- `node_modules/` and `dist/` are no longer tracked in Git.
- No stdout success banner or `console.log()` is emitted by `src/`.

### Breaking Changes / Migration Notes

After pulling this update, run:

```powershell
npm install
npm run build
```

Enable **Edit → Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network** in After Effects 2024. This permission is required for result-file IPC and frame capture.

HTTP mode is opt-in through `AE_MCP_HTTP_PORT`. The implementation has no Bearer-auth environment variable or TLS setup.

Raw script execution is enabled by default. Set `AE_DISABLE_RAW_SCRIPT=1` to reject `execute_extendscript` and `execute_raw_extendscript`.

The server does not expose an `aerender` CLI tool or the `AE_TIMEOUT_MS`/`AE_EXECUTABLE_PATH` environment variables.
