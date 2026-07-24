/**
 * Parse a SMIL clock-value (the `dur` attribute) into seconds.
 *
 * Returns 0 for durations the visibility monitor cannot enforce — `indefinite`,
 * `media`, missing/empty, or unparseable — which the monitor treats as
 * "record-only" (no tolerance assertion). Handles the forms present in the test
 * fixtures plus the SMIL clock-value grammar defensively:
 *   - "3s", "3000ms", "2min", "1h"   (unit values)
 *   - "3", "3.5"                      (bare = seconds)
 *   - "00:00:03", "01:02:03.5"        (full/partial clock values)
 *
 * @see https://www.w3.org/TR/SMIL3/smil-timing.html#q22 (clock-value grammar)
 */
export function smilClockValueToSeconds(raw: string | undefined | null): number {
	if (raw == null) {
		return 0;
	}
	const v = raw.trim();
	if (v === '' || v === 'indefinite' || v === 'media') {
		return 0;
	}

	// Clock value with colons: [hh:]mm:ss[.frac]
	if (v.includes(':')) {
		const parts = v.split(':').map((p) => Number(p));
		if (parts.some((n) => Number.isNaN(n))) {
			return 0;
		}
		return parts.reduce((acc, n) => acc * 60 + n, 0);
	}

	// Unit value: <number><unit?>
	const match = v.match(/^([0-9]*\.?[0-9]+)\s*(ms|s|min|h)?$/);
	if (!match) {
		return 0;
	}
	const n = Number(match[1]);
	if (Number.isNaN(n)) {
		return 0;
	}
	switch (match[2]) {
		case 'ms':
			return n / 1000;
		case 'min':
			return n * 60;
		case 'h':
			return n * 3600;
		case 's':
		case undefined:
		default:
			return n; // bare number = seconds
	}
}
