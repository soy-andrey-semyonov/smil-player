import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// Tests the offline-report upload flow: when the custom reporting endpoint is
// unreachable, the player saves PoP reports to offline storage (savedReason
// 'failure'); when the endpoint returns, the offline-reports watcher uploads
// them tagged isOfflineReport: true and deletes the local file.
//
// Timing note: the watcher runs on a 10-minute cadence and its first pass fires
// at player startup. To exercise the upload without a 10-minute wait we restart
// the player (page.reload, same context so offline storage persists) AFTER the
// endpoint recovers — on restart the in-memory tracking is empty, so the
// persisted failure file is NOT treated as an active batch file and uploads on
// the first pass. This mirrors the real device-reconnect path.
test.describe('offlineReportUpload.smil test', () => {
	test('saves reports offline while the endpoint is down, then uploads them on reconnect', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);

		// Phase 0: endpoint is "down" before the player starts, so every report 503s.
		await request.post(`${testServerBaseUrl}/report/fail-mode`, { data: { fail: true } });

		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.offlineReportUpload);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Playlist runs normally even though reporting is failing.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });

		// Phase 1: report POSTs fail and get written to offline storage.
		await waitForConsolePattern(collector, 'custom report error', 1, 20000);
		await waitForConsolePattern(collector, 'creating new file', 1, 20000);

		// Nothing reached the endpoint while it was down.
		const downResp = await request.get(`${testServerBaseUrl}/report/history`);
		expect(await downResp.json(), 'no reports should be recorded while endpoint is down').toEqual([]);

		// Phase 2: endpoint recovers, then restart the player so the watcher's first
		// pass uploads the persisted offline reports.
		await request.post(`${testServerBaseUrl}/report/fail-mode`, { data: { fail: false } });
		await page.reload();
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });

		// Phase 3: the watcher finds, uploads and deletes the offline report file.
		await waitForConsolePattern(collector, 'sending offline report', 1, 30000);

		// The uploaded records are tagged isOfflineReport: true.
		await expect
			.poll(
				async () => {
					const resp = await request.get(`${testServerBaseUrl}/report/history`);
					const reports = await resp.json();
					const allRecords = reports.flatMap((r: any) => r.body);
					return allRecords.filter((r: any) => r.isOfflineReport === true).length;
				},
				{ timeout: 20000, message: 'expected at least one uploaded offline report (isOfflineReport: true)' },
			)
			.toBeGreaterThan(0);
	});
});
