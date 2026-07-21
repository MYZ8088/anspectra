import { PROVIDER_LIST } from "@anspectra/types";
import { PROVIDER_DISPLAY } from "../agent/providers.js";

export const modelSelectors = [
	{ value: "All Models", label: "All Models" },
	...PROVIDER_LIST.map((p) => ({
		value: p,
		label: PROVIDER_DISPLAY[p].displayName,
	})),
];
