import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// Tests the `reportFileLimit` meta attribute, which caps how many PoP reports
// accumulate in a single offline-storage file before rolling over to a new one.
//
// writeCustomEndpointInfo (filesManager) rolls over when a file's report count
// would exceed reportFileLimit: it increments the file index, logs
// "record limit exceeded", and creates offlineReports<N+1>.csv. With both images
// in reportMode="batch", every playback report is written to offline storage, so
// accumulation is deterministic. reportFileLimit=2 means the 3rd report rolls over.
//
// The offline-reports watcher runs on a 10-minute cadence and skips an active
// batch file still under its limit, so it does not interfere within the test
// window — the files simply accumulate and roll over.
test.describe('reportFileLimitRollover.smil test', () => {
	test('rolls over to a new offline report file when reportFileLimit is reached', async ({
		page,
		context,
		smilUrls,
	}) => {
		const collector = createConsoleCollector(page);

		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.reportFileLimitRollover);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Confirm the playlist is cycling (both 2s images visible at least once).
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Reports are batch-saved offline; confirm the batch branch is taken.
		await waitForConsolePattern(collector, 'report mode is batch, saving to offline storage', 1, 15000);

		// With reportFileLimit=2, the 3rd accumulated report must trigger a rollover.
		// At ~2 reports per 4s cycle, this lands within a few cycles.
		await waitForConsolePattern(collector, 'record limit exceeded', 1, 30000);

		// Rollover means a SECOND offline report file was created (file index 0 then 1).
		// The debug template emits "creating new file: %s" verbatim to the console
		// (the path arg is not substituted in the captured text), so each distinct
		// file creation contributes one occurrence — at least two means it rolled over.
		expect(
			collector.count('creating new file'),
			'expected at least two offline report files (rollover created a second)',
		).toBeGreaterThanOrEqual(2);
	});
});
