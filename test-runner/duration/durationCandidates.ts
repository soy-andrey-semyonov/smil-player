import { VisibilityCandidate } from '../visibilityMonitor';
import { GENERATED } from './durationExpectations.generated';
import { DURATION_OVERRIDES } from './durationOverrides';

/** Pure merge: clone each base candidate and overlay any override matching
 * `${fixture}/${candidate.key}`. Never mutates the inputs. */
export function applyDurationOverrides(
	fixture: string,
	base: ReadonlyArray<VisibilityCandidate>,
	overrides: Record<string, Partial<VisibilityCandidate>>,
): VisibilityCandidate[] {
	return base.map((c) => {
		const override = overrides[`${fixture}/${c.key}`];
		return { ...c, ...override };
	});
}

/** Duration candidates for a fixture, keyed by its `.smil` filename (no ext).
 * Throws if the fixture is unknown so a typo fails loudly rather than asserting
 * nothing. */
export function durationCandidates(fixture: keyof typeof GENERATED): VisibilityCandidate[] {
	const base = GENERATED[fixture] as ReadonlyArray<VisibilityCandidate> | undefined;
	if (!base) {
		throw new Error(`No generated duration expectations for "${String(fixture)}". Run \`npm run gen:durations\`.`);
	}
	return applyDurationOverrides(String(fixture), base, DURATION_OVERRIDES);
}
