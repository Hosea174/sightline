# Sightline

A local-first visual research library for websites, screenshots, motion and fonts. This is an early prototype; see the limitations below before relying on it for irreplaceable material.

## Run

Requirements: Bun, Rust with the Windows MSVC toolchain, Microsoft C++ build tools, WebView2, and FFmpeg on PATH. Run `bun install` and `bun run tauri dev`. Choose a local library folder on first launch; `library.json`, a previous-index backup and `assets/` live inside it. You can place the library in a Google Drive for desktop synced folder. Use the library on only one computer at a time, let Drive finish syncing before moving it, and make independent backups.

Imported screenshots are converted to WebP and videos to H.264 MP4 when the converted file is smaller. MOV and MKV videos are converted to MP4 for playback even if the output is larger. Unsupported formats are copied unchanged. Originals selected for import are never modified. FFmpeg runs in a background worker.

Create sources, edit tags and notes, import media, search, filter by category, tags and approximate extracted color, sort sources, adjust thumbnail size, shuffle, preview media and link imported fonts to multiple sources. New visual imports receive small previews and a sampled palette. The canvas shows visual assets linked to their source and saves their positions; double-click a visual to preview it.

## Browser capture

Load `extension/` unpacked in Chrome or Brave, then install the native messaging host once for that extension ID: build it with `cargo build --release --manifest-path src-tauri/Cargo.toml --bin sightline-bridge` and run `powershell -ExecutionPolicy Bypass -File scripts/install-bridge.ps1 -ExtensionId YOUR_EXTENSION_ID`. The ID is displayed on the browser extension page with developer mode enabled. Repeat registration if the extension ID or project path changes. Open the current Sightline desktop app and select a library before sending captures; the app publishes the inbox location to the bridge. Capture files are streamed through native messaging to the existing operating-system Downloads/Sightline/inbox without invoking the browser download manager, so its download prompt and custom download folder do not affect capture. Sightline imports them when open and removes inbox files only after saving its index. Browser permissions authorize only the registered extension ID.

The popup has visible, area and full-page screenshots, recording and font discovery. Full-page capture scrolls the active tab and restores its position; keep the tab active during capture. Screenshots and clips offer source name, link, tags and category before saving. The recording editor supports dragging clips and trim handles, playhead scrubbing, Q/W trim, Ctrl+Alt+B split, Delete, arrow keys, Ctrl+Alt+Left/Right, Home/End and Space; Ctrl+Z and Ctrl+Shift+Z undo and redo. It retains the original recording in browser storage. The bridge renders selected segments with FFmpeg and queues the resulting MP4 for the desktop app; the save status distinguishes a queued capture from a completed import. Tag suggestions and matching source tags and category come from the selected library. Pages on the same website are grouped, while social posts use their individual URLs.

## Known limitations

- Native desktop and real browser capture flows, have not yet passed a real browser-to-library end-to-end test. Review your captures before deleting originals or depending on them.
- Area capture selects a region from the visible viewport. Full-page capture stitches scroll positions and is limited by page and image dimensions; dynamic pages, nested scroll areas and protected browser pages may not capture correctly. Recording is tab video only, with no audio, and stores recording chunks in IndexedDB as it records. Reviewing and exporting can still consume significant memory. The review screen keeps the original recording until you delete it.
- Font discovery is best-effort: cross-origin stylesheets, obfuscated names, unavailable files, and web-font subsets can limit results. Windows font installation supports TTF and OTF; WOFF/WOFF2 files can be saved and previewed but not directly installed. Installation has not been tested end to end.
- Color filtering uses a small sampled palette and is approximate. Existing assets from before palette generation are not indexed automatically. Large-library performance work and a full Google Drive restore test remain to be done. Font assets are excluded from the canvas.
- The library index is JSON, not SQLite. Writes are serialized by the UI, committed by rename, and keep the previous index. Drive is a synchronization tool, not versioned backup; copy the entire folder independently and do not open one library from multiple machines simultaneously.
- GIF, SVG, and fonts are preserved as imported. There is no guaranteed compression ratio. If FFmpeg fails, the capture remains in the inbox and the original selected file stays untouched.

## Checks

Run `bun run build` for the frontend, `bun test logic.test.ts` for grouping and search checks, `node test-capture.mjs` and `python test-bridge.py` for the capture and native bridge checks, and `node test-recorder.mjs`, `node test-timeline.mjs`, `node test-tags.mjs`, and `node test-capture-native.mjs`, and `node test-full-page.mjs` for recording, timeline, tags, bridge and scrolling capture checks. The native app requires `bun run tauri dev` and an end-to-end capture test on a machine with a complete MSVC toolchain.

On this machine the Visual C++ Build Tools are installed and `cargo check --manifest-path src-tauri/Cargo.toml` passes.


