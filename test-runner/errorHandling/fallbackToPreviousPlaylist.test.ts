import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';

// ============================================================================
// OUTCOME smoke for fallbackToPreviousPlaylist="true".
//
// This test asserts the user-visible GUARANTEE: when a SMIL refresh starts
// returning invalid content, the previously-loaded playlist keeps cycling
// (no blank screen, no drop to the backup image). It does NOT exercise the
// explicit fallback code path in smilPlayer.ts:366-378
// ("[smil] ignoring invalid SMIL: fallbackToPreviousPlaylist enabled" /
// "[smil] skipping invalid SMIL from poll").
//
// WHY NOT — that path is UNREACHABLE from an e2e test on this branch, by
// design (re-verified 2026-06-22 by capturing the full [files]+[smil] debug
// stream across ~6 refresh cycles):
//   - The SMIL refresh uses the lastModified strategy (a HEAD request). The
//     broken refresh IS detected as new content every cycle
//     ("checkLastModified: New content detected ... downloading to temp folder").
//   - But the self-delete fix on this branch routes the SMIL download so it
//     never overwrites the standard file that main() re-reads
//     ("[smil] loaded SMIL content from local storage" — valid content, every
//     cycle). processSmilXml therefore never throws, so main()'s catch — the
//     ONLY caller of fallbackToPreviousPlaylist — never runs.
//   - Across the whole window: ZERO parse-error / fallback / backup-image
//     sentinels fire.
//
// Consequence: the fallbackToPreviousPlaylist="true" flag has NO observable
// effect in this setup (flipping it to "false" does not change the outcome),
// so this test cannot RED-green on the feature itself. Driving the real path
// would require writing broken bytes onto the standard SMIL path — i.e.
// defeating the self-delete fix this branch implements. The fallback MECHANISM
// therefore lacks real e2e coverage; tracked as a known gap in the remediation
// plan appendix. What this smoke still guards: a basic blank/freeze regression
// in steady-state playback (Phase 3 fails if the screen goes blank).
// ============================================================================
test.describe('fallbackToPreviousPlaylist.smil outcome smoke', () => {
	test.beforeEach(async ({ request, testServerBaseUrl }) => {
		// First request returns valid SMIL, subsequent requests return broken XML
		await request.post(`${testServerBaseUrl}/fallback-config`, {
			data: { fileName: 'fallbackToPrevious.smil', invalidAfterCount: 1 },
		});
	});

	test('previous playlist keeps cycling across a broken-refresh window (no blank, no backup)', async ({ page, context, smilUrls }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.fallbackToPreviousPlaylist);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Phase 1: Valid SMIL loads, both images cycle.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Phase 2: Let the ResourceChecker fire several broken-XML refreshes
		// (smilFileRefresh=5s) across this window.
		await page.waitForTimeout(22000);

		// Phase 3: The previous playlist must STILL be cycling — both images
		// re-appear after the broken-refresh window. Asserting both (not "either")
		// proves liveness: the player neither froze on a single frame nor went blank.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});
});
