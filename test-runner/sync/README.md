# Sync test suite

These specs exercise multi-device **synchronized playback** against the live
signageOS sync server. They are a separate, opt-in, **non-blocking** lane —
deliberately excluded from the default test run and from CI, and run manually
(suitable for a nightly / non-gating job).

## Why it's a separate, non-blocking lane

- **Live network dependency.** Every spec talks to the live
  `https://sync.signage-cdn.com` server (`../syncHelpers.ts`
  `DEFAULT_SYNC_SERVER_URL`). There is no local stand-in, so the suite is slow,
  serial, and sensitive to that server's jitter — the skew tolerances in
  `syncAssertions.ts` are sized to accommodate network and polling jitter.
- **Excluded by default.** `playwright.config.ts` ignores `test-runner/sync/**`
  unless `RUN_SYNC_TESTS` is set, so a bare `npx playwright test` and
  `npm run test:reliable` never touch this suite.
- **Not in CI.** `.gitlab-ci.yml` runs only the shared lib pipeline and the
  documentation triggers; the sync suite is never run there and never gates a
  merge.

## Required FieldDeployment version

The suite is **pinned to the `@signageos/front-display` version in
`package.json` (`v14.39.0`)**. This is load-bearing, not incidental:

- On **v14.39.0** the master receives device ACKs — the protocol the
  spread/tuple assertions in `syncAssertions.ts` rely on. All sync specs pass.
- On **v14.33.0** the master received **0** ACKs (only `signal-ready-*`), and
  the whole suite failed for a reason unrelated to the code under test.

After changing the `@signageos/front-display` version you **must rebuild and
restart the emulator** before this suite is meaningful again.

## Running it

```bash
npm run test:sync
# = cross-env RUN_SYNC_TESTS=1 playwright test test-runner/sync --workers=1 --timeout=300000
```

Always `--workers=1` (the script enforces it). The specs share the live sync
server and the per-worker local test server (ports 3100+), so **never run two
sync suites concurrently** — overlapping runs collide on the live group state
and on the local ports (`EADDRINUSE`).
