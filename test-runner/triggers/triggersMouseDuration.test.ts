import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertVideoAdvancing, testCoordinates } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

test.describe('triggersMouseDuration.smil test', () => {
    // The triggered seq (begin="trigger2" dur="5") plays video-test-2 then img_2 and then
    // auto-stops, restoring the default. NOTE: the seq dur="5" does NOT cleanly cap the total
    // — the trailing img_2 (dur="5s") dominates, so the trigger actually holds ~10s; dur only
    // clips the leading video. So rather than assert a literal 5s, this verifies the meaningful
    // behavior: the triggered video plays LIVE (advances, not frozen — every .mp4 candidate is
    // expectedSec:0 so the monitor can't see this) and the trigger AUTO-STOPS back to default.
    // A too-short dur (e.g. 1) clips video-test-2 to <1s, so it cannot be shown to advance.
    test('mouse click trigger plays a live video then auto-stops back to default', async ({ page, context, smilUrls, monitor }) => {
        await context.addInitScript((url: string) => {
            (window as any).__SMIL_URL__ = url;
        }, smilUrls.triggersMouseDuration);
        await page.goto(`/?duid=${DUID}`);
        monitor.watch(durationCandidates('triggersMouseDuration'));

        // Default content: video-test-1 in full region
        await expect(page.locator('video[src*="video-test_465b7757"]')).toBeVisible({ timeout: Timeouts.firstElement });
        await testCoordinates(page.locator('video[src*="video-test_465b7757"]'), 10, 10, 1280, 720);

        // Click to activate trigger
        await page.waitForTimeout(Timeouts.transition);
        await page.click('body');

        // Triggered content: video-test-2 takes over the region (default hidden)
        await expect(page.locator('video[src*="video-test_0b02adc4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
        await testCoordinates(page.locator('video[src*="video-test_0b02adc4"]'), 10, 10, 640, 720);
        await expect(page.locator('video:visible[src*="video-test_465b7757"]'), 'trigger suppresses the default').toHaveCount(0);

        // The triggered video plays for real — not a frozen single frame. With dur="1" the
        // video is clipped below the sample window and this fails.
        await assertVideoAdvancing(page, 'video-test_0b02adc4');

        // After the trigger content finishes, it AUTO-STOPS and the default resumes in full region.
        await expect(page.locator('video[src*="video-test_0b02adc4"]')).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator('video[src*="video-test_465b7757"]')).toBeVisible({ timeout: Timeouts.elementAwait });
        await testCoordinates(page.locator('video[src*="video-test_465b7757"]'), 10, 10, 1280, 720);
        await monitor.assertDurationsWithinTolerance();
    });
});
