const SKIP_PROVIDER_GATE_STORAGE_KEY = "anspectra.skip-provider-gate";
export const SKIP_PROVIDER_GATE_EVENT = "anspectra:skip-provider-gate";

export function readSkipProviderGate(): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	return window.sessionStorage.getItem(SKIP_PROVIDER_GATE_STORAGE_KEY) === "1";
}

export function writeSkipProviderGate(value: boolean): void {
	if (typeof window === "undefined") {
		return;
	}

	if (value) {
		window.sessionStorage.setItem(SKIP_PROVIDER_GATE_STORAGE_KEY, "1");
		window.dispatchEvent(
			new CustomEvent(SKIP_PROVIDER_GATE_EVENT, { detail: { value: true } }),
		);
		return;
	}

	window.sessionStorage.removeItem(SKIP_PROVIDER_GATE_STORAGE_KEY);
	window.dispatchEvent(
		new CustomEvent(SKIP_PROVIDER_GATE_EVENT, { detail: { value: false } }),
	);
}
