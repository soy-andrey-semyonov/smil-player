import { Browser, expect, Locator, Page } from '@playwright/test';
import { createSyncGroup, SyncDevice, WsFrame } from '../syncHelpers';

/**
 * Playwright's `msg.text()` concatenates the console format string with its
 * args rather than substituting `%s` / `%c`, so logs look like:
 *   `%c[syncGroup] initial master status: group=%s, isMaster=%s%c +0ms color1 color2 <groupname> true color3`
 * We match master-signalling logs from three sources in order of strongest evidence:
 *  1. `playlistProcessor.ts` "Master received all ... ACKs for ..." — only logged by
 *     the master after collecting ACKs, so a hard signal.
 *  2. `SyncGroup.ts` `isMaster()` initial-status log with the args ending in `true`.
 *  3. `SyncGroup.ts` onStatus handler logging "master status changed: ... false -> true".
 *  4. Generic "becoming master" phrase (defensive, may appear from native code).
 */
const MASTER_ELECTED_RE =
	/Master received all|isMaster[\s\S]*?\btrue\b|master status changed[\s\S]*?\b(false|null)\b[\s\S]*?\btrue\b|becoming\s+master/i;

export async function waitForMasterElection(
	devices: SyncDevice[],
	timeoutMs = 20000,
): Promise<SyncDevice> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const dev of devices) {
			if (dev.console.messages.some((m) => MASTER_ELECTED_RE.test(m.text))) {
				return dev;
			}
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(
		`No master elected within ${timeoutMs}ms. Console tails:\n` +
			devices
				.map((d, i) => `dev${i}:\n${d.console.messages.slice(-20).map((m) => m.text).join('\n')}`)
				.join('\n\n'),
	);
}

/**
 * Asserts each device's locator becomes visible within `timeoutMs`.
 * NOTE: This checks **eventual** visibility per device, not simultaneous visibility.
 * For "all devices show the same element at the same moment" use `waitForConvergence`.
 */
export async function assertAllDevicesShow(
	devices: SyncDevice[],
	locatorForPage: (p: Page) => Locator,
	timeoutMs = 15000,
) {
	await Promise.all(
		devices.map((d) => expect(locatorForPage(d.page)).toBeVisible({ timeout: timeoutMs })),
	);
}

/**
 * Asserts each device's locator becomes hidden within `timeoutMs`.
 * NOTE: This checks **eventual** non-visibility per device, not simultaneous.
 */
export async function assertAllDevicesHide(
	devices: SyncDevice[],
	locatorForPage: (p: Page) => Locator,
	timeoutMs = 15000,
) {
	await Promise.all(
		devices.map((d) => expect(locatorForPage(d.page)).not.toBeVisible({ timeout: timeoutMs })),
	);
}

/**
 * Extract the most recent syncIndex the device has seen in any log line.
 *
 * The player emits two flavours of sync log:
 *  - `logDebug(...)` — substitutes inline, yielding literal "syncIndex=3".
 *  - `debug(...)` (npm) + Playwright's msg.text() — preserves the raw format,
 *    so "syncIndex=%d" survives with the numeric value appearing later in the
 *    arg tail. The master side uses this path for "Broadcasted sync message"
 *    and the [syncGroup] "received" lines.
 *
 * Master-side lines we can still mine:
 *  - "Broadcasted sync message: type=%s, region=%s, syncIndex=%d, priorityBounds=%s"
 *    → tail: "... <region> <syncIndex> [<min>-<max>]" — match "(\\d+) \\[[\\d-]+\\]".
 *  - "Master received all %s ACKs for %s" where the second arg has form
 *    "<region>-<syncIndex>-ack-<type>" — match "-(\\d+)-ack-".
 *  - ACK / coordination keys like "...-<syncIndex>-ack-finished" in slaves too.
 */
export const SYNC_INDEX_PATTERNS: RegExp[] = [
	/\bsyncIndex=(\d+)\b/, // literal (timedDebug)
	/-(\d+)-ack-(?:prepared|playing|finished)\b/, // ACK key used by both roles
	/Broadcasted sync message:.*?\s(\d+)\s\[[\d-]+\]/, // master broadcast arg tail
];

/** Extract a syncIndex from a single log line. Returns the first match across
 * SYNC_INDEX_PATTERNS in declaration order, or null if none match. Separated
 * from `getLatestSyncIndex` so the regex contract can be unit-tested. */
export function extractSyncIndex(text: string): number | null {
	for (const p of SYNC_INDEX_PATTERNS) {
		const m = text.match(p);
		if (m) return parseInt(m[1], 10);
	}
	return null;
}

export function getLatestSyncIndex(dev: SyncDevice): number | null {
	const msgs = dev.console.messages;
	for (let i = msgs.length - 1; i >= 0; i--) {
		const v = extractSyncIndex(msgs[i].text);
		if (v !== null) return v;
	}
	return null;
}

/**
 * Poll all devices until every one reports the same syncIndex, or timeout.
 * Returns the agreed index and the measured controller-side skew — how many
 * ms elapsed between the first and last device landing on that value.
 *
 * Implementation: snapshot each device's `getLatestSyncIndex` every `pollMs`;
 * once all match, walk backwards through each device's console to find the
 * first message where that index appeared and use its timestamp for skew.
 */
export async function waitForSyncIndexAgreement(
	devices: SyncDevice[],
	opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ syncIndex: number; skewMs: number; firstSeenTs: number[] }> {
	const { timeoutMs = 30_000, pollMs = 200 } = opts;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const values = devices.map((d) => getLatestSyncIndex(d));
		if (values.every((v) => v !== null) && values.every((v) => v === values[0])) {
			const target = values[0] as number;
			const firstSeenTs = devices.map((d) => {
				const hit = d.console.messages.find((m) => extractSyncIndex(m.text) === target);
				return hit ? hit.time : Date.now();
			});
			const minTs = Math.min(...firstSeenTs);
			const maxTs = Math.max(...firstSeenTs);
			return { syncIndex: target, skewMs: maxTs - minTs, firstSeenTs };
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
	const snapshot = devices.map((d, i) => `dev${i}: syncIndex=${getLatestSyncIndex(d)}`).join(', ');
	throw new Error(`Devices did not agree on syncIndex within ${timeoutMs}ms. Last: ${snapshot}`);
}

/**
 * A named DOM-element candidate that can be checked for current visibility on a
 * given device. Used by `getVisibleElement` to build the rendered-state half of
 * the (syncIndex, visibleElement) snapshot.
 */
export interface ElementCandidate {
	name: string;
	locator: (p: Page) => Locator;
}

/**
 * Snapshot helper: returns the *names* of currently-visible candidates on the
 * page, joined with `+` if more than one is visible (briefly possible during a
 * transition where the new element mounts before the old hides). Returns null
 * if none are visible. Uses `isVisible()` (immediate; no polling) so it's safe
 * to call inside a tight snapshot loop.
 */
export async function getVisibleElement(
	page: Page,
	candidates: ElementCandidate[],
): Promise<string | null> {
	const results = await Promise.all(
		candidates.map(async (c) => ({
			name: c.name,
			visible: await c.locator(page).first().isVisible().catch(() => false),
		})),
	);
	const visible = results.filter((r) => r.visible).map((r) => r.name);
	if (visible.length === 0) return null;
	return visible.join('+');
}

export function countSyncEvents(dev: SyncDevice, pattern: RegExp): number {
	return dev.console.messages.filter((m) => pattern.test(m.text)).length;
}

/**
 * Returns true if ANY matching line appears in either `errors` or `messages`.
 * Despite the name, this searches logs at every level — use for "did this string
 * ever appear in the console" assertions regardless of log level.
 */
export function hasConsoleError(dev: SyncDevice, pattern: RegExp): boolean {
	return (
		dev.console.errors.some((e) => pattern.test(e)) ||
		dev.console.messages.some((m) => pattern.test(m.text))
	);
}

/**
 * Poll until every device's locator is visible simultaneously. Used to prove
 * master/slave converge to the same element. Loose check — does NOT measure
 * skew. Use `assertSynchronizedTransition` when you need to bound the gap.
 */
export async function waitForConvergence(
	devices: SyncDevice[],
	locatorForPage: (p: Page) => Locator,
	timeoutMs = 30000,
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const all = await Promise.all(devices.map((d) => locatorForPage(d.page).isVisible().catch(() => false)));
		if (all.every(Boolean)) return;
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(
		`Devices never converged within ${timeoutMs}ms.\nPer-device last messages:\n` +
			devices
				.map((d, i) => `dev${i}:\n${d.console.messages.slice(-10).map((m) => m.text).join('\n')}`)
				.join('\n\n'),
	);
}

/**
 * Minimum contract for `waitForWsQuiescence`. `SyncDevice` from syncHelpers
 * satisfies it via its `wsFrames: WsFrame[]` buffer, but the helper does not
 * need the full SyncDevice surface — keeping the parameter type narrow lets
 * unit tests pass plain objects with a growable array.
 */
export interface WsQuiescenceSource {
	readonly wsFrames: { readonly length: number };
}

/**
 * Resolve once every source's WebSocket frame count has held steady for
 * `quietMs` — meaning the current broadcast round has fully drained into the
 * client-side capture buffers. Use after a transition, priority change, or
 * any other point where a fixed `page.waitForTimeout(N)` was previously
 * "enough" to let the last ACKs land before inspecting WS state.
 *
 * Adaptive to CI variance: returns as soon as the quiet window is satisfied
 * (often < 400 ms on a clean run) and only extends on genuinely slow traffic.
 * Throws if `maxWaitMs` elapses without ever reaching the quiet window so
 * stuck-round symptoms fail loudly instead of silently corrupting the
 * downstream frame-inventory assertions.
 *
 * @param sources  devices (or any objects exposing a `wsFrames` array).
 * @param opts.quietMs    no-new-frames window before returning (default 300).
 * @param opts.maxWaitMs  hard ceiling (default 3_000).
 * @param opts.pollMs     poll interval (default 50).
 */
export async function waitForWsQuiescence(
	sources: ReadonlyArray<WsQuiescenceSource>,
	opts: { quietMs?: number; maxWaitMs?: number; pollMs?: number } = {},
): Promise<void> {
	const { quietMs = 300, maxWaitMs = 3_000, pollMs = 50 } = opts;
	const startedAt = Date.now();
	let lastCounts = sources.map((s) => s.wsFrames.length);
	let lastChangeAt = Date.now();

	while (Date.now() - startedAt < maxWaitMs) {
		await new Promise((r) => setTimeout(r, pollMs));
		const currentCounts = sources.map((s) => s.wsFrames.length);
		const changed = currentCounts.some((c, i) => c !== lastCounts[i]);
		if (changed) {
			lastCounts = currentCounts;
			lastChangeAt = Date.now();
		} else if (Date.now() - lastChangeAt >= quietMs) {
			return;
		}
	}
	throw new Error(
		`waitForWsQuiescence: WS traffic did not settle for ${quietMs}ms within `
		+ `${maxWaitMs}ms. Final frame counts: [${sources.map((s) => s.wsFrames.length).join(', ')}].`,
	);
}

export interface TransitionSkew {
	/** Controller-side wall-clock time each device reported the locator visible. */
	timestamps: number[];
	/** max(timestamps) - min(timestamps), the measured drift between devices. */
	skewMs: number;
	minTs: number;
	maxTs: number;
}

/**
 * Start `waitFor({ state: 'visible' })` concurrently on every device and
 * record `Date.now()` on each resolution. The spread across devices is the
 * observed sync drift. Call with a locator that is NOT yet visible — this
 * measures the transition into visibility, not the steady state.
 *
 * Measurement has some jitter from Playwright's internal ~100ms polling plus
 * websocket round-trip; that jitter is roughly symmetric across devices so
 * for tolerances ≥ ~500ms the measurement is meaningful.
 */
export async function measureTransitionSkew(
	devices: SyncDevice[],
	locatorForPage: (p: Page) => Locator,
	timeoutMs = 60000,
): Promise<TransitionSkew> {
	const timestamps = await Promise.all(
		devices.map(async (d) => {
			await locatorForPage(d.page).waitFor({ state: 'visible', timeout: timeoutMs });
			return Date.now();
		}),
	);
	const minTs = Math.min(...timestamps);
	const maxTs = Math.max(...timestamps);
	return { timestamps, skewMs: maxTs - minTs, minTs, maxTs };
}

/**
 * Measure a transition and fail if skew exceeds `maxSkewMs`. Returns the
 * measured TransitionSkew so the caller can log or aggregate it.
 */
export async function assertSynchronizedTransition(
	devices: SyncDevice[],
	locatorForPage: (p: Page) => Locator,
	opts: { maxSkewMs?: number; timeoutMs?: number; label?: string } = {},
): Promise<TransitionSkew> {
	const { maxSkewMs = 500, timeoutMs = 60000, label = 'transition' } = opts;
	const result = await measureTransitionSkew(devices, locatorForPage, timeoutMs);
	const offsets = result.timestamps.map((t) => t - result.minTs).join('ms, ');
	if (result.skewMs > maxSkewMs) {
		throw new Error(
			`Sync skew for "${label}" was ${result.skewMs}ms, exceeds tolerance ${maxSkewMs}ms. ` +
				`Per-device offsets from first: [${offsets}ms].`,
		);
	}
	return result;
}

// ============================================================================
// WebSocket cross-device assertions (calibrated 2026-04-13).
//
// Wire format on the sync server is Socket.IO over WebSocket. Application
// frames are `42[<event>, <args>]`. Outbound and inbound use different shapes:
//   sender → server:   42["request_set_value", { groupName, key, value }]
//   server → receiver: 42["set_value", "groupName", "key", { ... }]
// The inner `value` object is byte-identical end-to-end. Engine.IO control
// frames ("2probe", "5", …) and server-pushed `device_status` events are
// filtered out before any application processing.
//
// Correlation key for cross-device matching: (value.type, value.syncIndex,
// value.timestamp). value.timestamp is producer-side ms and unique per
// broadcast.
// ============================================================================

/** JSON.stringify with sorted object keys, so two semantically-equal values
 * compare equal even if the producer emitted keys in different order. Handles
 * nested objects recursively; arrays keep order. */
function stableStringify(v: unknown): string {
	return JSON.stringify(v, (_k, val) => {
		if (val && typeof val === 'object' && !Array.isArray(val)) {
			const out: Record<string, unknown> = {};
			for (const k of Object.keys(val).sort()) out[k] = (val as Record<string, unknown>)[k];
			return out;
		}
		return val;
	});
}

/** Inner sync-coordination payload — the `value` object from a Socket.IO frame.
 * Kept loose because the sync library is closed-source and the schema may grow. */
interface SyncValue {
	type: string;
	regionName?: string;
	syncIndex?: number;
	timestamp?: number;
	priorityLevel?: number;
	priorityMinSyncIndex?: number;
	priorityMaxSyncIndex?: number;
	[key: string]: unknown;
}

/** A parsed sync application frame. `null` for frames that aren't application
 * traffic (Engine.IO probes, device_status, malformed JSON). */
interface ParsedSyncFrame {
	frame: WsFrame;
	event: string;            // "request_set_value" | "set_value"
	value: SyncValue;
}

/** Stable correlation key for matching one logical broadcast across devices. */
function broadcastKey(v: SyncValue): string {
	return `${v.type}|${v.syncIndex ?? '?'}|${v.timestamp ?? '?'}`;
}

/** Parse a captured WS frame into a sync application frame, or null if it's
 * a non-application frame (Engine.IO probe, device_status, malformed). */
function parseSyncFrame(frame: WsFrame): ParsedSyncFrame | null {
	if (frame.isBinary) return null;
	const text = frame.payload;
	if (!text.startsWith('42[')) return null; // Engine.IO control frame
	let parsed: unknown;
	try {
		// Socket.IO event packet format: "42" prefix + JSON-array body.
		parsed = JSON.parse(text.slice(2));
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return null;
	const event = parsed[0];
	if (event === 'request_set_value') {
		// [event, { groupName, key, value }]
		const obj = parsed[1] as { value?: SyncValue } | undefined;
		if (!obj || typeof obj.value !== 'object' || obj.value === null) return null;
		if (typeof (obj.value as SyncValue).type !== 'string') return null;
		return { frame, event, value: obj.value as SyncValue };
	}
	if (event === 'set_value') {
		// [event, "groupName", "key", { ... }]
		const value = parsed[3] as SyncValue | undefined;
		if (!value || typeof value !== 'object' || typeof value.type !== 'string') return null;
		return { frame, event, value };
	}
	// device_status, connect/disconnect, etc — not application broadcasts.
	return null;
}

/** All parsed application frames on a device, in capture order. */
function parsedFrames(dev: SyncDevice): ParsedSyncFrame[] {
	const out: ParsedSyncFrame[] = [];
	for (const f of dev.wsFrames) {
		const p = parseSyncFrame(f);
		if (p !== null) out.push(p);
	}
	return out;
}

/** Per-device counts of sync-coordination message types, split by direction.
 * Drives `assertSyncMessageInventory`. */
export function categorizeWsFrames(dev: SyncDevice): Map<string, { sent: number; received: number }> {
	const out = new Map<string, { sent: number; received: number }>();
	for (const p of parsedFrames(dev)) {
		const slot = out.get(p.value.type) ?? { sent: 0, received: 0 };
		if (p.frame.direction === 'sent') slot.sent++;
		else slot.received++;
		out.set(p.value.type, slot);
	}
	return out;
}

interface FrameCountSymmetryOptions {
	/** Max allowed spread (max - min) between slave received counts.
	 * Default `Math.max(40, 0.10 * mean)`. Cross-slave count asymmetry is
	 * driven by network jitter — one slave lagging a round — which is an
	 * ~absolute magnitude (measured ≤5 typical, ~33 on a bad round across the
	 * suite) rather than proportional to the count, so a flat floor of 40
	 * absorbs the jitter tail while the 10% term scales for very large
	 * fixtures. This is a COARSE "neither slave is egregiously under-subscribed"
	 * check; fine-grained frame loss is caught deterministically by
	 * `assertSyncMessageInventory` (ACK parity) and
	 * `assertRenderedElementAgreement` (visual), so it is deliberately loose and
	 * only fires on gross asymmetry (a slave receiving far fewer frames). */
	slaveReceivedMaxSpread?: (mean: number) => number;
	/** Max allowed spread between slave sent counts. Default
	 * `Math.max(20, 0.20 * mean)`. Slave sent counts are smaller, and a slave
	 * that stops ACKing entirely is already caught by the `slaveAckSent > 0`
	 * assertion in `assertSyncMessageInventory`, so this only backstops gross
	 * send-side asymmetry. */
	slaveSentMaxSpread?: (mean: number) => number;
	/** Index of the master device in `devices`. Defaults to 0 (first-launched
	 * device wins master election in `createSyncGroup`'s staggered launch). */
	masterIndex?: number;
}

/** Assert per-device WebSocket frame counts cluster as expected for one master
 * and N-1 slaves. Counts only application sync frames (excludes Engine.IO
 * probes and `device_status` events). */
export function assertFrameCountSymmetry(
	devices: SyncDevice[],
	opts: FrameCountSymmetryOptions = {},
): void {
	const masterIndex = opts.masterIndex ?? 0;
	const slaveRecvSpread = opts.slaveReceivedMaxSpread ?? ((mean) => Math.max(40, 0.10 * mean));
	const slaveSentSpread = opts.slaveSentMaxSpread ?? ((mean) => Math.max(20, 0.20 * mean));

	const counts = devices.map((d) => {
		const parsed = parsedFrames(d);
		return {
			deviceId: d.deviceId,
			sent: parsed.filter((p) => p.frame.direction === 'sent').length,
			received: parsed.filter((p) => p.frame.direction === 'received').length,
		};
	});
	const slaveCounts = counts.filter((_, i) => i !== masterIndex);

	const slaveRecvMean = slaveCounts.reduce((s, c) => s + c.received, 0) / slaveCounts.length;
	const slaveRecvMax = Math.max(...slaveCounts.map((c) => c.received));
	const slaveRecvMin = Math.min(...slaveCounts.map((c) => c.received));
	const slaveRecvAllowed = slaveRecvSpread(slaveRecvMean);
	expect(
		slaveRecvMax - slaveRecvMin,
		`slave received-count spread ${slaveRecvMax - slaveRecvMin} > allowed ${slaveRecvAllowed.toFixed(1)} ` +
			`(counts: ${JSON.stringify(counts)})`,
	).toBeLessThanOrEqual(slaveRecvAllowed);

	const slaveSentMean = slaveCounts.reduce((s, c) => s + c.sent, 0) / slaveCounts.length;
	const slaveSentMax = Math.max(...slaveCounts.map((c) => c.sent));
	const slaveSentMin = Math.min(...slaveCounts.map((c) => c.sent));
	const slaveSentAllowed = slaveSentSpread(slaveSentMean);
	expect(
		slaveSentMax - slaveSentMin,
		`slave sent-count spread ${slaveSentMax - slaveSentMin} > allowed ${slaveSentAllowed.toFixed(1)} ` +
			`(counts: ${JSON.stringify(counts)})`,
	).toBeLessThanOrEqual(slaveSentAllowed);
}

/** Pure ratio: master's received ACK count divided by the ideal
 * `numSlaves × master cmd count`. 1.0 = perfect parity, < 1 = ACKs missing,
 * > 1 = duplicate / spurious ACKs. Returns 0 when the master has not yet
 * sent any cmd frames so callers can treat that as "no signal yet" rather
 * than "failed parity." Mirrors the math inside `assertSyncMessageInventory`
 * so the polling and final-assertion paths stay in lockstep. */
export function computeAckParityRatio(devices: SyncDevice[], masterIndex = 0): number {
	const slaves = devices.filter((_, i) => i !== masterIndex);
	const masterCats = categorizeWsFrames(devices[masterIndex]);
	const cmdTypes = ['cmd-prepare', 'cmd-play', 'cmd-finish'] as const;
	const ackTypes = ['ack-prepared', 'ack-playing', 'ack-finished'] as const;

	let masterCmdSent = 0;
	for (const t of cmdTypes) masterCmdSent += masterCats.get(t)?.sent ?? 0;
	if (masterCmdSent === 0 || slaves.length === 0) return 0;

	let masterAckRecv = 0;
	for (const t of ackTypes) masterAckRecv += masterCats.get(t)?.received ?? 0;

	return masterAckRecv / (masterCmdSent * slaves.length);
}

export interface RatioStableResult {
	elapsedMs: number;
	reason: 'stable' | 'maxReached';
	finalRatio: number;
}

/**
 * Poll `getRatio()` and return as soon as it has held inside
 * `[targetMin, targetMax]` for `stableSamplesNeeded` consecutive samples.
 * Always observes for at least `minObserveMs` (so we don't ship on a single
 * lucky sample), and never longer than `maxObserveMs`.
 *
 * Use to short-circuit a fixed observation window in a sync test once the
 * running parity ratio is clearly inside the assertion's tolerance band.
 *
 * Generic over `getRatio` so the helper can be unit-tested with a mock
 * function without involving real WS capture or Playwright.
 */
export async function waitForRatioStable(
	getRatio: () => number,
	opts: {
		minObserveMs?: number;
		maxObserveMs?: number;
		pollMs?: number;
		stableSamplesNeeded?: number;
		targetMin: number;
		targetMax: number;
	},
): Promise<RatioStableResult> {
	const {
		minObserveMs = 0,
		maxObserveMs = 60_000,
		pollMs = 1_000,
		stableSamplesNeeded = 3,
		targetMin,
		targetMax,
	} = opts;
	const startedAt = Date.now();

	if (minObserveMs > 0) {
		await new Promise((r) => setTimeout(r, minObserveMs));
	}

	let consecutiveStable = 0;
	let lastRatio = 0;
	while (Date.now() - startedAt < maxObserveMs) {
		lastRatio = getRatio();
		const inBand = lastRatio >= targetMin && lastRatio <= targetMax;
		consecutiveStable = inBand ? consecutiveStable + 1 : 0;
		if (consecutiveStable >= stableSamplesNeeded) {
			return { elapsedMs: Date.now() - startedAt, reason: 'stable', finalRatio: lastRatio };
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
	return { elapsedMs: Date.now() - startedAt, reason: 'maxReached', finalRatio: lastRatio };
}

/** Assert the protocol shape using per-type counts: master sends `cmd-*`
 * messages; each slave sends matching ACKs; master's received-ACK count
 * approximates `(devices.length - 1) × master's sent cmd count`. */
export function assertSyncMessageInventory(
	devices: SyncDevice[],
	opts: { masterIndex?: number; ackCountTolerancePct?: number } = {},
): void {
	const masterIndex = opts.masterIndex ?? 0;
	const tolerancePct = opts.ackCountTolerancePct ?? 0.25;
	const slaves = devices.filter((_, i) => i !== masterIndex);

	const masterCats = categorizeWsFrames(devices[masterIndex]);
	const cmdTypes = ['cmd-prepare', 'cmd-play', 'cmd-finish'] as const;
	const ackTypes = ['ack-prepared', 'ack-playing', 'ack-finished'] as const;

	let masterCmdSent = 0;
	for (const t of cmdTypes) masterCmdSent += masterCats.get(t)?.sent ?? 0;
	expect(masterCmdSent, `master sent zero cmd-* frames (cats: ${[...masterCats]})`).toBeGreaterThan(0);

	for (const dev of slaves) {
		const cats = categorizeWsFrames(dev);
		let slaveAckSent = 0;
		for (const t of ackTypes) slaveAckSent += cats.get(t)?.sent ?? 0;
		expect(slaveAckSent, `slave ${dev.deviceId} sent zero ack-* frames (cats: ${[...cats]})`).toBeGreaterThan(0);
	}

	let masterAckRecv = 0;
	for (const t of ackTypes) masterAckRecv += masterCats.get(t)?.received ?? 0;
	const expectedAckRecv = masterCmdSent * slaves.length;
	const lower = expectedAckRecv * (1 - tolerancePct);
	const upper = expectedAckRecv * (1 + tolerancePct);
	const masterBreakdown = [...cmdTypes, ...ackTypes]
		.map((t) => {
			const s = masterCats.get(t) ?? { sent: 0, received: 0 };
			return `${t}:s=${s.sent}/r=${s.received}`;
		})
		.join(' ');
	expect(
		masterAckRecv >= lower && masterAckRecv <= upper,
		`master received ${masterAckRecv} ACKs but expected ~${expectedAckRecv} (${slaves.length} slaves × ` +
			`${masterCmdSent} cmd, ±${(tolerancePct * 100).toFixed(0)} %). Master breakdown: ${masterBreakdown}`,
	).toBe(true);
}

/**
 * Per-device, per-key list of received frames (in arrival order). All frame
 * events on a given Socket.IO connection are FIFO-ordered, so the Nth-of-key-K
 * inbound on every receiver corresponds to the same logical broadcast even
 * when multiple senders happen to broadcast frames whose `(type, syncIndex,
 * timestamp)` collide on the same millisecond — a real case observed for
 * `ack-prepared` when two slaves ACK the same cmd in lockstep.
 */
function receivedFramesByKey<T>(
	devices: SyncDevice[],
	pick: (p: ParsedSyncFrame) => T,
): Array<{ deviceId: string; map: Map<string, T[]> }> {
	return devices.map((d) => {
		const map = new Map<string, T[]>();
		for (const p of parsedFrames(d)) {
			if (p.frame.direction !== 'received') continue;
			if (p.value.timestamp === undefined) continue;
			const k = broadcastKey(p.value);
			const list = map.get(k) ?? [];
			list.push(pick(p));
			map.set(k, list);
		}
		return { deviceId: d.deviceId, map };
	});
}

/** Assert per-broadcast receipt-time spread across receivers stays within
 * `maxSpreadMs`. For each broadcast key K, compares the Nth-of-K arrival
 * timestamp on every receiver that observed at least N frames for that key.
 * Skips ordinals where fewer than 2 receivers have an Nth occurrence. */
export function assertBroadcastReceiptSpread(
	devices: SyncDevice[],
	opts: { maxSpreadMs?: number } = {},
): void {
	const maxSpreadMs = opts.maxSpreadMs ?? 1000;
	const perDevice = receivedFramesByKey(devices, (p) => p.frame.timestamp);

	const allKeys = new Set<string>();
	for (const { map } of perDevice) for (const k of map.keys()) allKeys.add(k);

	const violations: string[] = [];
	for (const key of allKeys) {
		const lists = perDevice
			.map(({ deviceId, map }) => ({ deviceId, ts: map.get(key) ?? [] }))
			.filter((l) => l.ts.length > 0);
		if (lists.length < 2) continue;
		const minCount = Math.min(...lists.map((l) => l.ts.length));
		for (let i = 0; i < minCount; i++) {
			const tss = lists.map((l) => l.ts[i]);
			const spread = Math.max(...tss) - Math.min(...tss);
			if (spread > maxSpreadMs) {
				violations.push(
					`broadcast ${key} #${i} receipt spread ${spread}ms > ${maxSpreadMs}ms ` +
						`(devices: ${lists.map((l) => `${l.deviceId}=${l.ts[i]}`).join(', ')})`,
				);
			}
		}
	}

	expect(
		violations.length,
		`${violations.length} broadcast(s) violated receipt-time spread:\n  ` + violations.slice(0, 10).join('\n  '),
	).toBe(0);
}

/** Assert that for each broadcast received by ≥ 2 devices, their received
 * `value` payloads are byte-identical. Uses ordinal-within-key matching
 * (Nth-of-K on each receiver corresponds to the same logical broadcast,
 * because Socket.IO frame order is preserved per receiver and the server
 * broadcasts in a serialised order). The inner `value` object is byte-
 * identical end-to-end per calibration; no normalisation needed. */
export function assertFrameContentEquality(devices: SyncDevice[]): void {
	const perDevice = receivedFramesByKey(devices, (p) => p.value);

	const allKeys = new Set<string>();
	for (const { map } of perDevice) for (const k of map.keys()) allKeys.add(k);

	const violations: string[] = [];
	for (const key of allKeys) {
		const lists = perDevice
			.map(({ deviceId, map }) => ({ deviceId, vals: map.get(key) ?? [] }))
			.filter((l) => l.vals.length > 0);
		if (lists.length < 2) continue;
		const minCount = Math.min(...lists.map((l) => l.vals.length));
		for (let i = 0; i < minCount; i++) {
			const refJson = stableStringify(lists[0].vals[i]);
			for (let j = 1; j < lists.length; j++) {
				const otherJson = stableStringify(lists[j].vals[i]);
				if (otherJson !== refJson) {
					violations.push(
						`broadcast ${key} #${i}: ${lists[0].deviceId} and ${lists[j].deviceId} differ\n` +
							`    ${lists[0].deviceId}: ${refJson}\n` +
							`    ${lists[j].deviceId}: ${otherJson}`,
					);
				}
			}
		}
	}

	expect(
		violations.length,
		`${violations.length} broadcast(s) had non-identical content across receivers:\n  ` +
			violations.slice(0, 5).join('\n  '),
	).toBe(0);
}

/** A single cross-device sample disagrees iff ≥2 devices show DIFFERENT non-null
 * elements at the same instant. All-null (transition) or a single distinct value
 * is agreement. Pure + unit-tested so the sampling loop stays trivial. */
export function isRenderedDisagreement(visible: Array<string | null>): boolean {
	const nonNull = visible.filter((v): v is string => v !== null);
	return new Set(nonNull).size > 1;
}

/**
 * Sample the currently-rendered element on every device simultaneously, N times,
 * and assert they agree. Closes the gap that `assertFrameContentEquality` leaves:
 * that proves the broadcast PAYLOAD was identical, not that each device PAINTED
 * the same element. A slave rendering a stale frame while ACKing correctly is
 * invisible to WS-frame checks but caught here. Allows `maxDisagreements` samples
 * to straddle a transition boundary (default ceil(5% of samples)).
 */
export async function assertRenderedElementAgreement(
	devices: SyncDevice[],
	candidates: ElementCandidate[],
	opts: {
		samples?: number;
		intervalMs?: number;
		maxDisagreements?: number;
		confirmDelayMs?: number;
		label?: string;
	} = {},
): Promise<void> {
	const { samples = 20, intervalMs = 500, confirmDelayMs = 250, label = 'rendered-agreement' } = opts;
	const maxDisagreements = opts.maxDisagreements ?? Math.ceil(samples * 0.05);
	const records: Array<Array<string | null>> = [];
	let disagreements = 0;
	for (let i = 0; i < samples; i++) {
		const visible = await Promise.all(devices.map((d) => getVisibleElement(d.page, candidates)));
		if (!isRenderedDisagreement(visible)) {
			records.push(visible);
			await new Promise((r) => setTimeout(r, intervalMs));
			continue;
		}
		// A single instantaneous disagreement is almost always a transition
		// straddle — one device a few hundred ms ahead of another at the exact
		// sample instant — not a desync. Measured cross-device transition skew
		// is ≤100ms across the whole sync suite, so a straddle clears well
		// within confirmDelayMs. Re-sample once after a short settle and only
		// count the disagreement if it PERSISTS: a real stuck-device desync is
		// sustained and still trips every sample, while a benign boundary
		// straddle now counts zero. This removes the sampling artifact without
		// weakening what a genuine desync triggers.
		await new Promise((r) => setTimeout(r, confirmDelayMs));
		const confirm = await Promise.all(devices.map((d) => getVisibleElement(d.page, candidates)));
		if (isRenderedDisagreement(confirm)) {
			disagreements++;
			records.push(confirm);
		} else {
			records.push(visible);
			// eslint-disable-next-line no-console
			console.log(
				`[rendered-agreement] "${label}" sample ${i} straddle cleared after ${confirmDelayMs}ms ` +
					`(${JSON.stringify(visible)} → ${JSON.stringify(confirm)})`,
			);
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	expect(
		disagreements,
		`"${label}": ${disagreements}/${samples} samples had devices showing different elements ` +
			`that PERSISTED past a ${confirmDelayMs}ms re-sample (allowed ${maxDisagreements}). ` +
			`Samples: ${JSON.stringify(records)}`,
	).toBeLessThanOrEqual(maxDisagreements);
}

/** cycleWrapBoundary.smil cycle locators, shared so callers continue the same cycle. */
export interface FailoverLocators {
	l1: (p: SyncDevice['page']) => Locator;
	l2: (p: SyncDevice['page']) => Locator;
	video: (p: SyncDevice['page']) => Locator;
}

export interface MasterFailoverResult extends FailoverLocators {
	/** The two devices that survived the master kill (tracking is already updated to these). */
	survivors: SyncDevice[];
	/** The survivor promoted to master after the kill. */
	newMaster: SyncDevice;
	/** The original master that was killed. */
	killed: SyncDevice;
	/** The killed master's original index — revive the same DUID via addSyncDevice(killedIndex). */
	killedIndex: number;
	/** Skew of the first post-promotion transition (l2→l1); the caller records its own telemetry. */
	postFailoverSkew: TransitionSkew;
}

/**
 * The shared failover preamble for the master-failover and killed-master-rejoin tests
 * (the rejoin test duplicated this entire first half). Builds a 3-device group on
 * cycleWrapBoundary.smil, reaches steady state (l1 → l2), kills the ELECTED master
 * mid-cycle, then asserts the survivors re-elect among themselves and complete one
 * post-promotion transition (l2 → l1, ≤2000ms — promotion is about correctness, not
 * normal-operation skew). Survivors end on l1, so callers continue the natural cycle.
 *
 * `setTracked` is invoked with the live device set the caller's afterEach should clean
 * up — first the full group, then the survivors BEFORE the master's context is closed —
 * so the dead context is never double-closed.
 */
export async function performMasterFailover(
	browser: Browser,
	opts: { smilUrl: string; groupName: string },
	setTracked: (devices: SyncDevice[]) => void,
): Promise<MasterFailoverResult> {
	const devices = await createSyncGroup(browser, {
		smilUrl: opts.smilUrl,
		groupName: opts.groupName,
		deviceCount: 3,
	});
	setTracked(devices);

	const firstMaster = await waitForMasterElection(devices, 60_000);
	// Platform election is not deterministic w.r.t. launch order — assert only that a
	// group member won; pin the index so the rejoin caller can revive the same DUID.
	expect(devices).toContain(firstMaster);
	const killedIndex = devices.indexOf(firstMaster);

	const l1 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape1"]');
	const l2 = (p: SyncDevice['page']) => p.frameLocator('iframe').locator('img[src*="landscape2"]');
	const video = (p: SyncDevice['page']) => p.locator('video[src*="video-test_465b7757"]');

	// Establish steady-state: all 3 reach l1, then transition to l2 together.
	await waitForConvergence(devices, l1, 60_000);
	await Promise.all(devices.map((d) => l1(d.page).first().waitFor({ state: 'hidden', timeout: 15_000 })));
	await waitForConvergence(devices, l2, 15_000);

	// Kill the actual elected master (not a fixed index). Update tracking to the
	// survivors BEFORE closing so the caller's afterEach never double-closes it.
	const killed = firstMaster;
	const survivors = devices.filter((d) => d !== killed);
	setTracked(survivors);
	await killed.context.close();

	// Survivors must re-elect among themselves. Budget 45s: master-loss detection
	// (~30s) + one cycle to promote.
	const newMaster = await waitForMasterElection(survivors, 45_000);
	expect(survivors).toContain(newMaster);
	expect(newMaster).not.toBe(killed);

	// One post-promotion transition (l2 → l1) proves the survivors stay sync'd. Wider
	// tolerance (2000ms) because promotion is about correctness, not normal-op skew.
	await Promise.all(survivors.map((d) => l2(d.page).first().waitFor({ state: 'hidden', timeout: 30_000 })));
	const postFailoverSkew = await assertSynchronizedTransition(survivors, l1, {
		label: 'post-failover: landscape2→landscape1',
		maxSkewMs: 2000,
		timeoutMs: 30_000,
	});

	return { survivors, newMaster, killed, killedIndex, postFailoverSkew, l1, l2, video };
}

export interface SyncSnapshot {
	/** Milliseconds since sampling began (1-indexed × sampleGapMs). */
	t: number;
	/** Per-device (syncIndex, visibleElement) captured at this tick. */
	tuples: Array<{ syncIndex: number | null; visible: string | null }>;
	/** max−min of the reported syncIndices, or null until every device has reported one. */
	spread: number | null;
	/** Count of distinct (syncIndex, visible) tuples across the devices. */
	uniqueTuples: number;
}

export interface SyncLockstepOptions {
	/** Candidates for the rendered-state half of each snapshot tuple. */
	candidates: ElementCandidate[];
	/** Number of samples to take. */
	samples: number;
	/** Delay between samples, in ms. */
	sampleGapMs: number;
	/** Max allowed syncIndex spread (max−min) at any snapshot. */
	maxSpread: number;
	/**
	 * How many snapshots may exceed `maxSpread` / show >2 tuples — a transient budget for
	 * cross-priority boundaries where the master briefly races ahead. Defaults to 0.
	 */
	maxDivergentSnapshots?: number;
	/** Log prefix, e.g. '[wallclock-priority]'. */
	label: string;
	/**
	 * Drop devices reporting a null syncIndex OR null visible before counting distinct
	 * tuples, so a momentary sampling gap is not mistaken for an extra desynced tuple.
	 * Defaults to false (count every device's tuple verbatim).
	 */
	ignoreNullTuples?: boolean;
}

/**
 * Sample every device's (syncIndex, visibleElement) `samples` times at `sampleGapMs`
 * intervals and assert the group holds lockstep across the whole window:
 *   - every snapshot carries a syncIndex from every device (no perpetual non-reporter),
 *   - at most `maxDivergentSnapshots` snapshots exceed `maxSpread` syncIndex spread,
 *   - at most `maxDivergentSnapshots` snapshots show >2 distinct (syncIndex, visible)
 *     tuples across the devices (1 = perfect lockstep, 2 = one device mid-transition).
 * Returns the snapshots so the caller can run its own liveness/peak check and any
 * test-specific extras. Shared by the spread-based priority-sync tests
 * (wallclock / three-level / smil-update-stability).
 */
export async function assertSyncIndexLockstepOverWindow(
	devices: SyncDevice[],
	opts: SyncLockstepOptions,
): Promise<SyncSnapshot[]> {
	const {
		candidates,
		samples,
		sampleGapMs,
		maxSpread,
		maxDivergentSnapshots = 0,
		label,
		ignoreNullTuples = false,
	} = opts;

	const snapshots: SyncSnapshot[] = [];
	for (let i = 0; i < samples; i++) {
		await devices[0].page.waitForTimeout(sampleGapMs);
		const tuples = await Promise.all(
			devices.map(async (d) => ({
				syncIndex: getLatestSyncIndex(d),
				visible: await getVisibleElement(d.page, candidates),
			})),
		);
		const known = tuples.map((t) => t.syncIndex).filter((v): v is number => v !== null);
		const spread = known.length === devices.length ? Math.max(...known) - Math.min(...known) : null;
		const tupleSource = ignoreNullTuples
			? tuples.filter((t) => t.syncIndex !== null && t.visible !== null)
			: tuples;
		const uniqueTuples = new Set(tupleSource.map((t) => `${t.syncIndex}|${t.visible}`)).size;
		snapshots.push({ t: (i + 1) * sampleGapMs, tuples, spread, uniqueTuples });
	}

	// eslint-disable-next-line no-console
	console.log(
		`${label} snapshots:\n` +
			snapshots
				.map(
					(s) =>
						`  +${s.t}ms syncIndex=${JSON.stringify(s.tuples.map((t) => t.syncIndex))} ` +
						`visible=${JSON.stringify(s.tuples.map((t) => t.visible))} ` +
						`spread=${s.spread} uniqueTuples=${s.uniqueTuples}`,
				)
				.join('\n'),
	);

	for (const s of snapshots) {
		expect(s.spread, `a device never reported a syncIndex by +${s.t}ms`).not.toBeNull();
	}

	const divergent = snapshots.filter((s) => (s.spread as number) > maxSpread);
	expect(
		divergent.length,
		`${divergent.length}/${snapshots.length} snapshots had spread > ${maxSpread} ` +
			`(${divergent.map((s) => `+${s.t}ms=${s.spread}`).join(', ')})`,
	).toBeLessThanOrEqual(maxDivergentSnapshots);

	const tupleDivergent = snapshots.filter((s) => s.uniqueTuples > 2);
	expect(
		tupleDivergent.length,
		`${tupleDivergent.length}/${snapshots.length} snapshots had >2 unique (syncIndex, visible) tuples ` +
			`(${tupleDivergent.map((s) => `+${s.t}ms`).join(', ')})`,
	).toBeLessThanOrEqual(maxDivergentSnapshots);

	return snapshots;
}
