import { assertGeneratedUpToDate } from './generateExpectations';

/** Playwright globalSetup: refuse to run e2e against a stale duration registry. */
export default async function globalSetup(): Promise<void> {
	await assertGeneratedUpToDate();
}
