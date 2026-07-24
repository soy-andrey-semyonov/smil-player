import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';

// Standard-mode (`type="standard"`) reporting coverage.
//
// Two reporting transports exist (filesManager.ts sendDownloadReport /
// sendMediaReport):
//   - manual (proof-of-play) -> POSTed to an HTTP endpoint (covered by
//     customEndpointReporting / reportMode).
//   - standard               -> dispatched via `sos.command.dispatch(report)`
//     as typed SMIL.* command records. NOTHING covered this path before.
//
// `sos.command.dispatch` is not HTTP: the front-applet forwards it from the
// applet iframe to the emulator parent via `window.parent.postMessage(
// { invocationUid, type, command }, '*')` (front-applet FrontApplet.postMessage).
// We capture it by listening for those messages on the emulator MAIN page (the
// same-origin receiver) and recording every `command` whose type starts with
// `SMIL.` into `window.__capturedReports`. No production code is touched and the
// cross-origin iframe is sidestepped entirely.

const CAPTURE_HOOK = () => {
	const w = window as unknown as { __capturedReports?: unknown[] };
	w.__capturedReports = w.__capturedReports || [];
	window.addEventListener('message', (event: MessageEvent) => {
		const command = (event.data as { command?: { type?: unknown } } | null)?.command;
		if (command && typeof command.type === 'string' && command.type.indexOf('SMIL.') === 0) {
			w.__capturedReports!.push(command);
		}
	});
};

// Timestamps are dispatched as Date objects; structured-clone (postMessage) and
// Playwright's evaluate serialization both round-trip them as Date, so the field
// arrives as a Date here rather than a string.
type Timestamp = string | Date | null;
type CapturedReport = {
	type: string;
	itemType?: string;
	source?: { uri?: string; localUri?: string; filePath?: { path?: string; storage?: string } };
	startedAt?: Timestamp;
	endedAt?: Timestamp;
	succeededAt?: Timestamp;
	failedAt?: Timestamp;
	errorMessage?: string | null;
};

const isTimestamp = (value: Timestamp | undefined): boolean =>
	value != null && !Number.isNaN(new Date(value).getTime());

// FileDownloaded reports the original source URL (.../landscape1.jpg); MediaPlayed
// reports the resolved local URL with the checksummed filename
// (.../landscape1_1e76bb49.jpg?__smil_version=...). This matches both.
const LANDSCAPE_RE = /landscape\d.*\.jpg/;

test.describe('standardReporting.smil — standard-mode SMIL.* dispatch', () => {
	test('dispatches typed SMIL.MediaPlayed and SMIL.FileDownloaded records', async ({
		page,
		context,
		smilUrls,
	}) => {
		await context.addInitScript(CAPTURE_HOOK);
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.standardReporting);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Cycle landscape1 -> landscape2 -> landscape1 so both images complete a
		// full playback (which is what makes sendMediaReport fire) before reading.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		// Let the just-finished playback's report settle on the parent message bus.
		await page.waitForTimeout(1000);

		const reports = await page.evaluate(
			() => ((window as any).__capturedReports as CapturedReport[]) || [],
		);

		// FileDownloaded: emitted for each downloaded media during prepare.
		const downloads = reports.filter((r) => r.type === 'SMIL.FileDownloaded');
		expect(downloads.length, 'expected at least one SMIL.FileDownloaded record').toBeGreaterThan(0);
		const imageDownload = downloads.find((r) => LANDSCAPE_RE.test(r.source?.uri ?? ''));
		expect(imageDownload, 'expected a FileDownloaded record for a landscape image').toBeTruthy();
		expect(imageDownload!.itemType).toBe('image');
		expect(isTimestamp(imageDownload!.startedAt), 'FileDownloaded.startedAt timestamp').toBe(true);
		expect(isTimestamp(imageDownload!.succeededAt), 'FileDownloaded.succeededAt timestamp').toBe(true);
		expect(imageDownload!.failedAt, 'a successful download has no failedAt').toBeNull();

		// MediaPlayed: emitted after a media element finishes a playback.
		const played = reports.filter((r) => r.type === 'SMIL.MediaPlayed');
		expect(played.length, 'expected at least one SMIL.MediaPlayed record').toBeGreaterThan(0);
		const imagePlayed = played.find((r) => LANDSCAPE_RE.test(r.source?.uri ?? ''));
		expect(imagePlayed, 'expected a MediaPlayed record for a landscape image').toBeTruthy();
		// Non-sync run => plain MediaPlayed, never the -Synced variant.
		expect(reports.some((r) => r.type === 'SMIL.MediaPlayed-Synced')).toBe(false);
		expect(imagePlayed!.itemType).toBe('image');
		expect(imagePlayed!.source?.localUri, 'MediaPlayed.source.localUri present').toBeTruthy();
		expect(isTimestamp(imagePlayed!.startedAt), 'MediaPlayed.startedAt timestamp').toBe(true);
		expect(isTimestamp(imagePlayed!.endedAt), 'MediaPlayed.endedAt timestamp on success').toBe(true);
		expect(imagePlayed!.failedAt, 'a successful playback has no failedAt').toBeNull();
		expect(imagePlayed!.errorMessage, 'a successful playback has no errorMessage').toBeNull();
	});
});

test.describe('standardManualReporting.smil — standard dispatch coexists with manual', () => {
	test('standard SMIL.* records still dispatch when type="manual,standard"', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		await context.addInitScript(CAPTURE_HOOK);
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.standardManualReporting);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await page.waitForTimeout(1000);

		// Standard path: the SMIL.* dispatch fires despite manual also being on.
		const reports = await page.evaluate(
			() => ((window as any).__capturedReports as CapturedReport[]) || [],
		);
		expect(
			reports.some((r) => r.type === 'SMIL.MediaPlayed'),
			'standard SMIL.MediaPlayed must still dispatch in combined manual,standard mode',
		).toBe(true);

		// Manual path: the proof-of-play report also reached the HTTP endpoint,
		// proving BOTH transports run for type="manual,standard".
		const history = await (await request.get(`${testServerBaseUrl}/report/history`)).json();
		const allRecords = history.flatMap((r: any) => r.body);
		expect(
			allRecords.some((r: any) => r.name === 'media-playback'),
			'manual media-playback report must reach the endpoint in combined mode',
		).toBe(true);
	});
});
