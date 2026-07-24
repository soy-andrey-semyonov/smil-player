import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// Tests the per-media `reportMode` attribute on PoP (proof-of-play) reporting.
//
// Two reporting paths exist for a playback report when a custom endpoint is set:
//   - reportMode="batch"   -> saveCustomEndpointInfo(payload, 'batch'): the report
//                             is written to offline storage and uploaded LATER by
//                             the offline-reports watcher (10-min cadence), so it
//                             does NOT hit the endpoint during the test window.
//   - (default / immediate) -> sendCustomEndpointReport(payload): the report is
//                             POSTed to the endpoint right away.
//
// Note: media-DOWNLOAD reports are never batched (sendDownloadReport always posts
// immediately), so /report/history will contain media-download records for BOTH
// images regardless of reportMode. The discriminator is the media-PLAYBACK record:
// it is present for the immediate image and absent for the batched one.
//
// Fixture reportModeBatch.smil cycles two images in a seq:
//   landscape1.jpg  reportMode="batch"     -> playback report goes offline
//   landscape2.jpg  (no reportMode = immediate) -> playback report posts now
test.describe('reportModeBatch.smil test', () => {
	test('batch playback reports go to offline storage; immediate ones post right away', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);

		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.reportModeBatch);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Phase 1: both images cycle at least once (batch image first, then immediate).
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		// Back to landscape1 — guarantees landscape2's playback (and report) completed.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// The batch image's playback report must take the offline-storage branch.
		await waitForConsolePattern(collector, 'report mode is batch, saving to offline storage', 1, 15000);

		// Let the immediate image's playback report settle at the endpoint.
		await page.waitForTimeout(2000);

		// Phase 2: inspect what actually reached the endpoint.
		const response = await request.get(`${testServerBaseUrl}/report/history`);
		const reports = await response.json();
		const allRecords = reports.flatMap((r: any) => r.body);

		const playbackRecords = allRecords.filter((r: any) => r.name === 'media-playback');
		expect(playbackRecords.length, 'expected at least one media-playback report').toBeGreaterThan(0);

		// The immediate image posted its playback report...
		const immediatePlayback = playbackRecords.filter((r: any) => (r.url || '').includes('landscape2'));
		expect(immediatePlayback.length, 'immediate image should post a media-playback report').toBeGreaterThan(0);

		// ...the batched image did NOT (it went to offline storage instead).
		const batchedPlayback = playbackRecords.filter((r: any) => (r.url || '').includes('landscape1'));
		expect(batchedPlayback.length, 'batched image must NOT post a media-playback report in-window').toBe(0);

		// Sanity: batching only affects reporting, not display — the batch image keeps cycling.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});
});
