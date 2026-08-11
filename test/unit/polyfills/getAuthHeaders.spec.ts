if (typeof (global as any).window === 'undefined') {
	(global as any).window = {};
}

import { expect } from 'chai';
import { getAuthHeaders, setAuthHeadersFunction } from '../../../src/polyfills/getAuthHeaders';

describe('polyfills/getAuthHeaders', () => {
	afterEach(() => {
		setAuthHeadersFunction(null);
		delete (window as any).getAuthHeaders;
	});

	it('resolves to {} when neither a custom function nor window.getAuthHeaders is set', async () => {
		const result = await getAuthHeaders('https://example.com/file.mp4');
		expect(result).to.deep.equal({});
	});

	it('falls back to window.getAuthHeaders when no custom function is set', async () => {
		(window as any).getAuthHeaders = (url: string) => ({ Authorization: `Bearer ${url}` });

		const result = await getAuthHeaders('https://example.com/file.mp4');
		expect(result).to.deep.equal({ Authorization: 'Bearer https://example.com/file.mp4' });
	});

	it('uses an async custom function registered via setAuthHeadersFunction', async () => {
		setAuthHeadersFunction((url: string) => Promise.resolve({ Authorization: `Bearer ${url}` }));

		const result = await getAuthHeaders('https://example.com/file.mp4');
		expect(result).to.deep.equal({ Authorization: 'Bearer https://example.com/file.mp4' });
	});

	it('prefers the custom function over window.getAuthHeaders when both are set', async () => {
		(window as any).getAuthHeaders = () => ({ Source: 'window' });
		setAuthHeadersFunction(() => Promise.resolve({ Source: 'custom' }));

		const result = await getAuthHeaders('https://example.com/file.mp4');
		expect(result).to.deep.equal({ Source: 'custom' });
	});

	it('supports a custom function that chains a promise, per the recognition-auth pattern', async () => {
		const self = {
			getAuthHeaders: (url: string) => Promise.resolve({ Authorization: `Bearer ${url}` }),
		};
		setAuthHeadersFunction((url: string) => self.getAuthHeaders(url).then((headers) => headers));

		const result = await getAuthHeaders('https://example.com/file.mp4');
		expect(result).to.deep.equal({ Authorization: 'Bearer https://example.com/file.mp4' });
	});
});
