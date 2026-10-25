# Credits

Jam Board is MIT licensed, copyright 2026 Danil Volodin. Dependencies retain their original licenses. Versions are locked in Cargo.lock and apps/desktop/package-lock.json.

| Software | License |
|---|---|
| Rust, Tauri, Tauri plugins, Tokio | MIT / Apache-2.0 (see each package) |
| tauri-specta, specta, specta-typescript | MIT |
| rmcp | Apache-2.0 |
| rusqlite | MIT |
| rusqlite_migration | MIT |
| SQLite (bundled) | Public domain |
| axum, serde, serde_json, thiserror, tracing | MIT / Apache-2.0 |
| schemars | MIT |
| ulid | MIT |
| tokio-util, percent-encoding | MIT / Apache-2.0 |
| http-range (Tauri asset protocol) | MIT |
| time, rand, base64 | MIT / Apache-2.0 |
| React, Vite, TypeScript, Tailwind CSS | MIT |
| Biome | MIT / Apache-2.0 |
| Vitest | MIT |
| TanStack Query, Router, Virtual; Zustand | MIT |
| React Flow (`@xyflow/react`, `@xyflow/system`) | MIT |
| dnd-kit, Motion, react-hook-form, hookform/resolvers, Zod | MIT |
| react-markdown, remark-gfm, roughjs | MIT |
| Lucide | ISC |
| Testing Library, happy-dom | MIT |
| Playwright | Apache-2.0 |
| sharp | Apache-2.0 (bundled libvips: LGPL-3.0-or-later) |
| Fontsource package tooling | MIT |

Self-hosted fonts: PT Serif and PT Serif Caption (ParaType), Shantell Sans (Arrow Type / Shantell Martin), and JetBrains Mono (JetBrains). All font artwork uses SIL Open Font License 1.1; original license texts are included in `apps/desktop/src/assets/licenses/`. Regular UI text uses PT Serif Caption; emphasized UI weights use real PT Serif 700 glyphs through the Jam Text alias; headings use PT Serif and handwritten accents use Shantell Sans.

The sticker/J/star icon is original vector artwork for Jam Board, generated to platform sizes by the Tauri CLI. M3–M5 include only the five approved chibi PNGs supplied by Danil (`danil-laptop`, `duo-board`, `wife-paint`, `duo-hello`, `danil-wave`) and their local WebP derivatives. The source is the approved `chibi-heroes-20261019/out/` collection. No photographs, reference sheets or external image services are included. These are likenesses of Danil and his wife; permission for these approved chibi does not extend to other images or reference material.

Dependency inventories are in [third-party-licenses](docs/third-party-licenses.md), generated from locked Cargo metadata and the npm license-checker inventory. Local workflow validation uses actionlint (MIT, via its npm WASM package); license-checker is BSD-3-Clause. These one-off tools are not runtime dependencies.

## Windows installer tools

The installer uses [NSIS](https://nsis.sourceforge.io/License) (zlib/libpng; its LZMA compression module is CPL-1.0 with a linking exception) and [nsis_tauri_utils 0.5.3](https://github.com/tauri-apps/nsis-tauri-utils/blob/nsis_tauri_utils-v0.5.3/Cargo.toml) (MIT OR Apache-2.0). Tauri downloads and verifies its official tool archives during packaging. These tools are not installed system-wide.
