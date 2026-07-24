import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

test.describe('prioritySeqCampaign.smil test', () => {
	test('production-style seq campaign rotation with priority', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.prioritySeqCampaign);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await waitForLoaderOrSkip(page);

		monitor.watch(durationCandidates('prioritySeqCampaign'));

		// P_high campaign, first pass: Campaign A (video-test-1 → img_1) then Campaign B (img_3).
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img:visible[src*="images/img_1_aba14e1e.jpg"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img:visible[src*="images/img_3_4ac1868a.jpg"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// The campaign ROTATES: the indefinite seq loops back to Campaign A — prove
		// video-test-1 + img_1 play AGAIN. The old test asserted each element exactly
		// once (video1 → img_1 → img_3 → img_2), an existence-only chain that passed
		// even if the campaign played one pass and froze instead of rotating. video-test-1's
		// src is nulled after playback, so re-matching it is a genuine new appearance.
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]'), 'campaign rotates back to Campaign A (video-test-1)').toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img:visible[src*="images/img_1_aba14e1e.jpg"]'), 'Campaign A img_1 plays again (rotation)').toBeVisible({ timeout: Timeouts.elementAwait });

		// After P_high's +60s wallclock window expires → P_low (Campaign C) plays AND
		// rotates: img_2 → video-test-2 → img_2 (not a single frozen img_2).
		await expect(frame.locator('img:visible[src*="images/img_2_18b5d21f.jpg"]'), 'P_low img_2 after window expiry').toBeVisible({ timeout: Timeouts.priorityTransition });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), 'P_low advances to video-test-2').toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img:visible[src*="images/img_2_18b5d21f.jpg"]'), 'P_low loops back to img_2 (rotation)').toBeVisible({ timeout: Timeouts.elementAwait });

		await monitor.assertDurationsWithinTolerance();
	});
});
