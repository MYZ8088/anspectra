import type { Provider } from "@anspectra/types";

export const PROVIDER_NO_OUTPUT_TIMEOUT_MS = {
	chatgpt: 90_000,
	perplexity: 45_000,
	gemini: 45_000,
	claude: 60_000,
	deepseek: 60_000,
	doubao: 60_000,
	hunyuan: 60_000,
	qwen: 60_000,
	"ai-overview": 45_000,
} satisfies Record<Provider, number>;

export const PROVIDER_FORCE_EXIT_STABLE_MS = {
	chatgpt: 45_000,
	perplexity: 30_000,
	gemini: 45_000,
	claude: 45_000,
	deepseek: 45_000,
	// Doubao's web-search mode can pause between numbered sections while its
	// stop control remains visible. Keep the stable-state fallback conservative;
	// response completeness validation still rejects genuinely truncated output.
	doubao: 90_000,
	hunyuan: 45_000,
	qwen: 45_000,
	"ai-overview": 30_000,
} satisfies Record<Provider, number>;

export const PROVIDER_EDITOR_SELECTORS = {
	chatgpt: [
		"#prompt-textarea",
		'div#prompt-textarea[contenteditable="true"][role="textbox"]',
		'div.ProseMirror[contenteditable="true"][role="textbox"]',
		'div[contenteditable="true"][role="textbox"][aria-multiline="true"][aria-label="Chat with ChatGPT"]',
	],
	perplexity: [
		"#ask-input",
		'div#ask-input[contenteditable="true"][role="textbox"]',
		'div[role="textbox"][data-lexical-editor="true"]',
		'div[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
	],
	gemini: [
		'div[aria-label="Enter a prompt for Gemini"]',
		'rich-textarea [contenteditable="true"][role="textbox"]',
		'div[contenteditable="true"][role="textbox"][aria-multiline="true"]',
	],
	claude: [
		'[data-testid="chat-input"]',
		'div[data-testid="chat-input"][contenteditable="true"][role="textbox"]',
		'[data-testid="chat-input"][aria-multiline="true"]',
	],
	deepseek: [
		'textarea[name="user query"]',
		'textarea[placeholder*="DeepSeek" i]',
		"textarea.ds-textarea__textarea",
	],
	doubao: [
		"textarea",
		'textarea[placeholder*="豆包" i]',
		'textarea[placeholder*="发消息" i]',
		'textarea[placeholder*="Ask" i]',
		'div[contenteditable="true"][role="textbox"]',
		'div[contenteditable="true"]',
	],
	hunyuan: [
		'.ql-editor[contenteditable="true"]',
		'[contenteditable="true"][data-placeholder*="Ask me anything" i]',
		"textarea",
		'textarea[placeholder*="问" i]',
		'textarea[placeholder*="元宝" i]',
		'textarea[placeholder*="发消息" i]',
		'div[contenteditable="true"][role="textbox"]',
		'div[contenteditable="true"]',
	],
	qwen: [
		"textarea",
		'textarea[placeholder*="Ask" i]',
		'textarea[placeholder*="Qwen" i]',
		'textarea[placeholder*="千问" i]',
		'div[contenteditable="true"][role="textbox"]',
		'div[contenteditable="true"]',
	],
	"ai-overview": [
		'textarea[name="q"][role="combobox"]',
		'textarea[role="combobox"][aria-label="Search"]',
	],
} satisfies Record<Provider, string[]>;

export const PROVIDER_SUBMIT_BTN_SELECTORS = {
	chatgpt: ['button[data-testid="send-button"]'],
	perplexity: ['button[aria-label*="Submit"]'],
	gemini: ['button[aria-label*="Send"]'],
	claude: ['button[aria-label*="Send"]'],
	deepseek: [
		'button[aria-label*="Send" i]',
		'button[aria-label*="发送" i]',
		'button:has-text("Send")',
		'button:has-text("发送")',
	],
	doubao: [
		"button#flow-end-msg-send",
		'.send-btn-wrapper button[data-dbx-name="button"]',
		'button[aria-label*="Send" i]',
		'button[aria-label*="发送" i]',
		'button:has-text("Send")',
		'button:has-text("发送")',
	],
	hunyuan: [
		'button[aria-label*="Send" i]',
		'button[aria-label*="发送" i]',
		'button:has-text("Send")',
		'button:has-text("发送")',
	],
	qwen: [
		'button[aria-label*="Send" i]',
		'button[aria-label*="发送" i]',
		'button:has-text("Send")',
		'button:has-text("发送")',
	],
	"ai-overview": [],
} satisfies Record<Provider, string[]>;

export const PROVIDER_MODEL_RESPONSE_SELECTORS = {
	chatgpt: [
		'[data-message-author-role="assistant"]',
		'[data-testid^="conversation-turn"][data-turn="assistant"]',
	],
	perplexity: [
		'div[id^="markdown-content-"]',
		'[id^="markdown-content-"] .prose',
	],
	gemini: ["message-content .markdown"],
	claude: [
		'[data-is-streaming="false"] .standard-markdown',
		".standard-markdown",
	],
	deepseek: [".ds-markdown:not(.ds-think-content *)"],
	doubao: [
		'[data-message-id]:not([class*="justify-end"]) .md-box-root',
		".md-box-root",
		".markdown-body",
		".markdown",
		'[class*="markdown" i]',
		'[data-testid*="answer" i]',
		'[data-testid*="message" i]',
	],
	hunyuan: [
		".hyc-common-markdown",
		".markdown-body",
		".markdown",
		'[class*="markdown" i]',
		'[data-testid*="answer" i]',
		'[data-testid*="message" i]',
	],
	qwen: [
		".markdown-body",
		".markdown",
		'[class*="markdown" i]',
		'[data-testid*="message" i]',
		'[data-message-author-role="assistant"]',
	],
	"ai-overview": ['[data-container-id="main-col"]'],
} satisfies Record<Provider, string[]>;

export const PROVIDER_RESPONSE_GENERATION_SELECTORS = {
	chatgpt: [
		'button[data-testid="stop-button"]',
		'button[aria-label*="stop" i]',
	],
	perplexity: ['button[aria-label*="stop" i]'],
	gemini: ['button[aria-label*="stop" i]'],
	claude: ['button[aria-label*="stop" i]'],
	deepseek: ['button[aria-label*="stop" i]', 'button[aria-label*="停止" i]'],
	doubao: [
		'[data-message-id]:not([class*="justify-end"]) .md-box-root[data-streaming="true"]',
		'button[aria-label*="stop" i]',
		'button[aria-label*="停止" i]',
	],
	hunyuan: ['button[aria-label*="stop" i]', 'button[aria-label*="停止" i]'],
	qwen: ['button[aria-label*="stop" i]', 'button[aria-label*="停止" i]'],
	"ai-overview": [],
} satisfies Record<Provider, string[]>;

export const RETRYABLE_ERRORS = [
	"ERR_SSL_PROTOCOL_ERROR",
	"ERR_CONNECTION",
	"ERR_TIMED_OUT",
	"ERR_PROXY_CONNECTION_FAILED",
	"Timeout",
];
