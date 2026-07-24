import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** percentile (linear interpolation) of a numeric array; p in [0,100]. */
export function percentile(values, p) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 1) return sorted[0];
	const rank = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Least-squares slope of y vs index 0..n-1 (ms drift per transition). 0 if <2 points. */
export function driftSlope(values) {
	const n = values.length;
	if (n < 2) return 0;
	const meanX = (n - 1) / 2;
	const meanY = values.reduce((a, b) => a + b, 0) / n;
	let num = 0, den = 0;
	for (let i = 0; i < n; i++) {
		num += (i - meanX) * (values[i] - meanY);
		den += (i - meanX) ** 2;
	}
	return den === 0 ? 0 : num / den;
}

/** Parse jsonl skew records into {test,label,skewMs} rows; skip blank/bad lines. */
export function parseSkewJsonl(text) {
	const rows = [];
	for (const line of text.split('\n')) {
		const t = line.trim();
		if (!t) continue;
		try {
			const o = JSON.parse(t);
			if (typeof o.skewMs === 'number') rows.push(o);
		} catch { /* skip malformed line */ }
	}
	return rows;
}

/** Group rows by `${test} :: ${label}` and compute stats. */
export function summarize(rows) {
	const groups = new Map();
	for (const r of rows) {
		const key = `${r.test ?? '?'} :: ${r.label ?? '?'}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(r.skewMs);
	}
	const out = [];
	for (const [key, vals] of groups) {
		out.push({
			key,
			count: vals.length,
			p50: Math.round(percentile(vals, 50)),
			p95: Math.round(percentile(vals, 95)),
			max: Math.max(...vals),
			driftMsPerTransition: Math.round(driftSlope(vals) * 10) / 10,
		});
	}
	out.sort((a, b) => b.p95 - a.p95);
	return out;
}

function main() {
	const path = 'logs/sync-skew.jsonl';
	let text;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		// eslint-disable-next-line no-console
		console.error(`[report:sync-skew] no ${path} yet — run sync tests first.`);
		process.exit(1);
	}
	const rows = parseSkewJsonl(text);
	const summary = summarize(rows);
	// eslint-disable-next-line no-console
	console.log(`[report:sync-skew] ${rows.length} records across ${summary.length} (test,label) groups:\n`);
	for (const s of summary) {
		// eslint-disable-next-line no-console
		console.log(
			`  ${s.key.padEnd(60)} n=${String(s.count).padStart(3)} ` +
			`p50=${String(s.p50).padStart(5)}ms p95=${String(s.p95).padStart(5)}ms ` +
			`max=${String(s.max).padStart(5)}ms drift=${s.driftMsPerTransition}ms/t`,
		);
	}
	const outPath = 'logs/sync-skew-report.json';
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify({ generatedFrom: rows.length, groups: summary }, null, 2));
	// eslint-disable-next-line no-console
	console.log(`\n[report:sync-skew] wrote ${outPath}`);
}

if (process.argv[1] && process.argv[1].endsWith('report-sync-skew.mjs')) {
	main();
}
