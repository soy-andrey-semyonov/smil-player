import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';
// Tests the lower="never" priority behavior: lower-priority content is
// prevented from beginning while the higher-priority element is active
// (SMIL 3.0 spec: "the begin of the new element is ignored").
// After P_high wallclock expires, P_low plays normally.
test.describe('priorityNever.smil test', () => {
	test('lower-priority content blocked by never rule until higher ends', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.priorityNever);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Loader may be skipped if files are cached from a previous run
		await waitForLoaderOrSkip(page);

		monitor.watch(durationCandidates('priorityNever'));

		// P_high (highest priority, lower="never") plays: video-test-1 + img_1 loop
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toBeVisible({ timeout: Timeouts.firstElement });

		await expect(frame.locator('img:visible[src*="images/img_1_aba14e1e.jpg"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Verify P_low content is NOT visible while P_high is active (core "never" assertion)
		await expect(frame.locator('img[src*="images/img_3_4ac1868a.jpg"]')).not.toBeVisible({ timeout: 3000 });
		await expect(frame.locator('img[src*="images/img_2_18b5d21f.jpg"]')).not.toBeVisible({ timeout: 3000 });

		// P_high loops another iteration
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img:visible[src*="images/img_1_aba14e1e.jpg"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// P_high wallclock ends at +40s → P_low finally plays. Prove P_low actually
		// CYCLES (img_3 → img_2 → img_3), not just that one image appears once: a
		// release-then-deadlock — the exact bug class this suite exists to catch —
		// would surface a single P_low image and then freeze, which the old single
		// OR-locator assertion passed. Each step matches only a NEW appearance
		// (the other image hides this one in between).
		const pLowImg3 = frame.locator('img:visible[src*="images/img_3_4ac1868a.jpg"]');
		const pLowImg2 = frame.locator('img:visible[src*="images/img_2_18b5d21f.jpg"]');
		await expect(pLowImg3, 'P_low img_3 first appearance after release').toBeVisible({ timeout: Timeouts.priorityTransition });
		await expect(pLowImg2, 'P_low advances to img_2').toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(pLowImg3, 'P_low loops back to img_3 (forward progress past first appearance)').toBeVisible({ timeout: Timeouts.elementAwait });

		await monitor.assertDurationsWithinTolerance();
	});
});
