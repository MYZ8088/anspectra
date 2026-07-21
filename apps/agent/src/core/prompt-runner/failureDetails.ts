import { HumanChallengeError, classifyError, toErrorMessage } from "@anspectra/errors";
import type {
	CollectionPhase,
	FailureCategory,
	FailureCode,
} from "@anspectra/types";

export type PromptFailureDetails = {
	phase: CollectionPhase;
	category: FailureCategory;
	code: FailureCode;
	retryable: boolean;
};

export function describePromptFailure(error: unknown): PromptFailureDetails {
	if (error instanceof HumanChallengeError) {
		const challengeCode: Partial<Record<string, FailureCode>> = {
			captcha: "captcha",
			slider: "slider",
			qr_login: "qr_login",
			login_required: "login_required",
			security_check: "security_confirmation",
			region_block: "region_blocked",
			ui_changed: "selector_changed",
		};
		return {
			phase: error.challengeKind === "ui_changed" ? "extraction" : "session",
			category:
				error.challengeKind === "region_block"
					? "provider_access"
					: error.challengeKind === "ui_changed"
						? "extraction"
						: "account",
			code: challengeCode[error.challengeKind] ?? "captcha",
			retryable: false,
		};
	}
	const failureType = classifyError(error);
	const message = toErrorMessage(error).toLowerCase();
	switch (failureType) {
		case "logged_out":
			return {
				phase: "session",
				category: "account",
				code: "login_required",
				retryable: false,
			};
		case "human_challenge":
		case "bot_detection":
			return {
				phase: "session",
				category: "account",
				code: "captcha",
				retryable: false,
			};
		case "connection_error":
			return {
				phase: "navigation",
				category: "browser_session",
				code: "network_error",
				retryable: true,
			};
		case "rate_limited":
			return {
				phase: "submission",
				category: "provider_access",
				code: "rate_limited",
				retryable: true,
			};
		case "no_editor":
			return {
				phase: "editor",
				category: "interaction",
				code: "editor_missing",
				retryable: true,
			};
		case "submission_failed":
			return {
				phase: /typing|input/.test(message) ? "input" : "submission",
				category: "interaction",
				code: /typing|input/.test(message)
					? "input_failed"
					: "submission_failed",
				retryable: true,
			};
		case "timeout":
			return {
				phase: "generation",
				category: "generation",
				code: "response_timeout",
				retryable: true,
			};
		case "extraction_failed":
			return {
				phase: /echo|incomplete/.test(message) ? "validation" : "extraction",
				category: "extraction",
				code: /echo/.test(message)
					? "prompt_echo"
					: /incomplete/.test(message)
						? "incomplete_response"
					: /empty/.test(message)
						? "empty_response"
						: /assistant.*not found/.test(message)
							? "assistant_not_found"
							: "selector_changed",
				retryable: true,
			};
		case "browser_crash":
			return {
				phase: "session",
				category: "browser_session",
				code: "browser_crash",
				retryable: true,
			};
		default:
			return {
				phase: "generation",
				category: "unknown",
				code: "unknown",
				retryable: true,
			};
	}
}
