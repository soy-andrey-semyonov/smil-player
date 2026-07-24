import { test, expect } from '../fixtures';
import { DUID, Timeouts, SmilUrlsMap } from '../config';
import { testCoordinates } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

const LOADER = 'videos/loader_871e2ff0.mp4';
// Conditional content that must NEVER appear (no wallclock window / expr ever
// resolves active) — only the loader is allowed to loop.
const NEVER_VIDEOS = ['videos/video-test_465b7757.mp4', 'videos/video-test_0b02adc4.mp4'];
const NEVER_IMAGES = ['images/landscape1_fe944bd5.jpg', 'images/landscape2_2d654451.jpg'];

/**
 * noActivePar / noActiveSeq differ ONLY in whether the inactive `begin/end/expr`
 * conditional sits on the `<par>` (Par) or the inner `<seq>` (Seq); both must
 * resolve to "no branch is ever active", so the rendered output is identical —
 * the loader loops forever and none of the conditional media plays. The par-vs-seq
 * parser distinction is covered by `parseSmilSchedule` units; the e2e value here is
 * purely the render outcome, so both variants share one body.
 */
type Variant = {
	smilUrlKey: keyof SmilUrlsMap;
	durationKey: Parameters<typeof durationCandidates>[0];
	title: string;
};

const VARIANTS: Variant[] = [
	{ smilUrlKey: 'noActivePar', durationKey: 'wallclockNoActivePar', title: 'wallclockNoActivePar.smil — conditional on <par>' },
	{ smilUrlKey: 'noActiveSeq', durationKey: 'wallclockNoActiveSeq', title: 'wallclockNoActiveSeq.smil — conditional on <seq>' },
];

test.describe('wallclock no-active conditional', () => {
	for (const variant of VARIANTS) {
		test(variant.title, async ({ page, context, smilUrls, monitor }) => {
			await context.addInitScript((url: string) => {
				(window as unknown as { __SMIL_URL__?: string }).__SMIL_URL__ = url;
			}, smilUrls[variant.smilUrlKey]);

			await page.goto(`/?duid=${DUID}`);
			monitor.watch(durationCandidates(variant.durationKey));

			const loader = page.locator(`video[src*="${LOADER}"]`);
			await expect(loader).toBeVisible({ timeout: Timeouts.firstElement });
			await testCoordinates(loader, 0, 0, 1920, 1080);

			await page.waitForTimeout(Timeouts.videoTransition);

			await expect(loader).toBeVisible({ timeout: Timeouts.elementAwait });

			await page.waitForTimeout(Timeouts.videoTransition);

			await expect(loader).toBeVisible({ timeout: Timeouts.elementAwait });
			await testCoordinates(loader, 0, 0, 1920, 1080);

			// The wallclock/conditional content must NEVER appear — only the loader
			// loops. Without these checks a regression that wrongly activates a
			// branch would pass silently (the registry entries are minOccurrences:0).
			const frame = page.frameLocator('iframe');
			for (const video of NEVER_VIDEOS) {
				await expect(page.locator(`video[src*="${video}"]`)).toHaveCount(0);
			}
			for (const image of NEVER_IMAGES) {
				await expect(frame.locator(`img[src*="${image}"]`)).toHaveCount(0);
			}
			await monitor.assertDurationsWithinTolerance();
		});
	}
});
