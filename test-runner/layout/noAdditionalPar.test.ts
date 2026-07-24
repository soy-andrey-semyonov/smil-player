import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { testCoordinates, waitForLoaderOrSkip } from '../helpers';

// Layout fixture: 1920x1080 root-layout, four 50% regions.
// video-test-1 (_465b7757) → top-left  (left=0,   top=0,   w=960, h=540)
// landscape1   (_fe944bd5) → top-right (left=960, top=0,   w=960, h=540)
// video-test-2 (_0b02adc4) → bottom-left + bottom-right (2 instances)
test.describe('noAdditionalPar.smil test', () => {
	test('processes smil file correctly', async ({ page, context, smilUrls }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.noAdditionalPar);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await waitForLoaderOrSkip(page);

		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Exact per-hash counts: video-test-2 appears in exactly 2 regions.
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).toHaveCount(2);
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toHaveCount(1);

		// video-test-1 sits in top-left region (left=0, top=0, w=960, h=540).
		await testCoordinates(
			page.locator('video[src*="videos/video-test_465b7757.mp4"]'),
			0, 0, 960, 540,
		);

		// landscape1 sits in top-right region (left=960, top=0, w=960, h=540).
		await testCoordinates(
			frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]'),
			0, 960, 960, 540,
		);
		// await expect(page.locator('video[src*="videos/loader_871e2ff0.mp4"]')).toHaveCount(0);
	});
});
