import type { ChallengeKind } from "@anspectra/types";
import { BaseError } from "./BaseError.js";

export class HumanChallengeError extends BaseError {
	public readonly provider: string;
	public readonly challengeKind: ChallengeKind;
	public readonly pageUrl: string;

	constructor(args: {
		provider: string;
		kind: ChallengeKind;
		pageUrl: string;
		message: string;
	}) {
		super(`${args.provider}: ${args.message}`, {
			code: "HUMAN_CHALLENGE_REQUIRED",
			status: 409,
			meta: {
				provider: args.provider,
				challengeKind: args.kind,
				pageUrl: args.pageUrl,
			},
		});
		this.provider = args.provider;
		this.challengeKind = args.kind;
		this.pageUrl = args.pageUrl;
	}
}
