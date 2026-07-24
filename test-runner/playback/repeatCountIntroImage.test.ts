import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { testCoordinates, waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

test.describe('repeatCountIntroImage.smil test', () => {
	test('processes smil file correctly', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.repeatCountIntroImage);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');
		monitor.watch(durationCandidates('repeatCountIntroImage'));

		// This fixture's intro is an IMAGE (landscape2 as rootLayout-img0, cf.
		// repeatCountIntroVideo's loader video). Whether it visibly mounts is a
		// race against prefetch — with a warm asset cache it is usually skipped.
		// The player must process the intro tag and play the content either way.
		await waitForLoaderOrSkip(page);

		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await testCoordinates(page.locator('video[src*="videos/video-test_465b7757.mp4"]'), 0, 0, 1920, 1080);

		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape1"][id*=".jpg-main-img2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-main-img2"]'), 0, 0, 1920, 1080);

		await expect(frame.locator('img[id*="landscape1"][id*=".jpg-main-img2"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape2"][id*=".jpg-main-img3"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*="landscape2"][id*=".jpg-main-img3"]'), 0, 0, 1920, 1080);

		await expect(frame.locator('img[id*="landscape1"][id*=".jpg-main-img2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape2"][id*=".jpg-main-img3"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-main-img2"]'), 0, 0, 1920, 1080);

		await expect(frame.locator('img[id*="landscape1"][id*=".jpg-main-img2"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape2"][id*=".jpg-main-img3"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*="landscape2"][id*=".jpg-main-img3"]'), 0, 0, 1920, 1080);

		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape2"][id*=".jpg-main-img3"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), 0, 0, 1920, 1080);
		await page.waitForTimeout(Timeouts.videoTransition);

		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape2"][id*=".jpg-main-img3"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), 0, 0, 1920, 1080);

		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="videos/video-test_465b7757.mp4"]'), 0, 0, 1920, 1080);

		await monitor.assertDurationsWithinTolerance();
	});
});
