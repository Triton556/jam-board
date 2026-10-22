# Preview deadline evidence correction (alpha38)

The exact alpha37 [hosted run39797996038](https://github.com/Triton556/jam-board/actions/runs/39797996038)
failed the unchanged Windows stalled-preview test: whole call5.3127815s,
accepted-connection→EOF4.6921784s,89 request bytes and clean client EOF. The
accepted-socket clock fell below its4.8s lower assertion. This demonstrates that
the observer's interval is not an exact sample of curl's transfer clock; it does
not identify which scheduling/startup stage caused that run's discrepancy.

The correction does **not** expand the production deadline or skip the live case:

- Production uses the same private command builder and unchanged ordered argv:
  `--disable` first, one `--max-time 5`, three redirects,2MiB cap, HTTP(S)-only
  source/redirect protocols and the existing HTML header/URL arguments. A unit
  test compares the complete argv, preventing a later duplicate override.
- Only curl exit28 now produces the specific timeout validation reason. Pure
  cases22,56 and missing exit code retain the generic failure; no stderr, page
  body or URL is added to the error. This is a small runtime error-classification
  change, not merely a test edit.
- The real Store/loopback test still requires the expected GET, client EOF while
  the peer stays silent, the exact timeout result and an unchanged complete
  canvas. Its5.4s socket watchdog remains failure-only cleanup. No test passes
  because the peer closed at a timer. Both elapsed samples remain diagnostics;
  their invalid4.8–5.4s acceptance window is replaced by configured-boundary and
  actual-outcome evidence, not widened.

This follows curl's documented [per-transfer max-time](https://curl.se/docs/manpage.html#-m)
and [exit28 timeout meaning](https://ec.haxx.se/cmdline/exitcode.html). It is not a
claim of scheduler-independent wall-clock completion for an external process.

On the integrated Linux source, formatting, Clippy with warnings denied, all178
Rust tests (three pre-existing opt-in cases unrun), actual binding export with
identical output, and isolated alpha38 stdio smoke passed. Windows hosted
verification of this correction is pending; the preceding alpha37 run remains
failed and is not relabeled.
