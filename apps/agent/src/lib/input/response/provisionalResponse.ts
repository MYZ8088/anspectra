const PROVISIONAL_RESPONSE_PATTERNS = [
	/^(?:我将|我会|让我|现在(?:我)?(?:来)?|接下来我(?:将|会)?).{0,90}(?:网页搜索|联网搜索|搜索|查找|检索|查询|浏览).{0,90}[。！？.!?]?$/u,
	/^(?:根据|基于).{0,80}(?:搜索|检索|查询)(?:结果|信息).{0,80}(?:我(?:来|将|会)?|接下来)(?:访问|打开|查看|浏览|核实|查阅).{0,100}[。！？.!?]?$/u,
	/^(?:我(?:来|将|会)?|接下来)(?:访问|打开|查看|浏览|核实|查阅).{0,100}(?:官网|网站|网页|页面|来源|结果|信息).{0,80}[。！？.!?]?$/u,
	/^(?:i(?:'ll| will| am going to)|i'm going to|let me|i will now).{0,140}(?:web search|search|look up|browse|find).{0,140}[.!?]?$/i,
	/^(?:based on|from).{0,100}(?:search results|results).{0,100}(?:i(?:'ll| will)|let me|i'm going to).{0,100}(?:visit|open|check|browse|verify|review).{0,100}[.!?]?$/i,
];

export function isProvisionalResponse(response: string): boolean {
	const normalized = response.replace(/\s+/g, " ").trim();
	if (!normalized || normalized.length > 280) return false;
	if (/https?:\/\/|www\.|^[-*+]\s|^\d+[.)、]\s/m.test(response)) {
		return false;
	}
	const sentenceEndings = normalized.match(/[。！？.!?]/g)?.length ?? 0;
	if (sentenceEndings > 1) return false;
	return PROVISIONAL_RESPONSE_PATTERNS.some((pattern) =>
		pattern.test(normalized),
	);
}
