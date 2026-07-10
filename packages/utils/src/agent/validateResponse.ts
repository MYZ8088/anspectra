import type { Provider } from "@answerloom/types";

// Floor that rejects pure garbage fragments (wrong element, partial capture)
// while passing genuine short factual answers. 200 was too blunt — it was
// rejecting correct extractions of concise answers under ~200 chars.
export const DEFAULT_MIN_RESPONSE_CHARS = 40;

// Per-provider overrides. AI Overview returns short factual snippets by design;
// applying the same 600-char floor as chat providers causes excessive retries.
export const PROVIDER_MIN_RESPONSE_CHARS: Partial<Record<Provider, number>> = {
	"ai-overview": 50,
	deepseek: 20,
	doubao: 20,
	hunyuan: 20,
	qwen: 20,
};

/**
 * Known false/garbage response patterns across all providers.
 * Ordered from most specific to most general.
 */
const FALSE_RESPONSE_PATTERNS: RegExp[] = [
	// Gemini terms / disclaimer footer
	/google terms.*opens in a new window.*apply/i,
	/gemini is ai and can make mistakes/i,
	/google privacy policy.*apply/i,
	// CAPTCHA / bot detection
	/our systems have detected unusual traffic/i,
	/please verify you('re| are) human/i,
	// Rate limiting
	/too many requests/i,
	// Downtime / unavailable
	/service is (currently )?unavailable/i,
	// Auth walls / session expiry
	/sign in to (continue|use|access)/i,
	/you('ve| have) been logged out/i,
	/access denied/i,
	/not logged in|log in with wechat|scan with wechat/i,
	/扫码登录|登录后.*使用|请先登录|微信登录|手机号登录|未登录/i,
	// CAPTCHA / visual verification surfaces used by China providers
	/captcha|human verification|security verification/i,
	/验证码|安全验证|人机验证|请选择所有符合|拖拽到这里|在卧室能看到/i,
];

type ValidationResult = { valid: true } | { valid: false; reason: string };

export function validateResponse(
	response: string,
	provider: Provider,
): ValidationResult {
	const trimmed = response.trim();
	const minChars =
		PROVIDER_MIN_RESPONSE_CHARS[provider] ?? DEFAULT_MIN_RESPONSE_CHARS;

	if (trimmed.length < minChars) {
		return {
			valid: false,
			reason: `Response too short (${trimmed.length} chars, min ${minChars})`,
		};
	}

	for (const pattern of FALSE_RESPONSE_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				valid: false,
				reason: `False/garbage response detected — matched: "${pattern}"`,
			};
		}
	}

	return { valid: true };
}
