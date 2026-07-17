import { isProvisionalResponse } from "../../lib/input/response/provisionalResponse.js";

const ENGLISH_COUNTS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
};

const CHINESE_COUNTS: Record<string, number> = {
	一: 1,
	二: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9,
	十: 10,
};

function requestedPointCount(prompt: string): number | null {
	const chinese = prompt.match(
		/([一二三四五六七八九十]|\d{1,2})\s*(?:点|条|项|个要点)/u,
	);
	if (chinese?.[1]) {
		return CHINESE_COUNTS[chinese[1]] ?? Number(chinese[1]);
	}
	const english = prompt.match(
		/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b(?:\s+\w+){0,2}\s+(?:points|factors|reasons|steps|items|criteria)\b/i,
	);
	if (!english?.[1]) return null;
	return ENGLISH_COUNTS[english[1].toLowerCase()] ?? Number(english[1]);
}

export function getIncompleteResponseReason(
	response: string,
	prompt: string,
): string | null {
	const trimmed = response.trim();
	const lines = trimmed
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (isProvisionalResponse(trimmed)) {
		return "plan_only";
	}
	if (lines.length === 1 && /^#{1,6}\s+\S/.test(lines[0] ?? "")) {
		return "heading_only";
	}

	const requested = requestedPointCount(prompt);
	if (!requested || requested < 2) return null;
	const numberedItems = lines.filter((line) =>
		/^(?:\*\*|__)?\s*(?:\d{1,2}\\?[.)、]|[一二三四五六七八九十]+\\?[.)、])\s*/u.test(
			line,
		),
	).length;
	const subheadings = lines.filter((line) => /^#{2,6}\s+\S/.test(line)).length;
	const bullets = lines.filter(
		(line) => !/^\s*(?:[-*_]\s*){3,}$/.test(line) && /^[-*+]\s+\S/.test(line),
	).length;
	const explicitSections = Math.max(numberedItems, subheadings, bullets);

	if (explicitSections > 0 && explicitSections < requested) {
		return `requested_${requested}_sections_received_${explicitSections}`;
	}
	return null;
}
