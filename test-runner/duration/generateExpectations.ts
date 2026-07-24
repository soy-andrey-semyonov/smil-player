/**
 * Generates `durationExpectations.generated.ts` from the SMIL fixtures under
 * test-server/testFiles. For each <video>/<img>/<ref> with a `src`, emits a
 * VisibilityCandidate: srcContains via getFileName (the player's runtime
 * filename), layer from the tag (video→page, img/ref→frame), expectedSec from
 * `dur=` via smilClockValueToSeconds.
 *
 *   npm run gen:durations          # write the committed file
 *   npm run gen:durations -- --check   # exit 1 if the committed file is stale
 *
 * Fixtures that fail to parse (e.g. brokenXml.smil, intentionally malformed)
 * emit an empty candidate list and a warning — never crash the generator.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';
import { getFileName } from '../../src/components/files/tools/fileName';
import { smilClockValueToSeconds } from './smilClockValue';

const FIXTURES_ROOT = path.join(__dirname, '../../test-server/testFiles');
const OUT_FILE = path.join(__dirname, 'durationExpectations.generated.ts');

interface Candidate {
	key: string;
	srcContains: string;
	layer: 'page' | 'frame';
	expectedSec: number;
	/** 0 for intro media — the loader is legitimately skippable when prefetch
	 * finishes before the intro mounts (always possible; common with the
	 * warm asset cache). */
	minOccurrences?: number;
}

async function listSmilFiles(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			files.push(...(await listSmilFiles(full)));
		} else if (e.name.endsWith('.smil')) {
			files.push(full);
		}
	}
	return files;
}

/** Fixture keys are basenames — a duplicate `.smil` name in another subdirectory
 * would silently overwrite its sibling in GENERATED, and `--check` would not
 * notice (both runs produce the same corrupted output). Fail loudly instead. */
export function assertUniqueBasenames(files: string[]): void {
	const byFixture = new Map<string, string>();
	for (const file of files) {
		const fixture = path.basename(file, '.smil');
		const prior = byFixture.get(fixture);
		if (prior) {
			throw new Error(
				`[gen:durations] duplicate fixture basename "${fixture}" (${prior} vs ${file}) — ` +
					'fixture keys must be unique across test-server/testFiles/.',
			);
		}
		byFixture.set(fixture, file);
	}
}

const INTRO_END_EVENT = '__prefetchEnd.endEvent';

/** Recursively collect every video/img/ref node's attributes from an xml2js
 * tree (default options: explicitArray, attrkey '$'). `inIntro` is true inside
 * any element with end="__prefetchEnd.endEvent" — the SMIL intro/loader
 * subtree, whose media is timing-dependent and may never mount. */
function collectMedia(
	node: unknown,
	out: Array<{ tag: string; attrs: Record<string, string>; inIntro: boolean }>,
	inIntro: boolean,
): void {
	if (node == null || typeof node !== 'object') {
		return;
	}
	for (const [tag, val] of Object.entries(node as Record<string, unknown>)) {
		if (tag === '$') {
			continue; // current node's own attributes
		}
		const arr = Array.isArray(val) ? val : [val];
		for (const child of arr) {
			if (child == null || typeof child !== 'object') {
				continue;
			}
			const childAttrs = ((child as Record<string, unknown>).$ ?? {}) as Record<string, string>;
			const childInIntro = inIntro || childAttrs.end === INTRO_END_EVENT;
			if (tag === 'video' || tag === 'img' || tag === 'ref') {
				if (childAttrs.src) {
					out.push({ tag, attrs: childAttrs, inIntro: childInIntro });
				}
			}
			collectMedia(child, out, childInIntro); // descend into seq/par/excl/priorityClass/body and nested media
		}
	}
}

function layerForTag(tag: string): 'page' | 'frame' {
	return tag === 'video' ? 'page' : 'frame'; // video on main page; img/ref in applet iframe
}

/** Pure core of buildFixture, exported for unit tests: parse one SMIL document
 * and emit its candidates. `label` is used only in the unparseable warning. */
export async function candidatesFromXml(xml: string, label: string): Promise<Candidate[]> {
	let tree: unknown;
	try {
		tree = await parseStringPromise(xml); // defaults: explicitArray:true, attrkey:'$'
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn(`[gen:durations] skip unparseable fixture ${label}: ${(err as Error).message}`);
		return [];
	}
	const media: Array<{ tag: string; attrs: Record<string, string>; inIntro: boolean }> = [];
	collectMedia(tree, media, false);
	const seen = new Set<string>();
	const candidates: Candidate[] = [];
	for (const { tag, attrs, inIntro } of media) {
		const srcContains = getFileName(attrs.src);
		if (!srcContains || seen.has(srcContains)) {
			continue; // de-dupe identical assets within one fixture
		}
		seen.add(srcContains);
		candidates.push({
			key: srcContains, // unique per distinct URL; overrides reference `${fixture}/${key}`
			srcContains,
			layer: layerForTag(tag),
			expectedSec: smilClockValueToSeconds(attrs.dur),
			...(inIntro ? { minOccurrences: 0 } : {}),
		});
	}
	return candidates;
}

async function buildFixture(file: string): Promise<Candidate[]> {
	const xml = await fs.readFile(file, 'utf8');
	return candidatesFromXml(xml, path.basename(file));
}

function render(all: Record<string, Candidate[]>): string {
	const body = Object.keys(all)
		.sort()
		.map((fixture) => {
			const rows = all[fixture]
				.map(
					(c) =>
						`\t\t{ key: ${JSON.stringify(c.key)}, srcContains: ${JSON.stringify(c.srcContains)}, ` +
						`layer: '${c.layer}', expectedSec: ${c.expectedSec}` +
						(c.minOccurrences !== undefined ? `, minOccurrences: ${c.minOccurrences}` : '') +
						` },`,
				)
				.join('\n');
			return `\t${JSON.stringify(fixture)}: [\n${rows}\n\t],`;
		})
		.join('\n');
	return (
		'// AUTO-GENERATED by test-runner/duration/generateExpectations.ts — DO NOT EDIT.\n' +
		'// Regenerate with `npm run gen:durations`. CI guards staleness via `--check`.\n' +
		'export const GENERATED = {\n' +
		body +
		'\n} as const;\n'
	);
}

async function buildAll(): Promise<string> {
	const files = await listSmilFiles(FIXTURES_ROOT);
	assertUniqueBasenames(files);
	const all: Record<string, Candidate[]> = {};
	for (const file of files) {
		const fixture = path.basename(file, '.smil');
		all[fixture] = await buildFixture(file);
	}
	return render(all);
}

/** Throws if the committed registry differs from what the fixtures produce.
 * Wired as Playwright's globalSetup (checkDurations.setup.ts) so EVERY
 * invocation — bare `npx playwright test`, test:sync, headed/debug — refuses
 * to run against a stale registry. */
export async function assertGeneratedUpToDate(): Promise<void> {
	const rendered = await buildAll();
	const existing = await fs.readFile(OUT_FILE, 'utf8').catch(() => '');
	if (existing !== rendered) {
		throw new Error('[gen:durations] durationExpectations.generated.ts is STALE. Run `npm run gen:durations`.');
	}
}

async function main(): Promise<void> {
	if (process.argv.includes('--check')) {
		await assertGeneratedUpToDate();
		// eslint-disable-next-line no-console
		console.log('[gen:durations] generated file is up to date.');
		return;
	}
	const rendered = await buildAll();
	await fs.writeFile(OUT_FILE, rendered, 'utf8');
	// eslint-disable-next-line no-console
	console.log(`[gen:durations] wrote ${path.relative(process.cwd(), OUT_FILE)}`);
}

if (require.main === module) {
	main().catch((err) => {
		// eslint-disable-next-line no-console
		console.error(err);
		process.exit(1);
	});
}
