import type { FailureType } from "@anspectra/types";
import { HumanChallengeError } from "../error/HumanChallengeError.js";
import { toErrorMessage } from "./toErrorMessage.js";

export type { FailureType };

export function classifyError(err: unknown): FailureType {
	if (err instanceof HumanChallengeError) return "human_challenge";
	const msg = toErrorMessage(err).toLowerCase();

	if (
		// Chromium format: ERR_SSL_*, ERR_PROXY_*, ERR_CONNECTION_*, ERR_TUNNEL_*, ERR_TIMED_OUT
		// Firefox/Camoufox format: SSL_ERROR_*, PR_CONNECT_*, SEC_ERROR_*
		/err_proxy|err_connection|err_tunnel|err_ssl|err_timed_out|ns_error_(?:failure|net_reset|net_timeout|unknown_host)|proxy connect failed|tunnel connection|ssl_error|pr_connect|sec_error/i.test(
			msg,
		)
	)
		return "connection_error";
	if (/human.?challenge|required.*captcha|qr.?login/i.test(msg))
		return "human_challenge";
	if (/bot.?detect|cloudflare|captcha|turnstile|challenge/i.test(msg))
		return "bot_detection";
	if (
		/rate.?limit|too many|usage.?limit|status\s*429|403.*forbidden|access.?denied/i.test(
			msg,
		)
	)
		return "rate_limited";
	if (
		/send failed|no send button|no generation|typing failed|input has no content before submit|editor is empty before submit|submission.*failed|all submission/i.test(
			msg,
		)
	)
		return "submission_failed";
	if (
		/no.*editor|editor for .* not found|editor.*not.*ready|editor blocked by overlay|no_editor|search box not found/i.test(
			msg,
		)
	)
		return "no_editor";
	if (/session expired|login wall|redirected to login|logged.?out/i.test(msg))
		return "logged_out";
	if (
		/extraction.*fail|empty.*response|extracted response.*(?:incomplete|prompt echo)|response.*incomplete|prompt echo/i.test(
			msg,
		)
	)
		return "extraction_failed";
	if (/timed?\s*out/i.test(msg)) return "timeout";
	if (
		/window is null|protocol error|browser has been closed|target crashed|browser.*disconnect/i.test(
			msg,
		)
	)
		return "browser_crash";
	return "unknown";
}
