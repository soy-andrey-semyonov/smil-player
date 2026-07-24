import { test } from '../fixtures';
import { addSyncDevice, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import { performMasterFailover, waitForConvergence, assertSynchronizedTransition } from './syncAssertions';
import { recordSkew } from '../../tools/record-sync-skew.mjs';

// Group L: killed-master re-joins. G2 covers the failover path (master dies,
// survivor gets promoted) — shared here via performMasterFailover. This test
// extends that scenario: the ORIGINAL master is revived after failover with the
// same DUID — the sync server sees "a device that was previously master just came
// back." Regressions to watch for:
//   - Revived device re-claims master and bumps the current master off
//     (assuming the server's election policy is "newest wins"), disrupting
//     the group.
//   - Revived device inherits stale pre-kill state (resync target, pending
//     ACKs) and drags the rest into incoherent behaviour.
//   - Sync server refuses to accept the same DUID back and the revived
//     device hangs at "waiting for master" indefinitely.
// The test's success criterion is operational: all 3 devices complete the
// next transition together with bounded skew after revival.

test.describe.configure({ mode: 'serial' });
test.describe('sync · killed-master re-join', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('revived master rejoins the group and sync resumes across all 3', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		test.setTimeout(240_000);

		const groupName = uniqueGroupName(testInfo.title);
		const smilUrl = `${testServerBaseUrl}/syncFiles/cycleWrapBoundary.smil`;

		// Shared failover preamble: build group → steady state → kill master → survivors
		// re-elect → one post-promotion transition (so the new master is firmly in charge
		// before the original returns).
		const { survivors, killedIndex, l1, l2, video, postFailoverSkew } = await performMasterFailover(
			browser,
			{ smilUrl, groupName },
			(d) => {
				devices = d;
			},
		);
		recordSkew({
			test: testInfo.title,
			label: 'post-failover, pre-revival',
			skewMs: postFailoverSkew.skewMs,
			offsets: postFailoverSkew.timestamps.map((t) => t - postFailoverSkew.minTs),
		});

		// Revive the original master: same DUID (derived from its original index),
		// same group name, same SMIL. The sync server sees the identity returning.
		const revived = await addSyncDevice(browser, killedIndex, { smilUrl, groupName });
		devices = [...survivors, revived];

		// All 3 must converge. Generous budget — the revived device has to load the
		// SMIL, reconnect to the sync server, and catch up to the running group's
		// current element.
		await waitForConvergence(devices, l1, 120_000);

		// Next l1→l2 transition must complete on all 3 with loose tolerance. The
		// meaningful regression signal is a 30s timeout (revived device can't integrate)
		// or skew exceeding this post-revival tolerance.
		await Promise.all(devices.map((d) => l1(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })));
		const skew = await assertSynchronizedTransition(devices, l2, {
			label: 'post-revival: l1→l2 across all 3',
			maxSkewMs: 3000,
			timeoutMs: 30_000,
		});
		// eslint-disable-next-line no-console
		console.log(`[master-rejoin] post-revival skew=${skew.skewMs}ms`);
		recordSkew({
			test: testInfo.title,
			label: 'post-revival: l1→l2 across all 3',
			skewMs: skew.skewMs,
			offsets: skew.timestamps.map((t) => t - skew.minTs),
		});

		// First post-revival transition (above) keeps the loose tolerance — recovery
		// costs a beat. Subsequent transitions must return to the 500ms steady-state
		// bound; a PERMANENT post-recovery drift would surface here.
		await Promise.all(devices.map((d) => l2(d.page).first().waitFor({ state: 'hidden', timeout: 20_000 })));
		const steady1 = await assertSynchronizedTransition(devices, video, { label: 'post-recovery steady l2→video', maxSkewMs: 500, timeoutMs: 20_000 });
		recordSkew({ test: testInfo.title, label: 'post-recovery steady l2→video', skewMs: steady1.skewMs, offsets: steady1.timestamps.map((t) => t - steady1.minTs) });
		await Promise.all(devices.map((d) => video(d.page).first().waitFor({ state: 'hidden', timeout: 20_000 })));
		const steady2 = await assertSynchronizedTransition(devices, l1, { label: 'post-recovery steady video→l1', maxSkewMs: 500, timeoutMs: 20_000 });
		recordSkew({ test: testInfo.title, label: 'post-recovery steady video→l1', skewMs: steady2.skewMs, offsets: steady2.timestamps.map((t) => t - steady2.minTs) });
	});
});
