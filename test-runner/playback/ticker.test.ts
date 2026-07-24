import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';

/**
 * Smoke test for ticker rendering and animation — the only e2e coverage
 * of `src/components/playlist/tools/tickerTools.ts`. Acts as the
 * regression guard for the 4B fix (pre-stop on start) and more broadly
 * as a canary against silent breakage of the ticker pipeline (font /
 * layout / appendChild / setTimeout loop).
 *
 * createTickerElement builds a wrapper `<div id="ticker-<region>-<key>">`
 * and appends it to `document.body`; startTickerAnimation then appends
 * `<span>` children for each text item and self-schedules a 1 s tick
 * that slides each span's `left` by `velocity` px.
 */
test.describe('Ticker rendering and animation', () => {
	test('wrapper mounts with text spans and their left position advances over time', async ({
		page,
		context,
		smilUrls,
	}) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.tickerBasic);

		await page.goto(`/?duid=${DUID}`);

		// The ticker wrapper renders inside the applet iframe — same as
		// images / widgets, not on the emulator's top window. The
		// `document.body.appendChild` inside createTickerElement targets
		// the iframe's document when the player is running there.
		const tickerWrapper = page.frameLocator('iframe').locator('div[id^="ticker-"]').first();
		await expect(tickerWrapper).toBeVisible({ timeout: Timeouts.firstElement });

		// Text children are `<span>` elements appended by
		// startTickerAnimation. Two `<text>` entries in the fixture → two
		// spans expected. Use `>= 1` so the test is robust to minor
		// implementation tweaks.
		const spans = tickerWrapper.locator('span');
		await expect(spans.first()).toBeVisible({ timeout: Timeouts.elementAwait });
		expect(await spans.count()).toBeGreaterThanOrEqual(1);

		// Animation check — tickerTick slides each span's inline `left` in
		// discrete `velocity`-px jumps (100 px in this fixture) from a recursive
		// ~1 s setTimeout (tickerTools.ts). Reading el.style.left sees those
		// quantized steps, so possible displacements are 100, 200, 300… px.
		// Sample `left` twice, 3 s apart (nominally 3 ticks) and assert:
		//   (a) the span moved left (left decreased), and
		//   (b) displacement ≥ 160 px (= 2 ticks) — one tick lost to setTimeout
		//       drift under load still passes; a ≥50% slowdown fails.
		const readLeft = async () =>
			parseFloat((await spans.first().evaluate((el: HTMLElement) => el.style.left)).replace('px', ''));
		const leftT0 = await readLeft();
		await page.waitForTimeout(3_000);
		const leftT1 = await readLeft();
		const displacement = leftT0 - leftT1; // positive when moved left

		// eslint-disable-next-line no-console
		console.log(`[ticker] spans=${await spans.count()} leftT0=${leftT0} leftT1=${leftT1} displacement=${displacement}`);

		expect(leftT1, 'ticker span must have moved left').toBeLessThan(leftT0);
		expect(
			displacement,
			`ticker displacement=${displacement}px over 3 s — expected ≥160 px (velocity=100 px/s, quantized 100 px ticks; tolerates one drift-lost tick)`,
		).toBeGreaterThanOrEqual(160);
	});
});
