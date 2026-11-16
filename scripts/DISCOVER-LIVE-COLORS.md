# Live DOM color collection

Run `python scripts/discover-live-colors.py` to inspect the catalog, or add
`--limit N` for a bounded batch. `--workers` controls isolated agent-browser
sessions (default 6); `--timeout` sets the page timeout. Accepted results go to
`public/study-sites-live-colors.json`, with an atomic resumable checkpoint at
`public/study-sites-live-colors.json.checkpoint.json`. Sites with existing catalog colors are skipped. The catalog is not changed. Failed and low-confidence sites are retried next run.

The collector samples computed background, text, and border colors from visible
elements in the initial viewport. It weights visible area and interactive/brand
roles, groups near shades in OKLab/hue families, and emits up to two confident
representatives. It uses agent-browser's own isolated named sessions, not a
user's shared browser. No screenshots or catalog thumbnails are read.

Performance is network/page-load bound: each worker owns one browser session and
processes pages sequentially; increase workers cautiously for heavier sites.
This is a fast first-viewport heuristic, not a full-page brand audit: colors
only present in images, gradients, canvas/video, scrolled sections, or unusual
CSS color syntaxes may be missed. Neutral-only pages and weak evidence are
intentionally skipped; failures remain eligible for retry.

Checks: `python scripts/discover-live-colors.py --self-test` covers shade-family
grouping, representative weighting, and neutral rejection. A live 10-site
sample accepted 3 results (Agrumea Farm `#e94e1b`, Grids `#399bff`, DeepBook
`#1e6ef3`); seven low-confidence or failed pages were left out for retry. A
brand sanity check returned Lacoste Ace Breaker's expected green family
(`#00503c`); Google Design, Nike Winter, and Spotify Wrapped Party were skipped
because their initial viewports did not provide confident chromatic evidence.
