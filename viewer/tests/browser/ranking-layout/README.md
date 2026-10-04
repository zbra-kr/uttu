# Ranking layout offline browser fixture

This renders the real Ranking page, RankingDailyProvider, ShellClient, Topbar and NoteDrawer with actual application CSS. Only navigation, onboarding, auth/query and network boundaries are replaced. Data is synthetic; writes throw, and external fetches throw. This is component/layout QA, not authenticated API or Production acceptance.

Build from repository root with an installed esbuild module:

    ESBUILD_MODULE=/absolute/path/to/esbuild node viewer/tests/browser/ranking-layout/build.cjs /tmp/ranking-layout

Serve that output directory on localhost with SPA fallback and open `/ranking`. `window.rankingFixture` exposes read counts, blocked writes, errors, `navigate(path)` and `sourceURL()` (a real serialized source-context/note link).

Verify 1440/1036/860/768/390 widths: root fits, 1440 table has no horizontal scroll, narrow tables scroll with keyboard and horizontal wheel, header/row columns align, pagination stays fixed at maximum table scroll, daily card and controls render, dropdowns open, drawers open/close, and local Back returns to Ranking. At 390 also visit `sourceURL()` to exercise the compact desktop table and existing note. Ordinary mobile uses a different component. Desktop resizing should keep the initial Ranking/daily read counts unchanged; switching viewport component or source scope/remounting may cause existing fresh reads. Never use this fixture to infer live API success or to publish an artifact.

Durable SSR regression coverage is in `tests/teams-ranking-context.test.cjs`: 120-row desktop and mobile source-context cases assert pagination outside the horizontal scrollport and the respective 840/904 minima.
