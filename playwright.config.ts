import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './test-runner',
	// The sync suite (test-runner/sync/) is a separate, NON-BLOCKING lane: it hits
	// the live https://sync.signage-cdn.com server, runs serially, and is pinned to
	// the @signageos/front-display version in package.json (v14.39.0 — older builds
	// drop master ACKs and fail the whole suite). It is excluded from the default
	// run and from CI; opt in with `npm run test:sync`. See test-runner/sync/README.md
	// for the FD-version requirement and rationale.
	testIgnore: process.env.RUN_SYNC_TESTS ? undefined : ['**/sync/**'],
	// Refuse to run against a stale duration registry, whatever the entry
	// point (bare `npx playwright test`, npm scripts, headed/debug, sync).
	globalSetup: './test-runner/duration/checkDurations.setup.ts',
	timeout: 180000,
	retries: 1,
	// 2 workers, not Playwright's half-the-cores default (4 on the dev machine):
	// each test is a full SMIL player doing software video decode, and when two
	// heavy tests run concurrently they starve each other's CPU. That makes the
	// timing-threshold assertions (priority windows, monitor poll cadence) flake
	// stochastically — a different ~3-5 of a broad population each run — mostly
	// retry-recovered but occasionally 2x-failing to suite EXIT 1. Running
	// everything at --workers=1 removes the contention but ~doubles wall-clock
	// (~14m → ~25-30m), wasteful when only a handful ever flake. Instead, the
	// reliable entry point is `npm run test:reliable`: a fast parallel pass here,
	// then a SECOND pass that re-runs ONLY the failures at --workers=1 (serial,
	// no concurrency → contention gone, and the two checkBeforePlay specs that
	// share /cbp-loc/ state on the fixed port-3000 server can no longer collide).
	// A contention flake that double-fails in parallel passes when re-run alone,
	// so the serial pass rescues exactly the EXIT-1 cases at minimal extra cost.
	// History (full non-sync suite WITH the CDN asset cache, test-runner/
	// assetCache.ts): 2026-06-11 measured 2w → 0 flakes/14.4m and 4w → 1
	// retry-recovered flake/~8m; later full 2w runs surfaced the rotating
	// stochastic flakes above. Pre-cache 2026-06-10: 4w → 6 flakes/10.4m, 2w →
	// 0 flakes/15.2m. Sync tests already use --workers=1 (npm run test:sync).
	workers: 2,
	use: {
		baseURL: 'http://localhost:8090',
		viewport: { width: 1920, height: 1080 },
		headless: true,
		bypassCSP: true,
	},
	// Only the emulator is started here. Every non-sync spec — including the
	// checkBeforePlay / location-strategy / video-re-prepare specs — now starts
	// its OWN test server on a unique per-worker port (3100+) via the
	// worker-scoped fixture in test-runner/fixtures.ts. That isolates server
	// state per worker, so parallel spec files can no longer collide on a shared
	// fixed port (the former port-3000 server, removed). localServer rewrites the
	// SMIL fixtures' hard-coded localhost:3000 references to the live worker port.
	webServer: [
		{
			command: 'npm run start-emulator',
			url: 'http://localhost:8090',
			reuseExistingServer: true,
			timeout: 30000,
		},
	],
});
