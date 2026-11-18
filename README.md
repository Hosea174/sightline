# Sightline

A local-first visual research library for websites, screenshots, motion and fonts. This is an early prototype; see the limitations below before relying on it for irreplaceable material.

## Run

Requirements: Bun, Rust with the Windows MSVC toolchain, Microsoft C++ build tools, WebView2, and FFmpeg on PATH. Run `bun install --frozen-lockfile` and `bun run tauri dev`. Choose a local library folder on first launch; `library.json`, a previous-index backup, `assets/`, and cached `favicons/` live inside it. You can place the library in a Google Drive for desktop synced folder. Use the library on only one computer at a time, let Drive finish syncing before moving it, and make independent backups.

Imported screenshots are converted to WebP and videos to H.264 MP4 when the converted file is smaller. MOV and MKV videos are converted to MP4 for playback even if the output is larger. Unsupported formats are copied unchanged. Originals selected for import are never modified. FFmpeg runs in a background worker.

Create sources, edit tags and notes, import media, search, filter by category, tags and approximate extracted color, sort sources, adjust thumbnail size, shuffle, preview media and link imported fonts to multiple sources. New visual imports receive small previews and a sampled palette. Cards let you choose a cover from their visual assets. Favicons are fetched from the source website when available. The canvas groups visual assets by website URL, supports touchpad pan and pinch zoom, and saves positions; double-click a visual to preview it.

## Browser capture

Load `extension/` unpacked in Chrome or Brave, then install the native messaging host once for that extension ID: build it with `cargo build --release --manifest-path src-tauri/Cargo.toml --bin sightline-bridge` and run `powershell -ExecutionPolicy Bypass -File scripts/install-bridge.ps1 -ExtensionId YOUR_EXTENSION_ID`. The ID is displayed on the browser extension page with developer mode enabled. Repeat registration if the extension ID or project path changes. Open the current Sightline desktop app and select a library before sending captures; the app publishes the inbox location to the bridge. Capture files are streamed through native messaging to the existing operating-system Downloads/Sightline/inbox without invoking the browser download manager, so its download prompt and custom download folder do not affect capture. Sightline imports them when open and removes inbox files only after saving its index. Browser permissions authorize only the registered extension ID.

Right-click an image and choose Save image to Sightline to queue it with its source page. The popup has visible, area and full-page screenshots, recording and font discovery. Full-page and scrolling area capture scroll the active tab and restore its position after capture; keep the tab active during capture. Screenshots and clips offer source name, link, tags and category before saving. The recording editor supports dragging clips and trim handles, playhead scrubbing, Q/W trim, Ctrl+Alt+B split, Delete, arrow keys, Ctrl+Alt+Left/Right, Home/End and Space; Ctrl+Z and Ctrl+Shift+Z undo and redo. It retains the original recording in browser storage. The bridge renders selected segments with FFmpeg and queues the resulting MP4 for the desktop app; the save status distinguishes a queued capture from a completed import. Tag suggestions and matching source tags and category come from the selected library. Pages on the same website are grouped, while social posts use their individual URLs.

## Editing and Trash

Open a video from its source and press Ctrl+Backtick to show the video timeline. Drag clip edges to trim, split at the playhead, or drag the top of a clip to change its speed. Save clip renders a new asset next to the original. Ctrl+Shift+Period toggles drawing annotations in Sightline and both browser editors. The keyboard icon opens the shortcut guide.

A clip imported from the extension has an Open clip action in Sightline that selects the exact asset in its source. The extension editor also offers Open clip when Sightline is running. Font capture saves the variants it can find, and font cards expose available weights as pills.

Trash moves unshared assets and their previews into the library's `trash/` folder. Restore returns them to their original paths. Clear Trash permanently deletes the items after confirmation. Sightline clears expired items after 30 days. Ctrl+Z restores a recent Trash move or undoes a Discover visit.

## Code layout

`src/` is the React desktop UI and shared component library. `src-tauri/src/` contains the library, video export, and filesystem operations. `extension/` contains the browser editor, popup, and capture workers. The `sightline-bridge` Rust binary connects the two through native messaging. Build and reload the unpacked extension after changing its UI.

## Known limitations

- Native desktop and real browser capture flows, have not yet passed a real browser-to-library end-to-end test. Review your captures before deleting originals or depending on them.
- Area capture starts on the website: drag to select and hold near the viewport edge to scroll, then review the captured region in the editor. Full-page capture stitches scroll positions and is limited by page and image dimensions; dynamic pages, nested scroll areas and protected browser pages may not capture correctly. Recording is tab video only, with no audio, and stores recording chunks in IndexedDB as it records. Reviewing and exporting can still consume significant memory. Discarding an edit keeps the original in Saved recordings.
- Font discovery is best-effort: cross-origin stylesheets, obfuscated names, unavailable files, and web-font subsets can limit results. Windows font installation supports TTF and OTF; WOFF/WOFF2 files can be saved and previewed but not directly installed. Installation has not been tested end to end.
- Color filtering uses a small sampled palette and is approximate. Existing assets from before palette generation are not indexed automatically. Large-library performance work and a full Google Drive restore test remain to be done. Font assets are excluded from the canvas.
- The library index is JSON, not SQLite. Writes are serialized by the UI, committed by rename, and keep the previous index. Drive is a synchronization tool, not versioned backup; copy the entire folder independently and do not open one library from multiple machines simultaneously.
- GIF, SVG, and fonts are preserved as imported. There is no guaranteed compression ratio. If FFmpeg fails, the capture remains in the inbox and the original selected file stays untouched.

## Checks

Run `bun run build` for the frontend, `bun test logic.test.ts` for grouping and search checks, `node test-capture.mjs` and `python test-bridge.py` for the capture and native bridge checks, and `node test-recorder.mjs`, `node test-timeline.mjs`, `node test-tags.mjs`, and `node test-capture-native.mjs`, and `node test-full-page.mjs` for recording, timeline, tags, bridge and scrolling capture checks. The native app requires `bun run tauri dev` and an end-to-end capture test on a machine with a complete MSVC toolchain.

On this machine the Visual C++ Build Tools are installed and `cargo check --manifest-path src-tauri/Cargo.toml` passes.



### Post Ideas

Choose the **Post Ideas** category in the library to save links, notes, images, videos, or a combination. Social post links attempt a media download after saving; use **Download post media** in the inspector to retry. The link remains saved if the download fails. Downloads use [gallery-dl](https://github.com/mikf/gallery-dl); install it with `python -m pip install --user gallery-dl` and make sure Python is on PATH. Some sites require an authenticated gallery-dl session or cookies; see its [authentication instructions](https://github.com/mikf/gallery-dl/wiki/Authentication). Imported media is stored in your library.

## Discover catalog

Discover initializes a writable catalog in Sightline's application data directory from the bundled catalog. A refresh merges the current Lapa Ninja RSS feed, recent Bookmarkify listings, and new entries from the third-party Awwwards SOTD index by destination and source URL; it does not delete entries, including websites hidden through the context menu. The Refresh button checks these sources immediately, and Discover checks again when opened or reconnected after 24 hours. Failed individual entries are reported and retried. The feed is finite; if there is no overlap with the stored catalog, the status warns that older entries may be missing. Python is required for this refresh. On Windows, opening Discover registers a login shortcut, an hourly check, and a Windows network-connect trigger; the hourly task refreshes only when at least 24 hours have passed since the last successful check. An offline computer is checked at login and when Windows reports a network connection; the hourly check is a fallback. The app reports when the SOTD index is stale; other sources are not yet implemented.

The color filter uses up to two source-provided Awwwards colors where available and can read separately checkpointed live-page colors from application data. Live colors are estimates from visible computed page styles, not certified branding. `scripts/discover-colors.py` merges those colors from the index into a catalog. `scripts/discover-brand-colors.py` can enrich remaining sites via Context.dev after an API key and call limit are provided; it uses no thumbnail-derived colors. Brand lookups consume service credits. Visited and removed state remains in the local webview. The Backup and Restore controls include it, the catalog, palettes, and the library in explicit snapshots stored in a user-selected Google Drive for desktop folder. Drive for desktop handles uploading those files. Restores require an empty target folder and preserve existing local data. This is manual snapshot backup and restore, not automatic two-way sync.

### Asset annotation data

Annotations are saved as structured objects in each asset's `annotations` array in `library.json`, alongside its `tags` and `notes`. Each annotation has a stable `id`, `text`, and normalized coordinates `x`, `y`, `w`, and `h` (fractions of the saved media dimensions; zero width and height indicate a point). Video annotations also have `start` and `end` in seconds relative to the saved video. The active interval is inclusive at its endpoints. Image annotations have no time range. Older video annotations may have a single `time` field; the app displays them around that timestamp and converts them to a range when edited. When capture clips are trimmed or reordered, ranges are mapped to the saved video's timeline; an annotation crossing removed material may become multiple objects with unique IDs.


### UI foundation and extension builds

Sightline now uses the [tauri-ui](https://github.com/agmmnn/tauri-ui) foundation: official shadcn/ui components and Radix primitives. Both desktop and browser extension import `src/theme.css` and `src/components/ui`. Custom capture, timeline and visual-library layouts use those same semantic tokens. HeroUI and the previous stylesheet layers have been removed.

`bun run build` builds the desktop frontend and the React extension UI. Use `bun run build:extension` when only updating the extension. Load `extension/` as an unpacked extension after building; the HTML pages load their generated `extension/ui` assets. Reopen the popup or reload the extension after a UI update. Capture, native messaging and recording storage keep their existing implementation.
