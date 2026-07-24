import { test } from '../fixtures';
import { expect } from '@playwright/test';
import { createSyncGroup, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import {
	waitForMasterElection,
	waitForSyncIndexAgreement,
	assertSyncIndexLockstepOverWindow,
	ElementCandidate,
} from './syncAssertions';

// Group J: 3-level priority cascade. Group D only tests a single cross-priority
// boundary (P_high → P_low). hasPriorityChanged() compares arbitrary numeric
// levels, so a 3-level chain (P1→P2→P3) exercises cross-priority detection on
// two consecutive boundaries and catches state residue between the first and
// second transition — e.g., stale cmd-prepare metadata, uncleared priority
// bookkeeping, or a resync flag that doesn't get fully cleared after boundary 1.
//
// Fixture: P1 ends at +30s, P2 ends at +60s, P3 always active. 25 × 4s samples
// cover ~100s so P2→P3 at +60s reliably lands inside the window even when
// master election + initial sync agreement is slow (~15s of fetch→sampling lag).
//
// Spread tolerance: 2 (not 1) — during a cross-priority boundary the master
// pre-broadcasts cmd-prepare for the next priority class's first element,
// which bumps its logged syncIndex ahead of the slaves briefly. Observed
// `[3,1,1]` on a stable run at the P1→P2 approach.

const SYNC_SPREAD_MAX = 2;
const SAMPLES = 25;
const SAMPLE_GAP_MS = 4_000;
// Transient divergence budget. During each cross-priority boundary the master
// briefly races ahead of the slaves; a single 4s snapshot can catch that
// intermediate state. With two boundaries in a 100s window we tolerate up to
// 2 divergent snapshots total. A real stall regression (8ef7571 class) would
// keep a slave N syncIndex values behind for many seconds — easily >5 snapshots.
const MAX_DIVERGENT_SNAPSHOTS = 2;

test.describe.configure({ mode: 'serial' });
test.describe('sync · three-level priority transition', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('3 devices stay on matching syncIndex across two consecutive priority boundaries', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		devices = await createSyncGroup(browser, {
			smilUrl: `${testServerBaseUrl}/dynamic/threeLevelPriorityTransition.smil`,
			groupName: uniqueGroupName(testInfo.title),
			deviceCount: 3,
		});
		await waitForMasterElection(devices, 60_000);
		const start = await waitForSyncIndexAgreement(devices, { timeoutMs: 120_000 });
		// eslint-disable-next-line no-console
		console.log(`[3-level-priority] initial agreement: syncIndex=${start.syncIndex}`);

		const candidates: ElementCandidate[] = [
			{ name: 'landscape1', locator: (p) => p.frameLocator('iframe').locator('img[src*="landscape1"]') },
			{ name: 'landscape2', locator: (p) => p.frameLocator('iframe').locator('img[src*="landscape2"]') },
			{ name: 'img_1', locator: (p) => p.frameLocator('iframe').locator('img[src*="img_1"]') },
		];

		const snapshots = await assertSyncIndexLockstepOverWindow(devices, {
			candidates,
			samples: SAMPLES,
			sampleGapMs: SAMPLE_GAP_MS,
			maxSpread: SYNC_SPREAD_MAX,
			maxDivergentSnapshots: MAX_DIVERGENT_SNAPSHOTS,
			label: '[3-level-priority]',
		});

		// Full 3-level cascade: syncIndex must advance through BOTH boundaries,
		// reaching start+2 (typically 3). start+1 would mean only P1→P2 fired
		// and the cascade stalled at P2 — the exact state residue regression
		// this fixture is designed to catch.
		const peak = Math.max(
			...snapshots.flatMap((s) =>
				s.tuples.map((t) => t.syncIndex).filter((v): v is number => v !== null),
			),
		);
		expect(
			peak,
			`syncIndex peak=${peak} did not reach start+2 (start=${start.syncIndex}) — P2→P3 boundary never fired within the sampling window`,
		).toBeGreaterThanOrEqual(start.syncIndex + 2);
	});
});
