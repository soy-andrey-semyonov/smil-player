// Provide browser globals needed by @signageos/front-applet module at import time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');
if (typeof (global as any).window === 'undefined') {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	(global as any).window = dom.window;
	(global as any).document = dom.window.document;
	// Node 22+ ships a read-only built-in `navigator` global; only override it
	// when nothing has defined one yet (older Node / other test runners).
	if (typeof (global as any).navigator === 'undefined') {
		(global as any).navigator = dom.window.navigator;
	}
	(global as any).HTMLElement = dom.window.HTMLElement;
}

// smilPlayer.ts has webpack-only `.jpg` asset imports; stub the extension so
// plain ts-node/require can load the module.
require.extensions['.jpg'] = (module: any) => {
	module.exports = '';
};

import { expect } from 'chai';
import { SmilPlayer } from '../../../src/components/smilPlayer';
import { FilesManager } from '../../../src/components/files/filesManager';
import { ISos } from '../../../src/models/sosModels';

function createSosMock(): ISos {
	return {
		config: {},
		stream: {
			onDisconnected: () => undefined,
			onError: () => undefined,
		},
	} as unknown as ISos;
}

describe('components/smilPlayer - injectable FilesManager', () => {
	it('defaults to constructing its own FilesManager when none is injected', () => {
		const player = new SmilPlayer(createSosMock(), 'https://example.com/playlist.smil');

		expect((player as any).files).to.be.instanceOf(FilesManager);
	});

	it('uses the injected FilesManager instance instead of constructing a new one', () => {
		const sos = createSosMock();
		const customFilesManager = new FilesManager(sos);

		const player = new SmilPlayer(sos, 'https://example.com/playlist.smil', undefined, customFilesManager);

		expect((player as any).files).to.equal(customFilesManager);
	});
});
