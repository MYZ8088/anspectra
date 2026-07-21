import type { Provider } from "@aloom/types";

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
type FalseResponseRule = {
	pattern: RegExp;
	maxChars: number;
	scanChars?: number;
};

const FALSE_RESPONSE_RULES: FalseResponseRule[] = [
	{
		pattern:
			/^(?:我将|我会|接下来我(?:将|会)?)[\s\S]{0,300}(?:对比|比较|分析|说明|回答|整理)[\s\S]{0,240}(?:创建时间[:：]\s*\d{1,2}:\d{2}|需要我帮你)/u,
		maxChars: 360,
	},
	{
		pattern:
			/^(?:我将|我会|接下来我(?:将|会)?).{0,260}(?:对比|比较|分析|说明|回答|整理).{0,180}(?:标注|整理|展开|说明|呈现|梳理|保证|输出).{0,120}[。！？.!?]?$/u,
		maxChars: 320,
	},
	// Gemini terms / disclaimer footer
	{ pattern: /google terms.*opens in a new window.*apply/i, maxChars: 2_000 },
	{ pattern: /gemini is ai and can make mistakes/i, maxChars: 2_000 },
	{ pattern: /google privacy policy.*apply/i, maxChars: 2_000 },
	// CAPTCHA / bot detection
	{
		pattern: /our systems have detected unusual traffic/i,
		maxChars: 1_200,
		scanChars: 400,
	},
	{
		pattern: /please verify you('re| are) human/i,
		maxChars: 1_200,
		scanChars: 400,
	},
	// Rate limiting
	{ pattern: /too many requests/i, maxChars: 800, scanChars: 300 },
	// Downtime / unavailable
	{
		pattern: /service is (currently )?unavailable/i,
		maxChars: 800,
		scanChars: 300,
	},
	// Auth walls / session expiry
	{
		pattern: /sign in to (continue|use|access)/i,
		maxChars: 800,
		scanChars: 300,
	},
	{
		pattern: /you('ve| have) been logged out/i,
		maxChars: 800,
		scanChars: 300,
	},
	{ pattern: /access denied/i, maxChars: 800, scanChars: 300 },
	{
		pattern: /not logged in|log in with wechat|scan with wechat/i,
		maxChars: 800,
		scanChars: 300,
	},
	{
		pattern: /扫码登录|登录后.*使用|请先登录|微信登录|手机号登录|未登录/i,
		maxChars: 800,
		scanChars: 300,
	},
	// CAPTCHA / visual verification surfaces used by China providers
	{
		pattern: /captcha|human verification|security verification/i,
		maxChars: 800,
		scanChars: 300,
	},
	{
		pattern: /验证码|安全验证|人机验证|请选择所有符合|拖拽到这里|在卧室能看到/i,
		maxChars: 800,
		scanChars: 300,
	},
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

	for (const rule of FALSE_RESPONSE_RULES) {
		const candidate = rule.scanChars
			? trimmed.slice(0, rule.scanChars)
			: trimmed;
		if (trimmed.length <= rule.maxChars && rule.pattern.test(candidate)) {
			return {
				valid: false,
				reason: `False/garbage response detected — matched: "${rule.pattern}"`,
			};
		}
	}

	return { valid: true };
}
