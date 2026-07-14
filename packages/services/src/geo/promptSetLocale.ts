import { ValidationError } from "@aloom/errors";

export function normalizePromptLocales(
	locales: ReadonlyArray<string | null | undefined>,
): string[] {
	return [
		...new Set(locales.filter((locale): locale is string => Boolean(locale))),
	]
		.map((locale) => locale.trim())
		.filter(Boolean)
		.sort();
}

function sameLocales(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((locale, index) => locale === right[index])
	);
}

export function assertPromptSetLocales(args: {
	expectedLocales?: readonly string[];
	manifestLocales?: readonly string[];
	promptLocales: readonly string[];
}): string[] {
	const promptLocales = normalizePromptLocales(args.promptLocales);
	const manifestLocales = normalizePromptLocales(args.manifestLocales ?? []);
	const expectedLocales = normalizePromptLocales(args.expectedLocales ?? []);

	if (
		manifestLocales.length > 0 &&
		!sameLocales(manifestLocales, promptLocales)
	) {
		throw new ValidationError(
			"The frozen prompt set language manifest does not match its prompts",
		);
	}
	if (
		expectedLocales.length > 0 &&
		!sameLocales(expectedLocales, promptLocales)
	) {
		throw new ValidationError(
			`Selected prompt languages (${expectedLocales.join(", ")}) do not match the frozen set (${promptLocales.join(", ")}). Create or choose a matching frozen set before running.`,
		);
	}
	return promptLocales;
}
