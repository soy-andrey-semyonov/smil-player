import * as chai from 'chai';
import {
	isRenderedDisagreement,
	assertRenderedElementAgreement,
	ElementCandidate,
} from '../../../test-runner/sync/syncAssertions';

const expect = chai.expect;

describe('isRenderedDisagreement', () => {
	it('is false when all devices show the same element', () => {
		expect(isRenderedDisagreement(['l1', 'l1', 'l1'])).to.equal(false);
	});
	it('is false when some devices are mid-transition (null)', () => {
		expect(isRenderedDisagreement(['l1', null, 'l1'])).to.equal(false);
		expect(isRenderedDisagreement([null, null, null])).to.equal(false);
	});
	it('is true when two devices show different non-null elements', () => {
		expect(isRenderedDisagreement(['l1', 'l2', 'l1'])).to.equal(true);
	});
	it('treats a + concatenation (transient double-paint) as its own value, only disagreeing vs a different value', () => {
		expect(isRenderedDisagreement(['l1+l2', 'l1+l2'])).to.equal(false);
		expect(isRenderedDisagreement(['l1+l2', 'l1'])).to.equal(true);
	});
});

/**
 * Drives the real `assertRenderedElementAgreement` loop against mock devices.
 * `deviceSeqs[i]` is the sequence of *whole-element* values device i reports on
 * successive `getVisibleElement` calls (the loop calls it once per sample, plus
 * once more on the confirm re-sample whenever a disagreement is seen). The
 * candidate-level `isVisible` mock advances one sample index every
 * `candidateNames.length` calls, so all candidates for a single
 * `getVisibleElement` read the same sample.
 */
function makeHarness(deviceSeqs: Array<Array<string | null>>) {
	const candidateNames = ['l1', 'l2'];
	const pages = deviceSeqs.map((_unused, id) => ({ __id: id }));
	const calls = new Map<number, number>();
	const candidates: ElementCandidate[] = candidateNames.map((name) => ({
		name,
		locator: ((page: { __id: number }) => ({
			first: () => ({
				isVisible: async () => {
					const id = page.__id;
					const n = calls.get(id) ?? 0;
					calls.set(id, n + 1);
					const sampleIdx = Math.floor(n / candidateNames.length);
					const seq = deviceSeqs[id];
					return seq[Math.min(sampleIdx, seq.length - 1)] === name;
				},
			}),
		})) as any,
	}));
	const devices = pages.map((page) => ({ page })) as any;
	return { devices, candidates };
}

async function runsClean(fn: () => Promise<void>): Promise<boolean> {
	try {
		await fn();
		return true;
	} catch {
		return false;
	}
}

describe('assertRenderedElementAgreement re-sample gate', () => {
	// Tiny delays + strict maxDisagreements:0 so the only thing that can pass is
	// a run with ZERO persisted disagreements.
	const opts = { samples: 3, intervalMs: 1, confirmDelayMs: 1, maxDisagreements: 0 };

	it('does NOT count a transition straddle that clears on the confirm re-sample', async () => {
		// sample 0: dev0=l1 vs dev1=l2 (disagree) → confirm: both l2 (cleared).
		// samples 1,2: agree on l2. A straddle that clears must not be counted.
		const { devices, candidates } = makeHarness([
			['l1', 'l2', 'l2', 'l2'],
			['l2', 'l2', 'l2', 'l2'],
		]);
		const ok = await runsClean(() =>
			assertRenderedElementAgreement(devices, candidates, { ...opts, label: 'straddle' }),
		);
		expect(ok, 'a cleared straddle was wrongly counted as a disagreement').to.equal(true);
	});

	it('DOES count a sustained desync that persists past the re-sample (still fails loudly)', async () => {
		// Every sample dev0=l1, dev1=l2, and the re-sample still disagrees. A real
		// stuck-device desync must trip the assertion — the fix must not mask it.
		const { devices, candidates } = makeHarness([['l1'], ['l2']]);
		const ok = await runsClean(() =>
			assertRenderedElementAgreement(devices, candidates, { ...opts, label: 'sustained' }),
		);
		expect(ok, 'a sustained desync was not caught').to.equal(false);
	});

	it('passes cleanly when all devices always agree', async () => {
		const { devices, candidates } = makeHarness([['l1'], ['l1']]);
		const ok = await runsClean(() =>
			assertRenderedElementAgreement(devices, candidates, { ...opts, label: 'agree' }),
		);
		expect(ok).to.equal(true);
	});
});
