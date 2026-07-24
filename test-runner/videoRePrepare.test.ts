import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

const EMULATOR_URL = 'http://localhost:8090';

/**
 * Verify that the video re-prepare fix prevents infinite hangs when a looping
 * video's source file is updated multiple times via the checkBeforePlay mechanism.
 *
 * Bug scenario (before fix):
 *   1st update → needsRePrepare → prepare(versioned_v1) → pool=2 → OK
 *   2nd update → prepare(versioned_v2) → pool=3 → "no more video players" → HANG
 *
 * The fix:
 *   - Stop stale player(s) BEFORE prepare() → frees pool slot → next prepare succeeds
 *   - Mutate params[0] to versioned URL → play()/onceEnded() match the prepared player
 *   - Persist versioned URL into value.localFilePath → subsequent loop iterations also use it
 *   - Track versioned URLs per region → enables correct cleanup chain
 *
 * Observable markers in the emulator (via @signageos/front-applet debug output). The
 * object-label token is minified and varies between front-applet builds (e.g. `t:` in
 * 8.6.0, `e:` in older builds), so `isVideoMarker()` matches the stable namespace + verb
 * + action and wildcards that token:
 *   - "success <tok>:onceEnded"               → video loop completed
 *   - "invoking <tok>:prepare" + __smil_version → re-prepare with versioned URL
 *   - "invoking <tok>:stop" after prepare       → stale player cleanup
 *   - "no more available video players"        → pool exhaustion (should NOT appear)
 */

/** Count occurrences of a substring in an array of strings */
function countMatching(messages: string[], pattern: string): number {
	return messages.filter((m) => m.includes(pattern)).length;
}

/**
 * Match a front-applet `FrontApplet:Video` debug line by verb + action, tolerant of the
 * minified object-label token. front-applet 8.6.0 logs these as `invoking t:prepare`,
 * `success t:onceEnded`, … where `t:` is a minified variable name that differs between
 * builds (older builds this test was written against used `e:`). Pinning to the stable
 * debug namespace + verb + action and wildcarding only that token keeps these assertions
 * working across front-applet version bumps. (The video itself plays fine either way —
 * the brittle part was the literal `e:` prefix, not the player.)
 */
function isVideoMarker(message: string, verb: string, action: string): boolean {
	return message.includes('FrontApplet:Video') && new RegExp(`${verb}\\s+\\w+:${action}\\b`).test(message);
}

/** Count `FrontApplet:Video` debug lines matching a verb + action. */
function countMarker(messages: string[], verb: string, action: string): number {
	return messages.filter((m) => isVideoMarker(m, verb, action)).length;
}

/** Count deferred versioned re-prepares (prepare carrying the __smil_version query param). */
function countVersionedPrepares(messages: string[]): number {
	return messages.filter((m) => isVideoMarker(m, 'invoking', 'prepare') && m.includes('__smil_version')).length;
}

/**
 * Drive `updates` consecutive checkBeforePlay file changes against a single looping
 * video and assert the player never hangs and the video-player pool never exhausts.
 *
 * The re-prepare fix must hold for every update: each switch defers a versioned
 * prepare that stops the stale player BEFORE preparing the new one (freeing the pool
 * slot), so `onceEnded` keeps firing and "no more available video players" never
 * appears. The two registered counts are not redundant — `updates=2` is the original
 * repro (the 2nd update is exactly where the pre-fix pool exhaustion hung), and
 * `updates=3` proves the pool stays bounded as updates accumulate further.
 */
async function runRePrepareUpdates(context: BrowserContext, page: Page, updates: number, baseUrl: string) {
	const SMIL_URL = `${baseUrl}/checkBeforePlayVideo.smil`;
	const TEST_SERVER = baseUrl;

	// Enable all debug logging to observe front-applet video API calls.
	await context.addInitScript(() => {
		localStorage.setItem('debug', '*');
	});
	await context.addInitScript(`window.__SMIL_URL__ = '${SMIL_URL}';`);

	const consoleMessages: string[] = [];
	page.on('console', (msg) => consoleMessages.push(msg.text()));

	// Reset server state and clear IndexedDB for a clean boot.
	await page.request.post(`${TEST_SERVER}/cbp-video/reset`);
	await page.goto(EMULATOR_URL, { waitUntil: 'load', timeout: 30000 });
	await page.evaluate(async () => {
		const dbs = await indexedDB.databases();
		for (const db of dbs) {
			if (db.name) indexedDB.deleteDatabase(db.name);
		}
	});
	await page.goto(EMULATOR_URL, { waitUntil: 'load', timeout: 30000 });

	// Wait for the video loop to stabilize (>= 2 completed loops).
	await expect(async () => {
		if (countMarker(consoleMessages, 'success', 'onceEnded') < 2) {
			throw new Error('Waiting for stable playback (>= 2 loops)');
		}
	}).toPass({ intervals: [1000], timeout: 45000 });

	console.log(`Playback stable. Running ${updates} consecutive update(s)...`);

	for (let i = 1; i <= updates; i++) {
		const resp = await (await page.request.post(`${TEST_SERVER}/cbp-video/switch`)).json();
		console.log(`Update #${i}: server version ${resp.version}`);

		// Wait for the i-th deferred versioned re-prepare to fire.
		await expect(async () => {
			const count = countVersionedPrepares(consoleMessages);
			if (count < i) throw new Error(`Versioned prepare count: ${count}, expected >= ${i}`);
		}).toPass({ intervals: [1000], timeout: 45000 });

		// THE KEY CHECK: the video keeps looping after the update (no hang). Before the
		// fix, the 2nd update exhausted the pool and `onceEnded` stopped firing here.
		const endedBefore = countMarker(consoleMessages, 'success', 'onceEnded');
		await expect(async () => {
			if (countMarker(consoleMessages, 'success', 'onceEnded') <= endedBefore) {
				throw new Error(`Video may be hung after update #${i} — onceEnded stuck at ${endedBefore}`);
			}
		}).toPass({ intervals: [1000], timeout: 20000 });

		console.log(`  Update #${i} OK — video still playing.`);
	}

	// Each update must have stopped its stale player before re-preparing (so the pool
	// never exhausts), and play() must use the versioned URL after each re-prepare.
	const totalPrepares = countVersionedPrepares(consoleMessages);
	const totalStops = countMarker(consoleMessages, 'invoking', 'stop');
	const poolErrors = countMatching(consoleMessages, 'no more available video players');
	const playWithVersion = consoleMessages.filter(
		(m) => isVideoMarker(m, 'invoking', 'play') && m.includes('__smil_version'),
	).length;

	console.log('\n--- Summary ---');
	console.log(`Versioned prepares: ${totalPrepares}`);
	console.log(`Stale player stops: ${totalStops}`);
	console.log(`Total video loops: ${countMarker(consoleMessages, 'success', 'onceEnded')}`);
	console.log(`Pool exhaustion errors: ${poolErrors}`);
	console.log(`play() with version: ${playWithVersion}`);

	expect(totalPrepares).toBeGreaterThanOrEqual(updates);
	expect(totalStops).toBeGreaterThanOrEqual(updates);
	expect(poolErrors).toBe(0);
	expect(playWithVersion).toBeGreaterThanOrEqual(updates);
}

/**
 * Both counts share one body and differ only in how many updates they drive. The
 * per-update loop verifies playback survives each change; the final assertions scale
 * with the update count.
 */
const UPDATE_COUNTS: { updates: number; title: string }[] = [
	{ updates: 2, title: 'no hang after 2 file updates in a single-video loop (original repro)' },
	{ updates: 3, title: 'pool stays bounded after 3 consecutive file updates' },
];

test.describe('video re-prepare', () => {
	for (const { updates, title } of UPDATE_COUNTS) {
		test(title, async ({ context, page, testServerBaseUrl }) => {
			await runRePrepareUpdates(context, page, updates, testServerBaseUrl);
		});
	}
});
