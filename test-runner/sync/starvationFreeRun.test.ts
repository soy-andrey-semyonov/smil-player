import { test, expect } from '../fixtures';
import { createSyncGroup, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import { waitForMasterElection, waitForConvergence, assertSynchronizedTransition, countSyncEvents } from './syncAssertions';

// Starvation escalation to standalone free-run (SMILElementController.recordStarvationTimeout).
//
// Field failure this guards (live-observed 2026-07-10 on a real webOS pair): the master's
// playback engine died silently mid campaign window; the slave then hit the 60s
// networkFailureTimeout on every cmd wait, and each timeout only advanced the resync target
// by ONE syncIndex before waiting again — a one-index-per-minute crawl with a permanently
// frozen screen and no recovery short of a manual reload.
//
// The fix: after STARVATION_ESCALATION_LIMIT (3) consecutive starvations a region escalates
// to standalone free-run (plays solo, no cmd waits); a coordination message NEWER than the
// escalation proves the master is back and normal coordination resumes.
//
// Black-box simulation: from the slave's perspective a dead-engine master and a network
// outage are identical (no cmd messages arrive while its own timeouts keep firing), so a
// long setOffline on the slave reproduces the starvation ladder deterministically. The
// wsLongOutage spec already proves a slave keeps its slave role during setOffline (its 70s
// phase asserts the 60s timeout fires, which requires the device to still be waiting as a
// slave). NOTE: a 70s outage produces at most 1-2 starvations — below the limit — so this
// spec (3+ starvations) and wsLongOutage (RESYNC crawl preserved for short outages)
// intentionally test opposite sides of the escalation threshold.
//
// Player logs keep %s/%d placeholders literal in captured console text (args appended at
// the tail) — regexes match the literal format-string fragments.

test.describe.configure({ mode: 'serial' });
test.describe('sync · starvation escalation to standalone free-run', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('slave escalates to free-run after 3 starvations, keeps painting solo, resumes sync on reconnect', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		// 3 sequential 60s starvation waits (~180-220s offline) + solo-rotation proof
		// + reconnect + reconvergence + steady-state checks.
		test.setTimeout(600_000);

		devices = await createSyncGroup(browser, {
			smilUrl: `${testServerBaseUrl}/syncFiles/cycleWrapBoundary.smil`,
			groupName: uniqueGroupName(testInfo.title),
			deviceCount: 2,
		});
		await waitForMasterElection(devices, 60_000);

		const l1 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape1"]');
		const l2 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape2"]');

		const escalated = /Escalating region=.+ to standalone free-run/;
		const playingSolo = /standalone free-run — playing solo/;
		const resumedSync = /resuming sync coordination/;
		const resyncTriggered = /Timeout waiting for .+ triggering resync/;
		const resyncTargetTimeout = /Timeout waiting for .+ at resync target=/;

		await waitForConvergence(devices, l1, 90_000);

		// ---- Phase 1: starve the slave until it escalates ----
		// Offline slave receives no cmd messages; its local 60s timeouts fire regardless of
		// network state. Starvations 1-2 must still take the pre-existing RESYNC path; the
		// 3rd crosses STARVATION_ESCALATION_LIMIT and switches the region to free-run.
		await devices[1].context.setOffline(true);

		await expect
			.poll(() => countSyncEvents(devices[1], escalated), {
				message: 'slave should escalate to standalone free-run after 3 consecutive 60s cmd-wait starvations',
				timeout: 260_000,
				intervals: [5_000],
			})
			.toBeGreaterThan(0);

		// The first starvations went through the normal RESYNC ladder (escalation is a
		// last resort, not a replacement for short-outage recovery).
		expect(
			countSyncEvents(devices[1], resyncTriggered),
			'starvations below the limit must still use the RESYNC path',
		).toBeGreaterThanOrEqual(2);

		// ---- Phase 2: the escalated slave must keep painting content while offline ----
		// This is the actual field pain: pre-fix the screen froze for 14+ minutes. Solo
		// rotation is slower than synced rotation (each element still burns short
		// signal-ready waits), so budgets are generous. One full l1 → hidden → l1 cycle
		// proves the playlist is looping, not stuck on a single stale frame.
		await l1(devices[1].page).first().waitFor({ state: 'visible', timeout: 90_000 });
		await l1(devices[1].page).first().waitFor({ state: 'hidden', timeout: 90_000 });
		await l1(devices[1].page).first().waitFor({ state: 'visible', timeout: 90_000 });
		expect(
			countSyncEvents(devices[1], playingSolo),
			'free-run region should log solo playback while starved',
		).toBeGreaterThan(0);

		// The 10-minute resync-target safety net is a distinct code path and must not be
		// involved at any point.
		for (const dev of devices) {
			expect(
				countSyncEvents(dev, resyncTargetTimeout),
				`dev ${dev.deviceId} unexpectedly hit the 10m resync-target timeout`,
			).toBe(0);
		}

		// ---- Phase 3: reconnect — a fresh coordination message ends free-run ----
		// The master kept broadcasting cmd-* all along; after the socket rejoins, the next
		// stored message is newer than the escalation timestamp and exits free-run.
		await devices[1].context.setOffline(false);

		await expect
			.poll(() => countSyncEvents(devices[1], resumedSync), {
				message: 'slave should resume sync coordination after receiving a fresh command post-reconnect',
				timeout: 120_000,
				intervals: [5_000],
			})
			.toBeGreaterThan(0);

		await waitForConvergence(devices, l1, 120_000);

		// First post-recovery transition: loose tolerance (re-integration costs a beat),
		// then steady-state must return to the 500ms lockstep bound.
		await Promise.all(devices.map((d) => l1(d.page).first().waitFor({ state: 'hidden', timeout: 60_000 })));
		const recovery = await assertSynchronizedTransition(devices, l2, {
			label: 'post-free-run recovery: l1→l2',
			maxSkewMs: 5000,
			timeoutMs: 30_000,
		});
		// eslint-disable-next-line no-console
		console.log(`[starvation-free-run] post-recovery skew=${recovery.skewMs}ms`);

		await Promise.all(devices.map((d) => l2(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })));
		const steady = await assertSynchronizedTransition(devices, l1, {
			label: 'post-recovery steady l2→l1',
			maxSkewMs: 500,
			timeoutMs: 30_000,
		});
		// eslint-disable-next-line no-console
		console.log(`[starvation-free-run] steady-state skew=${steady.skewMs}ms`);
	});
});
