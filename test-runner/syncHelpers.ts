import { Browser, BrowserContext, Page } from '@playwright/test';
import { createConsoleCollector } from './helpers';
import { DUID, EMULATOR_BASE } from './config';
import { startVisibilityMonitor, VisibilityMonitor } from './visibilityMonitor';

export const DEFAULT_SYNC_SERVER_URL = 'https://sync.signage-cdn.com';

/** Hostname substring used to filter sync-server WebSocket frames from any
 * incidental WS traffic the page might open. Matches DEFAULT_SYNC_SERVER_URL. */
const SYNC_WS_HOST_FILTER = 'sync.signage-cdn.com';

/**
 * One captured WebSocket frame on a SyncDevice. Buffer payloads are base64-
 * encoded into `payload` and flagged with `isBinary: true`; text frames keep
 * their string verbatim. `timestamp` is controller-side `Date.now()` at the
 * moment Playwright fired the frame event.
 */
export interface WsFrame {
	direction: 'sent' | 'received';
	timestamp: number;
	payload: string;
	isBinary: boolean;
	url: string;
}

export interface SyncDevice {
	context: BrowserContext;
	page: Page;
	console: ReturnType<typeof createConsoleCollector>;
	/** All WebSocket frames captured from sync-server connections opened by
	 * this device's page. Populated automatically by `createSyncGroup`. */
	wsFrames: WsFrame[];
	duid: string;
	deviceId: string;
	/** Per-device visibility-duration monitor; auto-started on page load,
	 * stopped by `cleanupSyncGroup`. Tests opt in by calling
	 * `device.monitor.watch([...])` to declare candidates and
	 * `await device.monitor.assertDurationsWithinTolerance(...)` at the end. */
	monitor: VisibilityMonitor;
}

export interface SyncGroupOptions {
	smilUrl: string;
	groupName: string;
	syncServerUrl?: string;
	deviceCount?: number;
	launchStaggerMs?: number;
	emulatorUrl?: string;
	viewport?: { width: number; height: number };
	/** Hard cap on per-device captured WS frames. Default 20_000 handles ~10 min
	 * of typical sync traffic; longer tests should raise or disable this. */
	wsFramesMaxLen?: number;
	/** Hard cap on collected console messages per device. Default 10_000 keeps
	 * typical 1–2 min sync runs well within memory; raise for long-running tests. */
	consoleMaxMessages?: number;
	/** Per-device wall-clock offsets (ms), indexed by device. `clockOffsetsMs[i]`
	 * is forwarded to device `i` as `clockOffsetMs` (default 0 → native clock).
	 * Lets one device in the group run a skewed clock to stress sync
	 * convergence — see `addSyncDevice`'s `clockOffsetMs`. */
	clockOffsetsMs?: number[];
}

export interface AddSyncDeviceOptions {
	smilUrl: string;
	groupName: string;
	syncServerUrl?: string;
	emulatorUrl?: string;
	viewport?: { width: number; height: number };
	wsFramesMaxLen?: number;
	consoleMaxMessages?: number;
	/** Offset (ms) applied to this device's wall clock via an init-script Date
	 * shim installed before navigation. Skews everything the page reads as
	 * "now" — `Date.now()`, argless `new Date()`, and `moment()` built on them,
	 * including the player's wallclock element evaluation — while leaving date
	 * parsing (`new Date(arg)`, `Date.parse`, `Date.UTC`) intact. Default 0
	 * (native clock). Used to exercise clock-skew convergence. */
	clockOffsetMs?: number;
}

/** Set up a single sync-aware device: new browser context, console/WS capture,
 * SMIL + sync config injection, navigate to the emulator. Used both by
 * `createSyncGroup` (in a loop) and by tests that add devices mid-run (e.g. the
 * late-join scenario) to exercise the same init flow as the initial cohort. */
export async function addSyncDevice(
	browser: Browser,
	index: number,
	opts: AddSyncDeviceOptions,
): Promise<SyncDevice> {
	const {
		smilUrl,
		groupName,
		syncServerUrl = DEFAULT_SYNC_SERVER_URL,
		emulatorUrl = EMULATOR_BASE,
		viewport = { width: 1080, height: 1920 },
		wsFramesMaxLen = 20_000,
		consoleMaxMessages = 10_000,
		clockOffsetMs = 0,
	} = opts;

	const duid = DUID.slice(0, 48) + index.toString().padStart(2, '0');
	const deviceId = `dev-${index}`;
	const context = await browser.newContext({ viewport, bypassCSP: true });
	const page = await context.newPage();
	const collector = createConsoleCollector(page, { maxMessages: consoleMaxMessages });
	// WebSocket frame capture. Listener attaches before page.goto so the
	// sync-server WS opened later by the player (after connectSyncSafe) is
	// caught from its first frame. Filter by host to ignore incidental WS
	// traffic. Buffer payloads are base64-encoded; text payloads pass through.
	//
	// Buffer-pressure visibility: once captured frame count crosses 95 % of
	// `wsFramesMaxLen` we warn once (room for one more burst before drops
	// start), and once it actually wraps we warn once more. Both messages
	// include the deviceId so a long sync test that loses early frames in
	// silence is now self-diagnosing — bump `wsFramesMaxLen` via
	// `addSyncDevice` / `createSyncGroup` opts for that test.
	const wsFrames: WsFrame[] = [];
	const warnAtLen = Math.floor(wsFramesMaxLen * 0.95);
	let warnedNearCap = false;
	let warnedOverflow = false;
	const onPush = () => {
		if (!warnedNearCap && wsFrames.length >= warnAtLen) {
			warnedNearCap = true;
			// eslint-disable-next-line no-console
			console.warn(
				`[syncHelpers] device ${deviceId} wsFrames at ${wsFrames.length}/${wsFramesMaxLen}`
				+ ` (≥95 % capacity). Raise wsFramesMaxLen if this test needs the early frames preserved.`,
			);
		}
		if (wsFrames.length > wsFramesMaxLen) {
			if (!warnedOverflow) {
				warnedOverflow = true;
				// eslint-disable-next-line no-console
				console.warn(
					`[syncHelpers] device ${deviceId} wsFrames OVERFLOW (cap=${wsFramesMaxLen})`
					+ ` — now dropping oldest frames FIFO. Downstream assertions over the buffer`
					+ ` will only see the most recent ${wsFramesMaxLen} frames.`,
				);
			}
			wsFrames.shift();
		}
	};
	page.on('websocket', (ws) => {
		if (!ws.url().includes(SYNC_WS_HOST_FILTER)) return;
		const url = ws.url();
		ws.on('framesent', (event) => {
			const payload = event.payload;
			wsFrames.push({
				direction: 'sent',
				timestamp: Date.now(),
				payload: typeof payload === 'string' ? payload : payload.toString('base64'),
				isBinary: typeof payload !== 'string',
				url,
			});
			onPush();
		});
		ws.on('framereceived', (event) => {
			const payload = event.payload;
			wsFrames.push({
				direction: 'received',
				timestamp: Date.now(),
				payload: typeof payload === 'string' ? payload : payload.toString('base64'),
				isBinary: typeof payload !== 'string',
				url,
			});
			onPush();
		});
	});
	await context.addInitScript(
		(cfg: {
			smilUrl: string;
			sync: {
				syncGroupName: string;
				syncDeviceId: string;
				syncServerUrl: string;
				debugEnabled: string;
			};
		}) => {
			(window as any).__SMIL_URL__ = cfg.smilUrl;
			// __SYNC_CONFIG__ flows to smilPlayer.ts as configOverrides and is
			// applied key-by-key to sos.config. Including `debugEnabled: 'true'`
			// is what makes the player re-enable @signageos/smil-player:* debug
			// logs after its Debug.disable() call — the sync assertions grep
			// console for [sync]/[syncGroup] lines that only appear then.
			(window as any).__SYNC_CONFIG__ = cfg.sync;
		},
		{
			smilUrl,
			sync: {
				syncGroupName: groupName,
				syncDeviceId: deviceId,
				syncServerUrl,
				debugEnabled: 'true',
			},
		},
	);
	// Optional per-device wall-clock skew. A second init-script (runs in every
	// frame before page scripts, like the config one above) replaces the global
	// Date so `Date.now()`, argless `new Date()`, and `moment()` read a skewed
	// "now" — which is what the player's wallclock element evaluation uses. Date
	// parsing, Date.parse and Date.UTC are preserved so wallclock timestamp
	// strings still parse. Only installed for a non-zero offset, so unskewed
	// devices keep the native Date untouched.
	if (clockOffsetMs !== 0) {
		await context.addInitScript((offsetMs: number) => {
			const RealDate = Date;
			const skewedNow = () => RealDate.now() + offsetMs;
			const SkewedDate = function (...args: unknown[]) {
				return args.length === 0
					? new RealDate(skewedNow())
					: new (RealDate as unknown as { new (...a: unknown[]): Date })(...args);
			} as unknown as DateConstructor;
			SkewedDate.now = skewedNow;
			SkewedDate.parse = RealDate.parse;
			SkewedDate.UTC = RealDate.UTC;
			// DateConstructor.prototype is declared readonly; cast to a mutable
			// shape to assign it. Keeping the real Date.prototype is what makes
			// `x instanceof Date` still hold once globalThis.Date is replaced.
			(SkewedDate as { prototype: Date }).prototype = RealDate.prototype;
			(globalThis as { Date: DateConstructor }).Date = SkewedDate;
		}, clockOffsetMs);
	}
	await page.goto(`${emulatorUrl}/?duid=${duid}`);
	// FD emulator cold-boot watchdog — same guard as the non-sync page fixture
	// (see fixtures.ts): on a fast first boot the emulator can fail to mount
	// the applet iframe at all; wait for it and reload once if it never comes.
	const appletMounted = await page
		.waitForSelector('iframe', { state: 'attached', timeout: 20_000 })
		.then(() => true)
		.catch(() => false);
	if (!appletMounted && !page.isClosed()) {
		// eslint-disable-next-line no-console
		console.log(`[boot-watchdog] device ${deviceId}: applet iframe missing 20s after goto — reloading`);
		await page.reload();
	}
	// Start visibility monitor after goto so it polls a live page from frame 0.
	// Tests that don't care about durations simply never call monitor.watch().
	const monitor = startVisibilityMonitor(page, page.frameLocator('iframe'), []);
	return { context, page, console: collector, wsFrames, duid, deviceId, monitor };
}

export async function createSyncGroup(
	browser: Browser,
	opts: SyncGroupOptions,
): Promise<SyncDevice[]> {
	const { deviceCount = 3, launchStaggerMs = 1500, clockOffsetsMs, ...deviceOpts } = opts;
	const devices: SyncDevice[] = [];
	for (let i = 0; i < deviceCount; i++) {
		devices.push(await addSyncDevice(browser, i, { ...deviceOpts, clockOffsetMs: clockOffsetsMs?.[i] ?? 0 }));
		if (i < deviceCount - 1) {
			await new Promise((r) => setTimeout(r, launchStaggerMs));
		}
	}
	return devices;
}

export async function cleanupSyncGroup(devices: SyncDevice[]) {
	// Stop the visibility monitors first so their polling loop bails out
	// cleanly before the underlying contexts close.
	await Promise.allSettled(devices.map((d) => d.monitor.stop()));
	await Promise.allSettled(devices.map((d) => d.context.close()));
}

export function uniqueGroupName(testTitle: string): string {
	const slug = testTitle.replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase();
	return `smil-e2e-${slug}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
