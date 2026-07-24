import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertHigherPriorityUninterrupted, waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

// Tests that lower="stop" does NOT stop the higher-priority element when a lower
// arrives. Without the fix in handlePriorityBeforePlay, handleStopBehaviour acts on
// previousPlayingIndex (the higher element), permanently killing it and letting the
// lower take over. The fix remaps lower="stop" → never in this branch.
//
// Verified empirically: without the remap, P_high is stopped and P_low takes over.
// With the remap, P_high plays throughout its window and P_low plays after.
//
// Note: handleNeverBehaviour only sleeps 100ms, so P_low may briefly flicker visible
// (same limitation as priorityNever test). The key assertion is that P_high CONTINUES
// playing — it was not stopped.
test.describe('priorityLowerStop.smil test', () => {
	test('lower="stop" does not kill higher-priority content', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as unknown as { __SMIL_URL__?: string }).__SMIL_URL__ = url;
		}, smilUrls.priorityLowerStop);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Loader may be skipped if files are cached from a previous run
		await waitForLoaderOrSkip(page);

		monitor.watch(durationCandidates('priorityLowerStop'));

		// P_high (lower="stop", highest priority) plays then keeps looping — the critical
		// assertion: P_high was NOT stopped when the lower-priority element arrived.
		await assertHigherPriorityUninterrupted(
			page,
			frame,
			'videos/video-test_465b7757.mp4',
			'images/img_1_aba14e1e.jpg',
		);

		// P_high wallclock ends at +90s → P_low finally plays. Prove P_low actually
		// CYCLES through BOTH images (img_2 → img_3 → img_2), not just that the same
		// OR-locator stays satisfied: the old "continues looping" assert reused the
		// same img_2-OR-img_3 locator, so a release-then-deadlock frozen on one image
		// passed. Each step matches only a NEW appearance (the other image hides it
		// in between); ordering-robust because each waits for its specific image.
		const pLowImg2 = frame.locator('img:visible[src*="images/img_2_18b5d21f.jpg"]');
		const pLowImg3 = frame.locator('img:visible[src*="images/img_3_4ac1868a.jpg"]');
		await expect(pLowImg2, 'P_low img_2 plays after release').toBeVisible({ timeout: Timeouts.priorityWideWindowRelease });
		await expect(pLowImg3, 'P_low advances to img_3').toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(pLowImg2, 'P_low loops back to img_2 (forward progress past first appearance)').toBeVisible({ timeout: Timeouts.elementAwait });

		await monitor.assertDurationsWithinTolerance();
	});
});
