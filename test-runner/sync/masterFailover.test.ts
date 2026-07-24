import { test } from '../fixtures';
import { cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import { performMasterFailover, assertSynchronizedTransition } from './syncAssertions';
import { recordSkew } from '../../tools/record-sync-skew.mjs';

// Group G: master failover. No existing test covers the slave-promotion path —
// SyncGroup.masterStatus is cached per-device, and killing the master mid-cycle
// must trigger a re-election on the sync server, with the promoted slave
// resuming coordination without inheriting stale resync targets or pending ACKs.
// If this test hangs or fails, that is a real finding about the platform's
// failover behaviour, not a test-quality issue — document the failure mode
// before attempting to adjust the test.
//
// The failover preamble (build group → steady state → kill master → re-elect →
// one post-promotion transition) is shared with the killed-master-rejoin test via
// performMasterFailover; this test then proves the survivors hold ≤500ms lockstep.

test.describe.configure({ mode: 'serial' });
test.describe('sync · master failover', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('killing master mid-cycle: survivor is promoted and sync resumes', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		const { survivors, l1, l2, video, postFailoverSkew } = await performMasterFailover(
			browser,
			{
				smilUrl: `${testServerBaseUrl}/syncFiles/cycleWrapBoundary.smil`,
				groupName: uniqueGroupName(testInfo.title),
			},
			(d) => {
				devices = d;
			},
		);
		// eslint-disable-next-line no-console
		console.log(`[failover] post-promotion skew=${postFailoverSkew.skewMs}ms`);
		recordSkew({
			test: testInfo.title,
			label: 'post-failover: landscape2→landscape1',
			skewMs: postFailoverSkew.skewMs,
			offsets: postFailoverSkew.timestamps.map((t) => t - postFailoverSkew.minTs),
		});

		// The first post-promotion transition (in performMasterFailover) keeps a loose
		// tolerance — recovery costs a beat. Subsequent transitions must return to the
		// 500ms steady-state bound; a PERMANENT post-recovery drift would surface here.
		await Promise.all(survivors.map((d) => l1(d.page).first().waitFor({ state: 'hidden', timeout: 20_000 })));
		const steady1 = await assertSynchronizedTransition(survivors, l2, { label: 'post-recovery steady l1→l2', maxSkewMs: 500, timeoutMs: 20_000 });
		recordSkew({ test: testInfo.title, label: 'post-recovery steady l1→l2', skewMs: steady1.skewMs, offsets: steady1.timestamps.map((t) => t - steady1.minTs) });
		await Promise.all(survivors.map((d) => l2(d.page).first().waitFor({ state: 'hidden', timeout: 20_000 })));
		const steady2 = await assertSynchronizedTransition(survivors, video, { label: 'post-recovery steady l2→video', maxSkewMs: 500, timeoutMs: 20_000 });
		recordSkew({ test: testInfo.title, label: 'post-recovery steady l2→video', skewMs: steady2.skewMs, offsets: steady2.timestamps.map((t) => t - steady2.minTs) });
	});
});
