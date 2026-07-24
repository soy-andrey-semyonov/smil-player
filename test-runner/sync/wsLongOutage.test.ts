import { test, expect } from '../fixtures';
import { createSyncGroup, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import {
	waitForMasterElection,
	waitForConvergence,
	assertSynchronizedTransition,
	countSyncEvents,
} from './syncAssertions';
import { recordSkew } from '../../tools/record-sync-skew.mjs';

// WS outage recovery — both sides of the 60s SYNC_TIMEOUTS.networkFailureTimeout,
// exercised on ONE group so the short-blip and long-outage paths are proven against
// the same devices (one master election + convergence, not two):
//   Phase 1 — a 5s blip: the slave must recover via the normal ACK flow WITHOUT the
//     60s networkFailureTimeout firing (a short reconnect is well under the threshold).
//   Phase 2 — a 70s outage: now the 60s timeout MUST fire, and the slave must recover
//     via the planned RESYNC path and return to ≤500ms steady-state lockstep.
//
// The two timeouts are intentionally separate code paths (SMILElementController.ts:908
// the 60s networkFailureTimeout vs :928 the 10-minute resync-target safety net). Failure
// modes guarded: a short blip wrongly tripping the 60s timeout, the long-outage path
// never recovering, the two paths being conflated, or a PERMANENT post-recovery drift.
// (Folds the former wsDisconnectReconnect test — whose assertions were a strict subset
// of this one — and adds the no-60s-timeout check it intended but never asserted.)

test.describe.configure({ mode: 'serial' });
test.describe('sync · WS outage recovery', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('5s blip recovers without the 60s timeout; 70s outage fires it and still recovers to steady state', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		// 70s offline + reconnect + recovery, plus the short blip phase ahead of it,
		// comfortably exceeds the 180s default budget.
		test.setTimeout(300_000);

		devices = await createSyncGroup(browser, {
			smilUrl: `${testServerBaseUrl}/syncFiles/cycleWrapBoundary.smil`,
			groupName: uniqueGroupName(testInfo.title),
			deviceCount: 3,
		});
		await waitForMasterElection(devices, 60_000);

		const l1 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape1"]');
		const l2 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape2"]');
		const video = (p: SyncDevice['page']) => p.locator('video[src*="video-test_465b7757"]');
		// The 60s networkFailureTimeout vs the distinct 10-minute resync-target safety net.
		const resyncTriggered = /Timeout waiting for .+ triggering resync/;
		const resyncTargetTimeout = /Timeout waiting for .+ at resync target=/;
		await waitForConvergence(devices, l1, 90_000);

		// ---- Phase 1: short 5s blip — must recover WITHOUT firing the 60s timeout ----
		// Take slave[1] offline for 5s — enough to miss a cmd-prepare round but well under
		// the 60s networkFailureTimeout. Playwright's setOffline tears down WS connections
		// and returns ERR_INTERNET_DISCONNECTED for new requests.
		await devices[1].context.setOffline(true);
		await devices[0].page.waitForTimeout(5_000);
		await devices[1].context.setOffline(false);

		// After reconnect slave[1] rejoins and completes the next transition with the rest.
		// Wider tolerance (3000ms) because reconnect costs real time and the measurement
		// starts at the hide edge, not the reconnect edge.
		await Promise.all(devices.map((d) => l1(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })));
		const blip = await assertSynchronizedTransition(devices, l2, {
			label: 'post-blip: l1→l2',
			maxSkewMs: 3000,
			timeoutMs: 20_000,
		});
		// eslint-disable-next-line no-console
		console.log(`[ws-blip] post-reconnect l1→l2 skew=${blip.skewMs}ms`);
		recordSkew({
			test: testInfo.title,
			label: 'post-blip: l1→l2',
			skewMs: blip.skewMs,
			offsets: blip.timestamps.map((t) => t - blip.minTs),
		});

		// A 5s blip is well under the 60s networkFailureTimeout — recovery must come via the
		// normal ACK flow, NOT by tripping the timeout. (The old wsDisconnectReconnect test
		// intended this but only ever checked the 10-minute safety net.)
		expect(
			countSyncEvents(devices[1], resyncTriggered),
			'a 5s blip must NOT trigger the 60s networkFailureTimeout',
		).toBe(0);
		for (const dev of devices) {
			expect(
				countSyncEvents(dev, resyncTargetTimeout),
				`dev ${dev.deviceId} hit the resync-target timeout after the blip`,
			).toBe(0);
		}

		// ---- Phase 2: long 70s outage — the 60s timeout MUST fire, then recover ----
		// The slave's local setTimeout fires independent of network state, so the timeout
		// code path executes even while the browser is still offline.
		await devices[1].context.setOffline(true);
		await devices[0].page.waitForTimeout(70_000);
		await devices[1].context.setOffline(false);

		// The 60s timeout MUST have fired now. The player logs via logDebug with %s/%d
		// placeholders Playwright keeps literal (args appended at the tail), so the text
		// carries this stable phrase regardless of cmd/syncIndex. Source:
		// SMILElementController.ts:916.
		const sixtySecFired = countSyncEvents(devices[1], resyncTriggered);
		expect(
			sixtySecFired,
			'slave[1] should have hit the 60s networkFailureTimeout during the 70s offline window',
		).toBeGreaterThan(0);
		// The distinct 10-minute safety timeout (SMILElementController.ts:904) must NOT
		// fire in 70s. Conflating the two paths would show here.
		for (const dev of devices) {
			expect(
				countSyncEvents(dev, resyncTargetTimeout),
				`dev ${dev.deviceId} unexpectedly hit the 10m resync-target timeout`,
			).toBe(0);
		}

		// After reconnect slave[1] must re-integrate. Generous budget — the resync state
		// machine needs the cmd flow back plus its own target-reach cycle before lockstep.
		await waitForConvergence(devices, l2, 120_000);

		// First post-recovery transition: loose tolerance (recovery costs a beat).
		await Promise.all(devices.map((d) => l2(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })));
		const recovery = await assertSynchronizedTransition(devices, l1, {
			label: 'post-70s-recovery: l2→l1',
			maxSkewMs: 5000,
			timeoutMs: 30_000,
		});
		// eslint-disable-next-line no-console
		console.log(`[ws-long-outage] 60s-timeout-fires=${sixtySecFired}, post-recovery skew=${recovery.skewMs}ms`);
		recordSkew({
			test: testInfo.title,
			label: 'post-70s-recovery: l2→l1',
			skewMs: recovery.skewMs,
			offsets: recovery.timestamps.map((t) => t - recovery.minTs),
		});

		// Subsequent transitions must return to the 500ms steady-state bound; a PERMANENT
		// post-recovery drift would surface here.
		await Promise.all(devices.map((d) => l1(d.page).first().waitFor({ state: 'hidden', timeout: 20_000 })));
		const steady1 = await assertSynchronizedTransition(devices, l2, { label: 'post-recovery steady l1→l2', maxSkewMs: 500, timeoutMs: 20_000 });
		recordSkew({ test: testInfo.title, label: 'post-recovery steady l1→l2', skewMs: steady1.skewMs, offsets: steady1.timestamps.map((t) => t - steady1.minTs) });
		await Promise.all(devices.map((d) => l2(d.page).first().waitFor({ state: 'hidden', timeout: 20_000 })));
		const steady2 = await assertSynchronizedTransition(devices, video, { label: 'post-recovery steady l2→video', maxSkewMs: 500, timeoutMs: 20_000 });
		recordSkew({ test: testInfo.title, label: 'post-recovery steady l2→video', skewMs: steady2.skewMs, offsets: steady2.timestamps.map((t) => t - steady2.minTs) });
	});
});
