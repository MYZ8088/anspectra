import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	isManagedRuntimeAlive,
	signalProcessTree,
	waitForManagedRuntimeExit,
} from "./local-daemon.mjs";

function waitForReady(child) {
	return new Promise((resolve, reject) => {
		let output = "";
		child.once("error", reject);
		child.stdout?.on("data", (chunk) => {
			output += chunk.toString();
			if (output.includes("ready")) resolve();
		});
	});
}

function waitForExit(child) {
	return new Promise((resolve) => child.once("exit", resolve));
}

describe.skipIf(process.platform === "win32")(
	"local daemon process-group lifecycle",
	() => {
		it("still detects and terminates descendants after the group leader exits", async () => {
			const leader = spawn(
				process.execPath,
				[
					"-e",
					`const { spawn } = require("node:child_process");
					 const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
					 child.once("spawn", () => console.log("ready"));
					 setInterval(() => {}, 1000);`,
				],
				{ detached: true, stdio: ["ignore", "pipe", "ignore"] },
			);
			const pid = leader.pid;
			if (!pid) throw new Error("Test process did not start");

			try {
				await waitForReady(leader);
				const leaderExited = waitForExit(leader);
				process.kill(pid, "SIGKILL");
				await leaderExited;

				expect(isManagedRuntimeAlive(pid)).toBe(true);
				signalProcessTree(pid, "SIGKILL");
				expect(await waitForManagedRuntimeExit(pid, 5_000)).toBe(true);
			} finally {
				signalProcessTree(pid, "SIGKILL");
				await waitForManagedRuntimeExit(pid, 2_000);
			}
		}, 10_000);
	},
);
