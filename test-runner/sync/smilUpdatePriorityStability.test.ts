import { test } from '../fixtures';
import { expect } from '@playwright/test';
import { createSyncGroup, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import {
	waitForMasterElection,
	waitForSyncIndexAgreement,
	assertSyncIndexLockstepOverWindow,
	countSyncEvents,
	ElementCandidate,
	assertFrameCountSymmetry,
	assertSyncMessageInventory,
	assertBroadcastReceiptSpread,
	assertFrameContentEquality,
} from './syncAssertions';

// Group E regression test for bug 54f1a10 — false priority-change detection
// on SMIL update.
//
// The fixture serves a constant SMIL body on every GET. The
// /dynamic-refresh/:fileName endpoint rotates Last-Modified in 10s wall-clock
// buckets so all 3 devices see the same L-M at any instant and refresh in
// lockstep — unlike /dynamic-update/ which is GET-count based and hands
// different content to each device.
//
// Signal: syncIndex rather than DOM locators. All three devices must keep
// their currently-reported syncIndex in lockstep (spread ≤ 1 at every
// snapshot) for the whole run. Pre-fix, the first cmd-prepare after a
// reload carried priorityLevel=undefined; slaves' hasPriorityChanged treated
// that as a priority transition, triggered a spurious RESYNC, and stalled
// on a stale syncIndex. That stall shows up here as a snapshot where one
// device's syncIndex diverges from the others by more than 1.

const SYNC_SPREAD_MAX = 1; // allow at most one device mid-transition
const SAMPLES = 12;
const SAMPLE_GAP_MS = 4_000;

test.describe.configure({ mode: 'serial' });
test.describe('sync · SMIL update priority stability [54f1a10]', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('3 devices stay on matching syncIndex across Last-Modified-driven refreshes', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		devices = await createSyncGroup(browser, {
			smilUrl: `${testServerBaseUrl}/dynamic-refresh/smilUpdateStability.smil`,
			groupName: uniqueGroupName(testInfo.title),
			deviceCount: 3,
		});

		await waitForMasterElection(devices, 60_000);

		// Initial agreement establishes the starting syncIndex. Generous timeout
		// for first-load + prefetch + first sync round across 3 devices.
		const start = await waitForSyncIndexAgreement(devices, { timeoutMs: 120_000 });
		// eslint-disable-next-line no-console
		console.log(`[smil-update-stability] initial agreement: syncIndex=${start.syncIndex}`);

		// Element candidates for the rendered-state half of each snapshot. The
		// fixture's seq alternates landscape1 ↔ landscape2; this candidate set
		// is exhaustive.
		const candidates: ElementCandidate[] = [
			{ name: 'landscape1', locator: (p) => p.frameLocator('iframe').locator('img[src*="landscape1"]') },
			{ name: 'landscape2', locator: (p) => p.frameLocator('iframe').locator('img[src*="landscape2"]') },
		];

		// Snapshot every SAMPLE_GAP_MS across ~48s — covers 3+ refresh buckets (server
		// REFRESH_BUCKET_MS=10_000, REFRESH_STOP_AFTER_MS=30_000) plus a stable tail. A
		// persistent spread is exactly the 54f1a10 symptom, so maxDivergentSnapshots
		// defaults to 0. ignoreNullTuples: a device caught between frames (visible=null)
		// or not yet logged (syncIndex=null) is a sampling gap, not desync — counting it
		// would flag a momentary transition as a spurious extra tuple. A real 54f1a10
		// stall shows a stale *non-null* (syncIndex, content) pair and is still counted.
		const snapshots = await assertSyncIndexLockstepOverWindow(devices, {
			candidates,
			samples: SAMPLES,
			sampleGapMs: SAMPLE_GAP_MS,
			maxSpread: SYNC_SPREAD_MAX,
			label: '[smil-update-stability]',
			ignoreNullTuples: true,
		});

		// Liveness: the player must have kept transitioning across the refresh,
		// not frozen on a stale index. This fixture's seq has two frames, so the
		// synchronized syncIndex cycles within a small bounded set (e.g. 1↔2)
		// instead of growing — a "peak > start" check is therefore unsound: it
		// fails whenever the initial agreement happens to sample the cycle's high
		// value (a ~50/50 flake). A frozen player instead collapses to a SINGLE
		// observed syncIndex, so require at least two distinct synchronized
		// indices over the run. A stall on ONE device is caught separately by the
		// spread assertion above.
		const observedIndices = new Set(
			snapshots.flatMap((s) => s.tuples.map((t) => t.syncIndex).filter((v): v is number => v !== null)),
		);
		expect(
			observedIndices.size,
			`syncIndex never changed across the refresh — player froze ` +
				`(only observed {${[...observedIndices].sort((a, b) => a - b).join(', ')}})`,
		).toBeGreaterThan(1);

		// Pre-fix marker: post-refresh cmd-prepare carried undefined priority.
		// A regression would re-introduce log lines matching this pattern.
		for (const dev of devices) {
			expect(
				countSyncEvents(dev, /priority(?:Level)?\s*[:=]\s*undefined/i),
				`dev ${dev.deviceId} broadcast a cmd-prepare with undefined priority`,
			).toBe(0);
		}

		// Let any in-flight WS frames settle before the cross-device WebSocket
		// assertions read the per-device wsFrames arrays.
		await devices[0].page.waitForTimeout(500);

		// eslint-disable-next-line no-console
		console.log(
			'[smil-update-stability] WS totals: ' +
				JSON.stringify(
					devices.map((d) => ({
						dev: d.deviceId,
						sent: d.wsFrames.filter((f) => f.direction === 'sent').length,
						received: d.wsFrames.filter((f) => f.direction === 'received').length,
					})),
				),
		);

		assertFrameCountSymmetry(devices);
		assertSyncMessageInventory(devices);
		assertBroadcastReceiptSpread(devices);
		assertFrameContentEquality(devices);
	});
});
