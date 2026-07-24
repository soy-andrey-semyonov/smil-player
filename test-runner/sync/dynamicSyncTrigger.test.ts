import { test, expect } from '../fixtures';
import { Page } from '@playwright/test';
import { addSyncDevice, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import { waitForConsolePattern } from '../helpers';
import { ElementCandidate, getVisibleElement, waitForMasterElection } from './syncAssertions';

// One full SMIL cycle ≈ 18 s (img_1 6s + img_4 6s + img_2 6s under healthy timing).
// Multi-cycle assertions verify the cycle-2-emit-fails-with-51103 regression
// (caused by SocketSynchronizer re-issuing 'join_group' for an already-joined
// group) does not return.
const REQUIRED_EMIT_CYCLES = 3;
// 3 cycles × ~18s each = ~54s baseline. Allow 120s of slack for prefetch,
// election, content cleanup overhead, and known cycle-2 master-only cancel
// jitter that can stretch the inter-cycle gap.
const MULTI_CYCLE_TIMEOUT_MS = 120_000;

// Dynamic-trigger sync uses simple `sos.sync.broadcastValue` (no ACK round-trip),
// so receipt + handleDynamicPlaylist latency dominates. 1500ms = 50% headroom over
// basicSyncDiagnostic's calibrated 1000ms ceiling (which uses the ACK protocol).
// Calibrate down once stable observations land.
const MAX_SKEW_MS = 1500;

// File-naming reminder: the player stores assets under deterministic-checksum
// names (e.g. `img_1.jpg` → `img_1_<hash>.jpg`) and serves them from indexedDB,
// so DOM `src` attributes look like `…/img_1_d2388dc8.jpg`. Locator substrings
// therefore must NOT include the `.jpg` extension; trailing `_` disambiguates
// `img_1_` from a hypothetical `img_10_`.

test.describe.configure({ mode: 'serial' });
test.describe('dynamic sync trigger', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('master emit broadcasts to slave; both punch in synchronized then resume independent', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		const groupName = uniqueGroupName(testInfo.title);
		const masterUrl = `${testServerBaseUrl}/syncFiles/dynamicSyncTriggerMaster.smil`;
		const slaveUrl  = `${testServerBaseUrl}/syncFiles/dynamicSyncTriggerSlave.smil`;

		// Per-device SMILs (different fixtures). createSyncGroup broadcasts one URL
		// to all devices, so we add devices individually with a 1500ms stagger to
		// match createSyncGroup's default launch cadence.
		const master = await addSyncDevice(browser, 0, { smilUrl: masterUrl, groupName });
		await new Promise((r) => setTimeout(r, 1500));
		const slave  = await addSyncDevice(browser, 1, { smilUrl: slaveUrl,  groupName });
		devices = [master, slave];

		// Sync infra alive: someone became master of the auto-joined
		// ${groupName}-fullScreenTrigger group (created by
		// joinAllSyncGroupsOnSmilStart for the inner sync="true" region).
		await waitForMasterElection(devices, 60_000);

		// Iframe locators — images render inside the applet iframe per
		// established convention (videos render on main page; images inside iframe).
		// Substring matches use trailing `_` to absorb the player's hash suffix.
		const f = (d: SyncDevice) => d.page.frameLocator('iframe');
		const masterPreEmit  = f(master).locator('img[src*="img_1_"]');     // before emit
		const masterDynamic  = f(master).locator('img[src*="img_4_"]');     // synced punch-in
		const masterPostEmit = f(master).locator('img[src*="img_2_"]');     // after emit
		const slaveDynamic   = f(slave).locator('img[src*="img_5_"]');      // synced punch-in
		// Slave autonomous candidates — multiple frames live in DOM concurrently
		// (prefetched), only one visible at a time. Use getVisibleElement (polled)
		// instead of an `.or()` chain because strict-mode toBeVisible fails when
		// the OR locator resolves to >1 element in DOM.
		const slaveAutonomousCandidates: ElementCandidate[] = [
			{ name: 'img_3',      locator: (p: Page) => p.frameLocator('iframe').locator('img[src*="img_3_"]') },
			{ name: 'landscape1', locator: (p: Page) => p.frameLocator('iframe').locator('img[src*="landscape1_"]') },
			{ name: 'landscape2', locator: (p: Page) => p.frameLocator('iframe').locator('img[src*="landscape2_"]') },
		];

		// Visibility-duration monitoring. SMIL declares: master img_1/img_2/img_4
		// = 6s each; slave img_3/landscape1/landscape2 = 4s each, img_5 = 6s.
		// Punch-in elements (img_4, img_5) are deterministic — must hit dur on
		// every observed cycle. Autonomous slots may be cut once apiece when
		// the emit boundary lands mid-display, so allow `maxOutliers=1`.
		// Default tolerance 800ms matches observe-dynamic-sync.mjs's
		// STUTTER_TOLERANCE_MS.
		//
		// m_img_1 / m_img_4 / s_img_5 get a wider per-candidate toleranceMs:1500
		// because the sync-coordination round-trip (coordinatePlaySync start
		// barrier + coordinateFinishSync finish-ACK, ~1000–1150ms total) lands
		// *inside* their visible window — m_img_1 holds the screen through the
		// punch-in's start barrier, m_img_4 / s_img_5 hold it through the
		// finish-ACK. That overhead is correct gapless behaviour, not a stutter,
		// so it must not fail the duration assertion. The autonomous 4s slave
		// slots carry no coordination overhead and stay at the strict 800ms.
		//
		// We don't set `minOccurrences` (default 1) because the multi-cycle
		// guarantee is already enforced by waitForConsolePattern below; the
		// monitor's job here is per-cycle duration accuracy. The join-N log
		// also fires during cycle N's *prep* window — before the visible
		// transition to img_4 — so any of img_1/img_2/img_4 may be the slot
		// currently on-screen when the asserts fire, with a variable cycle
		// count for the in-progress slot. Forcing a uniform count creates
		// false failures without catching new regressions.
		master.monitor.watch([
			{ key: 'm_img_1', layer: 'frame', srcContains: 'img_1_', expectedSec: 6, toleranceMs: 1500, maxOutliers: 1 },
			{ key: 'm_img_4', layer: 'frame', srcContains: 'img_4_', expectedSec: 6, toleranceMs: 1500, maxOutliers: 0 },
			{ key: 'm_img_2', layer: 'frame', srcContains: 'img_2_', expectedSec: 6, maxOutliers: 1 },
		]);
		slave.monitor.watch([
			// Autonomous candidates: any given candidate may be visible only
			// once (depending on slave-startup timing relative to the emit
			// cadence). We only assert per-cycle duration.
			{ key: 's_img_3',      layer: 'frame', srcContains: 'img_3_',      expectedSec: 4, maxOutliers: 1 },
			{ key: 's_landscape1', layer: 'frame', srcContains: 'landscape1_', expectedSec: 4, maxOutliers: 1 },
			{ key: 's_landscape2', layer: 'frame', srcContains: 'landscape2_', expectedSec: 4, maxOutliers: 1 },
			{ key: 's_img_5',      layer: 'frame', srcContains: 'img_5_',      expectedSec: 6, toleranceMs: 1500, maxOutliers: 0 },
		]);

		// ── Phase 1: independent baseline ────────────────────────────────────────
		// Master shows img_1 (its first autonomous slot, before emit).
		// Slave shows one of its 3 autonomous loop frames.
		await expect(masterPreEmit).toBeVisible({ timeout: 30_000 });
		await expect.poll(
			() => getVisibleElement(slave.page, slaveAutonomousCandidates),
			{ timeout: 30_000, message: 'slave autonomous frame never visible after 30s' },
		).not.toBeNull();

		// ── Layer B (early): wait for master to attempt the emit broadcast ──────
		// Master logs `sending udp request start <data>` from broadcastSyncValue
		// BEFORE the actual `sos.sync.broadcastValue` call. So this fires whether
		// or not the broadcast succeeds — it tells us master reached the
		// <emitDynamic> element. The 30s budget covers prefetch (~1s) + img_1 dur
		// (6s) + cushion.
		const broadcastDeadline = Date.now() + 30_000;
		const sawBroadcastAttempt = () =>
			master.console.messages.some((m) => /sending udp request start/.test(m.text));
		while (Date.now() < broadcastDeadline) {
			if (sawBroadcastAttempt()) break;
			await new Promise((r) => setTimeout(r, 500));
		}
		expect(
			sawBroadcastAttempt(),
			'master never logged the udp-request broadcast within 30s — emitDynamic not reached',
		).toBe(true);

		// ── Layer A: smoking-gun WS-frame inventory ─────────────────────────────
		// Master attempted the broadcast (per console). Did anything actually go
		// out on the wire? Zero `request_set_value` frames carrying `action=start`
		// means `sos.sync.broadcastValue` threw before sending — typically
		// "Group … wasn't initialized" if the broadcast target group isn't joined
		// by master. Give a tiny grace window for the WS frame to land in the
		// capture buffer after the console log.
		await new Promise((r) => setTimeout(r, 500));
		const masterStartSent = master.wsFrames.filter((fr) =>
			fr.direction === 'sent' && fr.payload.includes('"action":"start"')
		).length;
		expect(
			masterStartSent,
			'master attempted broadcast (per console log) but zero WS frames carrying ' +
			'action=start went out — likely InternalSynchronizerError on ' +
			'broadcastValue. Inspect master.console for the underlying error.',
		).toBeGreaterThan(0);

		const slaveStartRecv = slave.wsFrames.filter((fr) =>
			fr.direction === 'received' && fr.payload.includes('"action":"start"')
		).length;
		expect(
			slaveStartRecv,
			`slave received zero emit broadcasts (master sent ${masterStartSent}). ` +
			'Suggests group-membership / broadcast-routing bug.',
		).toBeGreaterThan(0);

		// ── Phase 2: master emits → both transition into synced punch-in ────────
		// Concurrent waitFor on each device's dynamic-content locator. Skew is the
		// gap between the first device landing visible and the last.
		const t0 = Date.now();
		let masterTs = 0;
		let slaveTs = 0;
		try {
			[masterTs, slaveTs] = await Promise.all([
				masterDynamic.waitFor({ state: 'visible', timeout: 30_000 }).then(() => Date.now()),
				slaveDynamic .waitFor({ state: 'visible', timeout: 30_000 }).then(() => Date.now()),
			]);
		} catch (err) {
			// On Phase 2 failure, dump master sent vs slave received so the protocol
			// layer that broke is obvious from CI logs.
			const dynFrames = (d: SyncDevice, dir: 'sent' | 'received') =>
				d.wsFrames.filter((fr) => fr.direction === dir && fr.payload.includes('myKey'));
			const masterSent = dynFrames(master, 'sent');
			const slaveRecv = dynFrames(slave, 'received');
			const fmt = (frames: typeof master.wsFrames, n: number) =>
				frames.slice(0, n).map((f, i) => `    [${i}] ${f.payload}`).join('\n');
			// eslint-disable-next-line no-console
			console.log(
				`[wire-dump] master SENT (${masterSent.length}):\n${fmt(masterSent, 4)}\n` +
				`[wire-dump] slave RECV (${slaveRecv.length}):\n${fmt(slaveRecv, 4)}\n`
			);
			throw err;
		}
		const skew = Math.abs(masterTs - slaveTs);
		// eslint-disable-next-line no-console
		console.log(
			`[dynamic-sync-trigger] punch-in skew=${skew}ms ` +
			`(master at ${masterTs - t0}ms, slave at ${slaveTs - t0}ms after phase start)`,
		);
		expect(
			skew,
			`master img_4 vs slave img_5 punch-in skew was ${skew}ms; tolerance ${MAX_SKEW_MS}ms`,
		).toBeLessThanOrEqual(MAX_SKEW_MS);

		// ── Layer B (continued): console gates pinpointing the slave-side step ─
		// Console gates: confirm the slave-side udp handler chain fired. Log
		// arguments come *after* the format string (Debug uses %s placeholders),
		// so the regex must not require literal "action=start" — the value lands
		// later in the line.
		expect(
			slave.console.messages.some((m) =>
				/\[trigger-dynamic\] received udp request:.*\bstart\b.*dynamic_clh0lowq/.test(m.text)
			),
			'slave never logged broadcast receipt — broadcastValue did not deliver',
		).toBe(true);
		expect(
			slave.console.messages.some((m) => /\[trigger-dynamic\] starting:/.test(m.text)),
			'slave received broadcast but never started its dynamic playlist',
		).toBe(true);

		// ── Phase 3: independent resume ─────────────────────────────────────────
		// Master moves to img_2 (after-emit slot in its excl/seq).
		// Slave returns to its autonomous loop.
		// Master moves to img_2 (post-emit autonomous slot). Generous timeout
		// because the master-side "wait for preceding content" + the new sync
		// finish-coord ACK round-trip add up — observed up to ~20 s before
		// img_2 reaches visibility on master under load.
		await expect(masterPostEmit).toBeVisible({ timeout: 30_000 });
		await expect.poll(
			() => getVisibleElement(slave.page, slaveAutonomousCandidates),
			{ timeout: 20_000, message: 'slave never returned to autonomous content after dynamic ended' },
		).not.toBeNull();

		// ── Phase 4: multi-cycle — emits succeed across the indefinite loop ──
		// Pre-fix regression: cycle 1 worked, cycle 2+ failed with
		// InternalSynchronizerError 51103 because SocketSynchronizer doesn't
		// dedup join calls. Wait for N total emit cycles on each side.
		await waitForConsolePattern(
			master.console,
			'master dynamic playlist joining sync group',
			REQUIRED_EMIT_CYCLES,
			MULTI_CYCLE_TIMEOUT_MS,
		);
		await waitForConsolePattern(
			slave.console,
			'[trigger-dynamic] starting:',
			REQUIRED_EMIT_CYCLES,
			MULTI_CYCLE_TIMEOUT_MS,
		);

		// Hard-fail on any group-initialization rejection during the run.
		// Anything containing this string is the 51103 regression resurfacing.
		const masterJoinFailures = master.console.matching('group initialization failed');
		const slaveJoinFailures = slave.console.matching('group initialization failed');
		expect(
			masterJoinFailures.length,
			`master saw ${masterJoinFailures.length} 'group initialization failed' errors over ${REQUIRED_EMIT_CYCLES} cycles — duplicate-join regression resurfaced. First: ${masterJoinFailures[0]?.text?.slice(0, 200)}`,
		).toBe(0);
		expect(
			slaveJoinFailures.length,
			`slave saw ${slaveJoinFailures.length} 'group initialization failed' errors over ${REQUIRED_EMIT_CYCLES} cycles. First: ${slaveJoinFailures[0]?.text?.slice(0, 200)}`,
		).toBe(0);

		// Each watched element must have rendered for its SMIL-declared dur on
		// every observed cycle (with the per-candidate maxOutliers above
		// absorbing the single emit-boundary cut per autonomous slot).
		await master.monitor.assertDurationsWithinTolerance({ toleranceMs: 800 });
		await slave .monitor.assertDurationsWithinTolerance({ toleranceMs: 800 });
	});

	test('master-only: emit dynamic plays through without any slave present', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		const groupName = uniqueGroupName(testInfo.title);
		const masterUrl = `${testServerBaseUrl}/syncFiles/dynamicSyncTriggerMaster.smil`;

		// Single device — should self-elect as master of the auto-joined group.
		const master = await addSyncDevice(browser, 0, { smilUrl: masterUrl, groupName });
		devices = [master];

		await waitForMasterElection(devices, 60_000);

		const f = (d: SyncDevice) => d.page.frameLocator('iframe');
		const masterPreEmit  = f(master).locator('img[src*="img_1_"]');
		const masterDynamic  = f(master).locator('img[src*="img_4_"]');

		// Visibility-duration monitoring — master-only flavour. Same candidates
		// as the master half of the multi-device test; see comment there for
		// rationale on maxOutliers and the default minOccurrences=1 choice.
		master.monitor.watch([
			{ key: 'm_img_1', layer: 'frame', srcContains: 'img_1_', expectedSec: 6, maxOutliers: 1 },
			{ key: 'm_img_4', layer: 'frame', srcContains: 'img_4_', expectedSec: 6, maxOutliers: 0 },
			{ key: 'm_img_2', layer: 'frame', srcContains: 'img_2_', expectedSec: 6, maxOutliers: 1 },
		]);

		// Phase 1: pre-emit autonomous slot must reach the screen.
		await expect(masterPreEmit).toBeVisible({ timeout: 30_000 });

		// Phase 2: emit fires, dynamic punch-in plays.
		await expect(masterDynamic).toBeVisible({ timeout: 30_000 });

		// Phase 3: master resumes to its post-emit autonomous slot.
		const masterPostEmit = f(master).locator('img[src*="img_2_"]');
		await expect(masterPostEmit, 'master never reached post-emit autonomous slot (img_2)').toBeVisible({ timeout: 30_000 });

		// Phase 4: outer indefinite loop continues — img_1 cycles back.
		await expect(masterPreEmit, 'master never looped back to img_1 after one full cycle').toBeVisible({ timeout: 30_000 });

		// Phase 5: multi-cycle — emit fires successfully on each cycle.
		// Pre-fix regression: cycle 1 worked, cycle 2+ failed with 51103
		// because the per-syncId join wasn't idempotent and the sync server
		// rejected duplicates. Master is the only device, so we don't need
		// slave-side correlation — just count master's successful joins.
		await waitForConsolePattern(
			master.console,
			'master dynamic playlist joining sync group',
			REQUIRED_EMIT_CYCLES,
			MULTI_CYCLE_TIMEOUT_MS,
		);

		const masterJoinFailures = master.console.matching('group initialization failed');
		expect(
			masterJoinFailures.length,
			`master saw ${masterJoinFailures.length} 'group initialization failed' errors over ${REQUIRED_EMIT_CYCLES} cycles — duplicate-join regression resurfaced. First: ${masterJoinFailures[0]?.text?.slice(0, 200)}`,
		).toBe(0);

		// Duration check: each master slot must hit its SMIL dur per cycle.
		await master.monitor.assertDurationsWithinTolerance({ toleranceMs: 800 });
	});
});
