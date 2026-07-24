import { test, expect } from '../fixtures';
import { createSyncGroup, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import {
	waitForMasterElection,
	waitForConvergence,
	waitForSyncIndexAgreement,
	assertSynchronizedTransition,
	getLatestSyncIndex,
} from './syncAssertions';

// Group E3 sync regression — clock-skew convergence (the documented
// maxSyncIndexPerRegion-inflation / unreachable-resync-target failure mode,
// exercised via a genuinely skewed device clock).
//
// All other sync specs share the one host clock, so wallclock divergence
// across devices is never tested. Here device 0 — the master (first-launched
// device wins election in createSyncGroup's staggered launch) — runs a clock
// shimmed +20min. The fixture's third element is a wallclock window that opens
// ~15min in the future on the server clock: future for the two unskewed slaves
// the whole run, but already active for the skewed master. The master therefore
// evaluates a third active element, inflating its maxSyncIndexPerRegion, and
// broadcasts a resync target (index 2) the slaves can never reach.
//
// Pre-fix this froze the slaves (they waited for the unreachable index). Post-fix
// (0484bc9: slaves use their own observed min/max) the slaves fall back to their
// reachable range and keep cycling landscape2(0) ↔ video(1) in lockstep. This
// test asserts that no-freeze property on the unskewed pair; the skewed master
// is allowed to diverge.
//
// This spec never calls monitor.watch()/assertDurationsWithinTolerance — it
// asserts sync convergence, not play durations. The fixture's generated duration
// registry entry exists only to satisfy the byte-exact globalSetup check.

const SKEW_MS = 20 * 60 * 1000; // +20min — well past the fixture's +15min window

test.describe.configure({ mode: 'serial' });
test.describe('sync · clock-skew convergence', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('unskewed slaves keep cycling when the master clock is skewed +20min', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		devices = await createSyncGroup(browser, {
			smilUrl: `${testServerBaseUrl}/syncFiles/clockSkewWallclock.smil`,
			groupName: uniqueGroupName(testInfo.title),
			deviceCount: 3,
			clockOffsetsMs: [SKEW_MS, 0, 0], // only the master is skewed
		});

		// Validity guard: prove the clock shim actually bit before relying on its
		// downstream effect. The skewed master's Date.now() must lead an unskewed
		// slave's by ~SKEW_MS (a few seconds of slack for the two evaluate() round
		// trips). Without this a no-op shim would let the test pass trivially.
		// The init-script is context-wide, so the applet iframe (where the player's
		// moment()-based wallclock evaluation actually runs) gets the same shimmed
		// Date as the main page checked here — verifying the main page is sufficient.
		const [skewedNow, baselineNow] = await Promise.all([
			devices[0].page.evaluate(() => Date.now()),
			devices[1].page.evaluate(() => Date.now()),
		]);
		const observedSkew = skewedNow - baselineNow;
		// eslint-disable-next-line no-console
		console.log(`[clock-skew] master Date.now() leads slave by ${observedSkew}ms (target ${SKEW_MS}ms)`);
		expect(observedSkew).toBeGreaterThan(SKEW_MS - 15_000);
		expect(observedSkew).toBeLessThan(SKEW_MS + 15_000);

		// The skew must land on the master for this to exercise the documented
		// MASTER-side maxSyncIndexPerRegion inflation. Device 0 (first-launched)
		// wins election via createSyncGroup's 1500ms stagger — the same assumption
		// the suite's assertWsFrameClustering encodes (masterIndex defaults to 0).
		// If this fails, election picked a different device and the skew (hardcoded
		// to index 0) landed on a slave — so the premise broke, not the player.
		const master = await waitForMasterElection(devices, 90_000);
		expect(master.deviceId).toBe(devices[0].deviceId);

		// Derive slaves from the elected master (correct-by-construction rather
		// than assuming indices 1/2), so the convergence assertions always target
		// exactly the unskewed devices.
		const slaves = devices.filter((d) => d.deviceId !== master.deviceId);
		const landscape2 = (p: SyncDevice['page']) =>
			p.frameLocator('iframe').locator('img[src*="landscape2"]');
		// Runtime <video src> carries the local checksum filename, not the source
		// URL — same asset/key as wallclockInflatedBounds.test.ts (verified against
		// the generated duration registry).
		const video = (p: SyncDevice['page']) => p.locator('video[src*="video-test_465b7757"]');

		// The unskewed slaves reach the first baseline element together...
		await waitForConvergence(slaves, landscape2, 120_000);
		// ...and agree on a syncIndex (the bug's freeze symptom would time out here).
		const agreed = await waitForSyncIndexAgreement(slaves, { timeoutMs: 60_000 });
		// eslint-disable-next-line no-console
		console.log(`[clock-skew] unskewed slaves agreed on syncIndex=${agreed.syncIndex} skew=${agreed.skewMs}ms`);

		// Sustained advancement across ≥3 transitions proves the slaves are not
		// frozen on an unreachable resync target but cycling 0↔1 in lockstep.
		await Promise.all(
			slaves.map((d) => landscape2(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })),
		);
		await assertSynchronizedTransition(slaves, video, {
			label: 'slaves landscape2→video (skewed master)',
			timeoutMs: 30_000,
		});

		await Promise.all(
			slaves.map((d) => video(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })),
		);
		await assertSynchronizedTransition(slaves, landscape2, {
			label: 'slaves video→landscape2 (skewed master)',
			timeoutMs: 30_000,
		});

		await Promise.all(
			slaves.map((d) => landscape2(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })),
		);
		await assertSynchronizedTransition(slaves, video, {
			label: 'slaves landscape2→video (2nd cycle)',
			timeoutMs: 30_000,
		});

		// Sync must NOT force the unskewed slaves onto the master's locally-active
		// future element: their own wallclock keeps that window shut, and the
		// post-fix engine reconciles the master's inflated maxSyncIndexPerRegion to
		// the group-reachable range rather than dragging slaves onto unreachable
		// content (or freezing them on it). So landscape1 (the future element) must
		// render on NEITHER slave across a full baseline cycle — that is the
		// contract and the only hard assertion here.
		//
		// The master's own future-element rendering is logged, not asserted:
		// empirically it stays 0 too — sync coordination keeps even the skewed
		// master on the group-reachable baseline, so its inflation manifests in the
		// maxSyncIndexPerRegion it broadcasts, not in what it paints. That is the
		// nuance under test, not a guaranteed contract. (A frozen/crashed master is
		// still caught: the slave transitions above would stall without its
		// broadcasts.)
		const landscape1 = (p: SyncDevice['page']) =>
			p.frameLocator('iframe').locator('img[src*="landscape1"]');
		let slaveFutureRenders = 0;
		let masterFutureRenders = 0;
		for (let i = 0; i < 12; i++) {
			const [masterVisible, slaveVisible] = await Promise.all([
				landscape1(master.page).first().isVisible().catch(() => false),
				Promise.all(slaves.map((d) => landscape1(d.page).first().isVisible().catch(() => false))),
			]);
			if (masterVisible) masterFutureRenders++;
			if (slaveVisible.some(Boolean)) slaveFutureRenders++;
			await new Promise((r) => setTimeout(r, 2_000));
		}
		// eslint-disable-next-line no-console
		console.log(
			`[clock-skew] future element samples (of 12): skewed master=${masterFutureRenders}, slaves=${slaveFutureRenders}; ` +
				`final syncIndex master=${getLatestSyncIndex(master)} slaves=[${slaves.map(getLatestSyncIndex).join(', ')}]`,
		);
		expect(slaveFutureRenders).toBe(0);
	});
});
