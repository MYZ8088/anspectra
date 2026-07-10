import { describe, expect, it } from "vitest";
import { findProfileOwnerPidInProcessList } from "./auth.js";

describe("persistent provider profile ownership", () => {
	it("finds the primary Camoufox process and ignores content processes", () => {
		const profileDir = "/tmp/answerloom/runtime/hunyuan/profile";
		const processList = [
			`402 /Applications/Camoufox.app/Contents/MacOS/plugin-container -profile ${profileDir}`,
			`401 /Applications/Camoufox.app/Contents/MacOS/camoufox -no-remote -profile ${profileDir} -juggler-pipe`,
		].join("\n");

		expect(findProfileOwnerPidInProcessList(processList, profileDir)).toBe(401);
	});

	it("does not match a different provider profile", () => {
		const processList =
			"401 /Applications/Camoufox.app/Contents/MacOS/camoufox -profile /tmp/answerloom/runtime/doubao/profile";

		expect(
			findProfileOwnerPidInProcessList(
				processList,
				"/tmp/answerloom/runtime/hunyuan/profile",
			),
		).toBeNull();
	});
});
