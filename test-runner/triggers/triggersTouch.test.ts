import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertVideoAdvancing, dispatchTouchEnd, testCoordinates } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

// Touch-input coverage for mouse triggers. The player binds origin="mouse"
// triggers to BOTH `click` and `touchend` (one shared handler), but every other
// trigger test fires page.click — the touch path is never exercised. This reuses
// the triggersMouseDuration fixture and fires a synthetic `touchend` (not a
// click) to prove a touch activates the trigger, plays the triggered video live,
// then auto-stops back to the default.
test.describe('triggersTouch (touchend on the mouse-trigger fixture)', () => {
	test('a touchend activates the trigger, plays a live video, then auto-stops to default', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.triggersMouseDuration);
		await page.goto(`/?duid=${DUID}`);
		monitor.watch(durationCandidates('triggersMouseDuration'));

		// Default content: video-test-1 in full region
		await expect(page.locator('video[src*="video-test_465b7757"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await testCoordinates(page.locator('video[src*="video-test_465b7757"]'), 10, 10, 1280, 720);

		// Fire a TOUCH (not a click) to activate the trigger.
		await page.waitForTimeout(Timeouts.transition);
		await dispatchTouchEnd(page);

		// Triggered content: video-test-2 takes over the region (default suppressed),
		// proving the touchend reached the shared mouse-trigger handler.
		await expect(page.locator('video[src*="video-test_0b02adc4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="video-test_0b02adc4"]'), 10, 10, 640, 720);
		await expect(page.locator('video:visible[src*="video-test_465b7757"]'), 'trigger suppresses the default').toHaveCount(0);

		// The triggered video plays for real — not a frozen single frame.
		await assertVideoAdvancing(page, 'video-test_0b02adc4');

		// After the trigger content finishes it AUTO-STOPS and the default resumes full-region.
		await expect(page.locator('video[src*="video-test_0b02adc4"]')).toHaveCount(0, { timeout: 15_000 });
		await expect(page.locator('video[src*="video-test_465b7757"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="video-test_465b7757"]'), 10, 10, 1280, 720);
		await monitor.assertDurationsWithinTolerance();
	});
});
