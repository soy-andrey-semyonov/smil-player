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
