import { test, expect } from '../fixtures';
import { createSyncGroup, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import { waitForMasterElection, waitForConvergence, assertSynchronizedTransition } from './syncAssertions';
import { recordSkew } from '../../tools/record-sync-skew.mjs';
import { percentile } from '../../tools/report-sync-skew.mjs';

// Steady-state simultaneity over a FULL cycle. The other skew tests measure 1–3
// transitions; this drives 12+ to prove (a) p95 skew stays tight and (b) skew
// does NOT drift upward over time (a slow desync each single transition tolerates
// but that accumulates). Fixture: cycleWrapBoundary.smil (l1 → l2 → video, repeat).

const PER_TRANSITION_MAX_SKEW_MS = 500;
// Aggregate bound, deliberately far below the per-transition gate (which throws
// first at >500ms — an equal bound would be unfalsifiable). Calibrated against
// observed steady-state p95 of ~7ms (logs/sync-skew.jsonl) with ~14x headroom:
// catches a distributional regression (e.g. consistent ~200ms skew) that the
// per-transition gate would happily pass.
const P95_MAX_MS = 100;
const MAX_DRIFT_MS = 250; // mean(last third) - mean(first third)
const TRANSITIONS = 12;

test.describe.configure({ mode: 'serial' });
test.describe('sync · steady-state skew', () => {
	let devices: SyncDevice[] = [];
	test.afterEach(async () => { await cleanupSyncGroup(devices); devices = []; });

	test('12 transitions stay <500ms skew with no upward drift', async ({ browser, testServerBaseUrl }, testInfo) => {
		test.setTimeout(300_000);
		devices = await createSyncGroup(browser, {
			smilUrl: `${testServerBaseUrl}/syncFiles/cycleWrapBoundary.smil`,
			groupName: uniqueGroupName(testInfo.title),
			deviceCount: 3,
		});
		await waitForMasterElection(devices, 60_000);

		const video = (p: SyncDevice['page']) => p.locator('video[src*="video-test_465b7757"]');
		const l1 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape1"]');
		const l2 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape2"]');

		await waitForConvergence(devices, l1, 120_000);

		const seq = [
			{ label: 'l1→l2', hide: l1, next: l2 },
			{ label: 'l2→video', hide: l2, next: video },
			{ label: 'video→l1', hide: video, next: l1 },
		];
		const skews: number[] = [];
		for (let i = 0; i < TRANSITIONS; i++) {
			const step = seq[i % seq.length];
			await Promise.all(devices.map((d) => step.hide(d.page).first().waitFor({ state: 'hidden', timeout: 20_000 })));
			const s = await assertSynchronizedTransition(devices, step.next, {
				label: `t${i} ${step.label}`,
				maxSkewMs: PER_TRANSITION_MAX_SKEW_MS,
				timeoutMs: 20_000,
			});
			skews.push(s.skewMs);
			recordSkew({ test: testInfo.title, label: `t${i} ${step.label}`, skewMs: s.skewMs, offsets: s.timestamps.map((t) => t - s.minTs) });
		}

		// Same p95 definition (linear interpolation) as `npm run report:sync-skew`,
		// so the asserted number matches the aggregated report.
		const p95 = percentile(skews, 95);
		const third = Math.floor(skews.length / 3);
		const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
		const firstThird = mean(skews.slice(0, third));
		const lastThird = mean(skews.slice(-third));
		// eslint-disable-next-line no-console
		console.log(`[steady-state] skews=[${skews.join(', ')}] p95=${p95}ms firstThird=${Math.round(firstThird)} lastThird=${Math.round(lastThird)} drift=${Math.round(lastThird - firstThird)}`);

		expect(p95, `p95 skew ${p95}ms over ${TRANSITIONS} transitions exceeds ${P95_MAX_MS}ms`).toBeLessThanOrEqual(P95_MAX_MS);
		expect(lastThird - firstThird, `skew drifted upward by ${Math.round(lastThird - firstThird)}ms (last third vs first third) — accumulating desync`).toBeLessThanOrEqual(MAX_DRIFT_MS);
	});
});
