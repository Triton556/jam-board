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
| dnd-kit, Motion, react-hook-form, hookform/resolvers, Zod | MIT |
| react-markdown, remark-gfm, roughjs | MIT |
| Lucide | ISC |
| Testing Library, happy-dom | MIT |
| Playwright | Apache-2.0 |
| sharp | Apache-2.0 (bundled libvips: LGPL-3.0-or-later) |
| Fontsource package tooling | MIT |

Self-hosted fonts: Fraunces (Undercase Type), Manrope (Mikhail Sharanda and contributors), JetBrains Mono (JetBrains), Caveat (Pablo Impallari and contributors). Font artwork is distributed under SIL Open Font License 1.1; license notices are included in `apps/desktop/src/assets/licenses/`. Fonts are the explicitly specified artwork assets, not a replacement software dependency.

The sticker/J/star icon is original vector artwork for Jam Board, generated to platform sizes by the Tauri CLI. The five chibi illustrations (`danil-laptop`, `duo-board`, `wife-paint`, `duo-hello`, `danil-wave`) are original artwork supplied by the author, with local WebP derivatives. They are stylized likenesses used with permission and are not licensed for reuse outside this project. No photographs or external image services are included.

Dependency inventories are in [third-party-licenses](docs/third-party-licenses.md), generated from locked Cargo metadata and the npm license-checker inventory. Local workflow validation uses actionlint (MIT, via its npm WASM package); license-checker is BSD-3-Clause. These one-off tools are not runtime dependencies.

## Windows installer tools

The installer uses [NSIS](https://nsis.sourceforge.io/License) (zlib/libpng; its LZMA compression module is CPL-1.0 with a linking exception) and [nsis_tauri_utils 0.5.3](https://github.com/tauri-apps/nsis-tauri-utils/blob/nsis_tauri_utils-v0.5.3/Cargo.toml) (MIT OR Apache-2.0). Tauri downloads and verifies its official tool archives during packaging. These tools are not installed system-wide.
