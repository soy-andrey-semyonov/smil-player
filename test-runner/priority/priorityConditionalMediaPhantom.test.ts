import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { durationCandidates } from '../duration/durationCandidates';

// Regression test for the "phantom playing slot" freeze: a conditional expr
// placed directly on a MEDIA element inside a priorityClass.
//
// Container-level expr (on seq/par/priorityClass) is evaluated by the
// traverser before the element registers with the priority system. Media-level
// expr was only evaluated inside playElement — AFTER priorityBehaviour had
// already marked the slot player.playing=true. The expr-false bail-out
// returned without releasing the slot, and exact-match re-registration
// preserved playing=true on every loop pass, so the never-rendering element
// blocked the region as a phantom: P2's defer wait below never released and
// the screen stayed black forever (observed 65+s in the live repro).
//
// P1 (higher): single <img expr="adapi-weekday()>=9"> — statically false.
// P2 (lower, lower="defer" on P1): img_2 + img_3 alternating (dur=3s each).
// Expected: P2's images cycle from startup at their nominal duration; the
// expr-disabled img_1 never appears. The two alternating P2 images give the
// duration monitor real visibility transitions to measure (a single looping
// image never hides between iterations and is therefore unmeasurable).
test.describe('priorityConditionalPhantom.smil test', () => {
	test('lower priority plays at correct duration when higher priority media is expr-disabled', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.priorityConditionalPhantom);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		monitor.watch(durationCandidates('priorityConditionalPhantom'));

		// Pre-fix this is the deadlock: img_2 never appears at all.
		await expect(frame.locator('img:visible[src*="images/img_2_18b5d21f.jpg"]')).toBeVisible({
			timeout: Timeouts.firstElement,
		});
		// The expr-false element must never render.
		await expect(frame.locator('img:visible[src*="images/img_1_aba14e1e.jpg"]')).not.toBeVisible({ timeout: 3000 });

		// Prove steady-state alternation: img_3 follows img_2, then img_2 again.
		await expect(frame.locator('img:visible[src*="images/img_3_4ac1868a.jpg"]')).toBeVisible({
			timeout: Timeouts.elementAwait,
		});
		await expect(frame.locator('img:visible[src*="images/img_2_18b5d21f.jpg"]')).toBeVisible({
			timeout: Timeouts.elementAwait,
		});
		await expect(frame.locator('img:visible[src*="images/img_1_aba14e1e.jpg"]')).not.toBeVisible({ timeout: 1000 });

		// Enforces the 3s nominal duration for both P2 images across observed cycles.
		await monitor.assertDurationsWithinTolerance();
	});
});
