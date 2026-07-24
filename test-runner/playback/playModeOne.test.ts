import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { testCoordinates, waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

// ============================================================================
// Sequencing + full-screen-coords smoke for playModeOne.smil.
//
// NOTE: this fixture CANNOT discriminate playMode="one". The <seq
// playMode="one"> is wrapped in <seq repeatCount="indefinite">, so whether
// playMode="one" advances one child per activation OR is treated as a no-op
// (plays all three children in order), the visible order is identical:
//   video-test-1 -> landscape1 -> landscape2 -> wrap -> video-test-1 ...
// This test therefore only proves the three elements render in order at
// full-screen coords (a real regression guard for region/layout + basic
// sequential playback). The actual playMode="one" one-child-per-activation
// selection semantics are verified by playModeOneFiniteRepeat.test.ts via its
// plays/activations ratio guard (~1 correct vs ~3 no-op).
// ============================================================================

test.describe('playModeOne.smil test', () => {
	test('renders its 3-element playlist in order at full-screen coords (playMode="one" correctness: see playModeOneFiniteRepeat)', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.playModeOne);
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');
		monitor.watch(durationCandidates('playModeOne'));

		// Loader during prefetch — may be skipped entirely with a warm asset cache
		await waitForLoaderOrSkip(page);

		// Element 1: video-test-1, full screen
		await expect(page.locator('video[src*="video-test_465b7757"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await testCoordinates(page.locator('video[src*="video-test_465b7757"]'), 0, 0, 1920, 1080);

		// Element 2: landscape1 image, full screen
		await expect(page.locator('video[src*="video-test_465b7757"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*="landscape1"]'), 0, 0, 1920, 1080);

		// Element 3: landscape2 image, full screen
		await expect(frame.locator('img[id*="landscape1"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*="landscape2"]'), 0, 0, 1920, 1080);

		// Wraps back to video-test-1 (sequential advance with wrap)
		await expect(frame.locator('img[id*="landscape2"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="video-test_465b7757"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="video-test_465b7757"]'), 0, 0, 1920, 1080);

		await monitor.assertDurationsWithinTolerance();
	});
});
