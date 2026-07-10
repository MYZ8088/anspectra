import {
	attachTerminationHandler,
	buildLocalRuntimeEnv,
	buildLocalWorkspacePackages,
	ensureEnvFiles,
	ensureLocalCamoufoxRuntime,
	spawnCommand,
	waitForChildExit,
} from "./lib/runtime.mjs";

await ensureEnvFiles();
await ensureLocalCamoufoxRuntime();
await buildLocalWorkspacePackages();

const child = spawnCommand(
	"pnpm",
	["--filter", "@answerloom/agent", "dev"],
	{ env: buildLocalRuntimeEnv(process.env.APP_URL || "http://localhost:3000") },
);
attachTerminationHandler(child);
await waitForChildExit(child, "AnswerLoom collector");
