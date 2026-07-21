import {
	LOCAL_WATCH_PACKAGES,
	attachTerminationHandler,
	buildLocalRuntimeEnv,
	buildLocalWorkspacePackages,
	edgeNetworkName,
	ensureDockerNetwork,
	ensureEnvFiles,
	ensureLocalCamoufoxRuntime,
	openBrowser,
	repoRoot,
	runCommand,
	spawnCommand,
	spawnLocalWorkspacePackageWatchers,
	terminateLocalProcesses,
	terminateLocalWorkspacePackageWatchers,
	waitForHttp,
} from "./lib/runtime.mjs";

const localAppUrl = "http://localhost:3000";
const dockerPullPolicy = process.env.ANSPECTRA_DOCKER_PULL_POLICY ?? "missing";
const localWarmRoutes = [
	"/dashboard",
	"/monitor",
	"/prompt-library",
	"/runs",
	"/schedule",
	"/providers",
	"/settings",
	"/api/providers",
];

async function warmLocalWebRoutes() {
	for (const route of localWarmRoutes) {
		try {
			await fetch(new URL(route, localAppUrl), {
				cache: "no-store",
				redirect: "manual",
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			console.warn(
				`Could not warm ${route}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

function waitForUnexpectedExit(child, label) {
	return new Promise((_, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			reject(
				new Error(
					`${label} stopped unexpectedly with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`,
				),
			);
		});
	});
}

async function main() {
	await ensureEnvFiles();
	await runCommand("pnpm", ["install"]);
	await ensureLocalCamoufoxRuntime();
	await buildLocalWorkspacePackages();
	const localEnv = buildLocalRuntimeEnv(localAppUrl);
	await ensureDockerNetwork(edgeNetworkName);
	await runCommand("docker", [
		"compose",
		"up",
		"-d",
		"--build",
		"--pull",
		dockerPullPolicy,
		"--force-recreate",
		"--wait",
		"db",
		"clickhouse",
		"redis",
	]);
	await runCommand("pnpm", ["db:migrate"], { env: localEnv });
	await terminateLocalProcesses([repoRoot, "@anspectra/agent", "dev"]);
	await terminateLocalWorkspacePackageWatchers();

	const packageWatchers = spawnLocalWorkspacePackageWatchers(localEnv);

	const webChild = spawnCommand(
		"pnpm",
		[
			"--filter",
			"@anspectra/web",
			"exec",
			"next",
			"dev",
			"--turbo",
			"--hostname",
			"localhost",
			"--port",
			"3000",
		],
		{
			env: localEnv,
		},
	);
	const agentChild = spawnCommand(
		"pnpm",
		["--filter", "@anspectra/agent", "dev"],
		{
			env: localEnv,
		},
	);

	const stopPackageWatchers = packageWatchers.map((child) =>
		attachTerminationHandler(child),
	);
	const stopWeb = attachTerminationHandler(webChild);
	const stopAgent = attachTerminationHandler(agentChild);
	const unexpectedExits = [
		...packageWatchers.map((child, index) =>
			waitForUnexpectedExit(
				child,
				`Workspace package watch ${LOCAL_WATCH_PACKAGES[index]}`,
			),
		),
		waitForUnexpectedExit(webChild, "Web dev"),
		waitForUnexpectedExit(agentChild, "Agent dev"),
	];

	try {
		await Promise.race([
			(async () => {
				await waitForHttp(localAppUrl);
				await warmLocalWebRoutes();
				if (process.env.ANSPECTRA_OPEN_BROWSER !== "0") {
					openBrowser(localAppUrl);
				}
			})(),
			...unexpectedExits,
		]);
		await Promise.race(unexpectedExits);
	} finally {
		for (const stopWatcher of stopPackageWatchers) {
			stopWatcher();
		}
		stopWeb();
		stopAgent();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
