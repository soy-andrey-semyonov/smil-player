import { test as base } from '@playwright/test';
import { installAssetCache } from './assetCache';
import { captureDomState, createConsoleCollector } from './helpers';
import { createTestServer } from '../test-server/localServer';
import { getSmilUrls, SmilUrlsMap } from './config';
import { startVisibilityMonitor, VisibilityMonitor } from './visibilityMonitor';
import { startLivenessMonitor } from './livenessMonitor';

/**
 * Fatal error patterns that fail any non-sync test automatically. Matched
 * against console messages collected during the test (page.on('console') and
 * page.on('pageerror') via `createConsoleCollector`). Only application-side
 * uncaught errors should appear in this list — transient resource warnings
 * or network 404s do not belong here.
 *
 * Tests with a known-safe error that happens to match one of these patterns
 * can suppress it by appending to the per-test `allowedErrors` fixture
 * option:
 *
 *   test.use({ allowedErrors: [/known-benign-substring/i] });
 *
 * Default is empty — i.e. every pattern below is fatal unless the test
 * opts out. Keep that default empty unless you observe a recurring
 * false-positive across many tests; per-test suppression is preferred.
 */
const FATAL_PATTERNS = [
	/Uncaught TypeError/,
	/Uncaught SyntaxError/,
	/Uncaught ReferenceError/,
	/Uncaught RangeError/,
	/Cannot read properties of/,
	/is not a function/,
	/is not defined/,
];

const BASE_PORT = 3100;

type WorkerFixtures = {
	testServerPort: number;
	smilUrls: SmilUrlsMap;
	testServerBaseUrl: string;
};

type TestFixtures = {
	allowedErrors: RegExp[];
	/**
	 * Per-test opt-out: non-empty substrings of video src to exclude from
	 * frozen-video detection. An empty string matches every src (`includes('')`)
	 * and would suppress all detection — pass specific filename substrings.
	 */
	allowFrozenVideos: string[];
	/** 'report' attaches frozen-video flags without failing; 'enforce' throws on them. */
	frozenVideoMode: 'enforce' | 'report';
	/**
	 * Per-test visibility-duration monitor attached to `page` and its applet
	 * iframe. Auto-starts on test entry and auto-stops on teardown. Tests
	 * declare candidates via `monitor.watch([...])` and assert at the end via
	 * `await monitor.assertDurationsWithinTolerance()`. Tests that don't care
	 * about durations can ignore this fixture entirely — its polling overhead
	 * is negligible (~10 evals/sec on one page).
	 *
	 * For multi-page sync tests, do NOT use this fixture; use
	 * `device.monitor` on each `SyncDevice` returned by `addSyncDevice`.
	 */
	monitor: VisibilityMonitor;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
	// Worker-scoped: start a test server per worker on a unique port
	testServerPort: [async ({}, use, workerInfo) => {
		const port = BASE_PORT + workerInfo.workerIndex;
		const server = await createTestServer(port).start();
		await use(port);
		await server.close();
	}, { scope: 'worker' }],

	smilUrls: [async ({ testServerPort }, use) => {
		await use(getSmilUrls(testServerPort));
	}, { scope: 'worker' }],

	testServerBaseUrl: [async ({ testServerPort }, use) => {
		await use(`http://localhost:${testServerPort}`);
	}, { scope: 'worker' }],

	allowedErrors: [[], { option: true }],
	allowFrozenVideos: [[], { option: true }],
	frozenVideoMode: [
		// Default ENFORCE: a video stuck on its last frame longer than the flat 2s
		// tolerance fails its test. FROZEN_VIDEO_MODE=report downgrades a run to
		// attach-only (flags recorded, no failure).
		//
		// KNOWN INTENTIONAL FAILURE: conditionalMediaElement.test.ts trips this on a
		// real par-repeat-indefinite player freeze (3 of 4 regions freeze on their
		// last frame after one pass). It is deliberately NOT opted out — the failure
		// is the forcing function for the player fix. See
		// docs/superpowers/plans/2026-06-30-par-repeat-indefinite-freeze-fix.md.
		process.env.FROZEN_VIDEO_MODE === 'report' ? 'report' : 'enforce',
		{ option: true },
	],

	context: async ({ context }, use) => {
		// CDN asset cache: each test's fresh context starts with an empty HTTP
		// cache, so without interception every test re-downloads all fixture
		// media (~7MB). See test-runner/assetCache.ts.
		await installAssetCache(context);
		await use(context);
	},

	page: async ({ page, request, testServerBaseUrl, allowedErrors, allowFrozenVideos, frozenVideoMode }, use, testInfo) => {
		// Test-run isolation: Playwright's default per-test `context` fixture
		// gives a fresh BrowserContext, which isolates indexedDB / localStorage /
		// cookies at both the emulator (:8090) and applet (:8091) origins. That
		// is why we do not need a goto+clear+goto storage wipe here — verified
		// empirically 2026-04-15 (see docs/superpowers/plans/2026-04-15-stability-
		// edge-case-roadmap.md Task 1A). Don't share contexts across tests.
		const collector = createConsoleCollector(page);
		// FD emulator cold-boot watchdog (root-caused 2026-07-05): on a fast,
		// idle-machine first boot, front-display 14.39.0 fetches its device
		// configuration and then never mounts the applet iframe — the SMIL
		// player never runs and the test times out on its first-element assert
		// (~75% hit rate for the first test of a cold worker on an idle
		// machine; invisible under suite load, which is why full gates stayed
		// green for months). Wrap goto: after navigating to the emulator, wait
		// for the applet iframe to attach and reload once if it never does.
		// 20s covers the healthy mount (~5-8s, longer under load) with margin;
		// the iframe is the applet's container and mounts before SMIL fetching,
		// so its presence is independent of fixture validity (brokenXml etc.).
		const rawGoto = page.goto.bind(page);
		page.goto = async (url, options) => {
			const response = await rawGoto(url, options);
			const appletMounted = await page
				.waitForSelector('iframe', { state: 'attached', timeout: 20_000 })
				.then(() => true)
				.catch(() => false);
			if (!appletMounted && !page.isClosed()) {
				// eslint-disable-next-line no-console
				console.log('[boot-watchdog] applet iframe missing 20s after goto — reloading emulator page');
				await page.reload();
			}
			return response;
		};
		// Reset test server state before each test to prevent interference
		await request.post(`${testServerBaseUrl}/reset`);
		const liveness = startLivenessMonitor(page);
		await use(page);
		await liveness.stop();
		// On failure, attach the live media DOM state. Playwright's aria
		// snapshot omits src attributes, which is exactly what distinguishes
		// "wrong element playing" from "right element, broken asset" when a
		// visibility assert times out (cf. priorityLowerStop, 2026-06-11).
		if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
			const state = await captureDomState(page).catch(() => null);
			if (state) {
				await testInfo.attach('media-state-at-failure', {
					body: JSON.stringify(state, null, '\t'),
					contentType: 'application/json',
				});
			}
		}
		// Teardown: check for fatal JS errors captured during the test
		const fatal = collector.errors.filter((err) =>
			FATAL_PATTERNS.some((p) => p.test(err))
			&& !allowedErrors.some((p) => p.test(err)),
		);
		if (fatal.length > 0) {
			throw new Error(
				`Test produced ${fatal.length} fatal JS error(s):\n`
				+ fatal.map((e) => `  - ${e}`).join('\n'),
			);
		}
		// Frozen-video detection (report-only by default). Gated on the test
		// having otherwise passed — mirrors the failure-attach guard above so we
		// don't pile onto an already-failing test or analyze a half-torn-down page.
		if (testInfo.status === testInfo.expectedStatus) {
			const frozen = liveness
				.getFrozenFlags()
				.filter((f) => !allowFrozenVideos.some((s) => f.src.includes(s)));
			if (frozen.length > 0) {
				await testInfo.attach('frozen-videos', {
					body: JSON.stringify(frozen, null, '\t'),
					contentType: 'application/json',
				});
				if (frozenVideoMode === 'enforce') {
					throw new Error(
						`Detected ${frozen.length} frozen video(s):\n`
						+ frozen.map((f) => `  - ${f.src} ${f.reason}`).join('\n'),
					);
				}
			}
		}
	},

	monitor: async ({ page }, use) => {
		const m = startVisibilityMonitor(page, page.frameLocator('iframe'), []);
		await use(m);
		await m.stop();
	},
});

export { expect } from '@playwright/test';
