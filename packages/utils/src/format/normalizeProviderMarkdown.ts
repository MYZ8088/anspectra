const ZERO_WIDTH_CHARACTERS_RE = /\u200B|\u200C|\u200D|\uFEFF/g;
const DUPLICATED_ORDERED_ITEM_RE =
	/^([ \t]*)(\d+)\.[ \t]+\2\.[ \t]*(?:\r?\n[ \t]*)*/gm;
const EMPTY_GLYPH_BULLET_RE = /^[ \t]*(?:>[ \t]*)*[-*][ \t]+[∙•·][ \t]*$/gm;
const DUPLICATED_BULLET_RE =
	/^([ \t]*(?:>[ \t]*)*)[-*][ \t]+[∙•·][ \t]+(?=\S)/gm;
const SPACED_THEMATIC_BREAK_RE = /^[ \t]*\*[ \t]+\*[ \t]+\*[ \t]*$/gm;

/**
 * Removes common list artifacts introduced when provider HTML is converted to
 * Markdown. The transformation is deliberately narrow so normal prose and
 * valid Markdown numbering remain unchanged.
 */
export function normalizeProviderMarkdown(value: string): string {
	return value
		.replace(ZERO_WIDTH_CHARACTERS_RE, "")
		.replace(DUPLICATED_ORDERED_ITEM_RE, "$1$2. ")
		.replace(EMPTY_GLYPH_BULLET_RE, "")
		.replace(DUPLICATED_BULLET_RE, "$1- ")
		.replace(SPACED_THEMATIC_BREAK_RE, "---")
		.replace(/[ \t]+\r?\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
