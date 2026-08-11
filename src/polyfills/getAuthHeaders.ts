// Upstream's own window.getAuthHeaders?.(url) hook is called synchronously at every
// download/HEAD call site, so a promise-returning provider would be passed through
// unresolved. This wraps that hook behind an async getAuthHeaders() consumers can
// await, and setAuthHeadersFunction() lets them register an async provider directly
// instead of mutating window - falling back to window.getAuthHeaders when unset.
declare global {
	interface Window {
		getAuthHeaders?: (url: string) => Record<string, string>;
	}
}

let customAuthHeadersFunction: ((url: string) => Promise<Record<string, string>>) | null = null;

export function setAuthHeadersFunction(fn: ((url: string) => Promise<Record<string, string>>) | null) {
	customAuthHeadersFunction = fn;
}

export async function getAuthHeaders(url: string): Promise<Record<string, string>> {
	if (customAuthHeadersFunction) {
		return await customAuthHeadersFunction(url);
	}

	if (window.getAuthHeaders) {
		return window.getAuthHeaders(url);
	}

	return {};
}
