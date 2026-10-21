# M3 evidence

All desktop captures come from the actual Windows Tauri/WebView2 application. The live scenario uses a separate `jam-board-mcp.exe` stdio process, not the mock bridge.

- `window-light.png`, `window-dark.png`: full native window captures, including the title bar.
- `desktop-content-light.png`, `desktop-content-dark.png`: native WebView content, 1360 × 860. The fixed 288 px columns intentionally scroll horizontally.
- `desktop-highlight-toast.png`: a live agent card and its notification.
- `window-highlight-toast.png`: the same agent feedback in a full native window capture.
- `desktop-minimum.png`, `desktop-task-drawer.png`: 1100 × 700 content with expanded navigation, and a task opened through a direct URL.
- `ui-light.json`, `ui-dark.json`: computed theme/font state and text contrast measurements.
- `agent-arrival.webm`: short local VP9 recording of the real WebView compositor stream. Encoding preserves frame timing; it does not synthesize motion.
- `agent-arrival-1.jpg` … `agent-arrival-6.jpg`: samples around 0/200/400/600/800/1000 ms. `live-result.json` records actual sample and compositor frame times.
- `live-result.json`, `mcp-transcript.md`: measured DOM arrival, actor/theme assertions, abbreviated MCP calls and responses.
- `browser-light.png`, `browser-dark.png`: supplementary mock-browser visual checks.

Reproduce from the repository root (PowerShell):

```powershell
$env:JAM_BOARD_DATA_DIR = (Join-Path (Get-Location) '.dev-data')
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
Set-Location apps/desktop
npm run tauri -- dev
```

Then in a second shell at the repository root:

```powershell
node scripts/m3-live-demo.mjs
```

The scenario creates a new demo jam, preserving earlier jams under decision 18, then creates a task, claims another, moves a third and verifies a human UI mutation. It also leaves the theme dark to check persistence after reload. The diagnostics setting is process-local; closing the dev process ends that endpoint. Real agent client configuration files are never edited.
