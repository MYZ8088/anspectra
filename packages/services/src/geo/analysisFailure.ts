export type AnalysisFailureCode =
	| "analysis_invalid_json"
	| "analysis_upstream_auth"
	| "analysis_upstream_quota"
	| "analysis_upstream_rate_limit"
	| "analysis_upstream_timeout"
	| "analysis_upstream_error";

export function classifyAnalysisFailureCode(
	error: string,
): AnalysisFailureCode {
	if (
		/usage limit|quota|insufficient[_ ]quota|credit|billing|exhausted/i.test(
			error,
		)
	) {
		return "analysis_upstream_quota";
	}
	if (/\b401\b|unauthorized|invalid api key|authentication/i.test(error)) {
		return "analysis_upstream_auth";
	}
	if (/\b429\b|rate.?limit|too many requests/i.test(error)) {
		return "analysis_upstream_rate_limit";
	}
	if (/timed?\s*out|timeout|aborted/i.test(error)) {
		return "analysis_upstream_timeout";
	}
	if (/invalid json|parse|schema/i.test(error)) {
		return "analysis_invalid_json";
	}
	return "analysis_upstream_error";
}
