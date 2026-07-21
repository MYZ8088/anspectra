import { submitAgentJobGroup } from "@anspectra/services";

type SubmitAgentRunResult =
	| { jobId: string; status: "queued" }
	| { jobId: null; status: "empty" }
	| { jobId: null; status: "no-providers"; disconnectedProviders: string[] };

export async function submitAgentRun(args: {
	workspaceId: string;
	userId: string;
}): Promise<SubmitAgentRunResult> {
	const result = await submitAgentJobGroup(args);

	if (result.status === "empty") {
		return { jobId: null, status: "empty" };
	}

	if (result.status === "no-providers") {
		return {
			jobId: null,
			status: "no-providers",
			disconnectedProviders: result.disconnectedProviders,
		};
	}

	return { jobId: result.jobGroupId, status: "queued" };
}
