import { describe, expect, it } from "vitest";
import {
	decryptAnalysisApiKey,
	encryptAnalysisApiKey,
	normalizeAnalysisBaseUrl,
} from "./modelCredentials.js";

describe("analysis model configuration", () => {
	it("normalizes compatible API base URLs", () => {
		expect(normalizeAnalysisBaseUrl("https://gateway.example.com/v1/ ")).toBe(
			"https://gateway.example.com/v1",
		);
	});

	it("rejects credentials embedded in the base URL", () => {
		expect(() =>
			normalizeAnalysisBaseUrl("https://user:secret@example.com/v1"),
		).toThrow("Do not include credentials");
	});

	it("encrypts API keys with workspace-bound authenticated encryption", () => {
		const encryptedApiKey = encryptAnalysisApiKey({
			apiKey: "secret-key",
			workspaceId: "workspace-a",
			secret: "server-secret-value",
		});
		expect(encryptedApiKey).not.toContain("secret-key");
		expect(
			decryptAnalysisApiKey({
				encryptedApiKey,
				workspaceId: "workspace-a",
				secret: "server-secret-value",
			}),
		).toBe("secret-key");
		expect(() =>
			decryptAnalysisApiKey({
				encryptedApiKey,
				workspaceId: "workspace-b",
				secret: "server-secret-value",
			}),
		).toThrow("could not be decrypted");
	});
});
