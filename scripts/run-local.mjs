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
	waitForChildExit,
	waitForHttp,
} from "./lib/runtime.mjs";

const localAppUrl = "http://localhost:3000";
const dockerPullPolicy = process.env.ALOOM_DOCKER_PULL_POLICY ?? "missing";
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
	await terminateLocalProcesses([repoRoot, "@aloom/agent", "dev"]);
	await terminateLocalWorkspacePackageWatchers();

	const packageWatchers = spawnLocalWorkspacePackageWatchers(localEnv);

	const webChild = spawnCommand(
		"pnpm",
		[
			"--filter",
			"@aloom/web",
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
	const agentChild = spawnCommand("pnpm", ["--filter", "@aloom/agent", "dev"], {
		env: localEnv,
	});

	const stopPackageWatchers = packageWatchers.map((child) =>
		attachTerminationHandler(child),
	);
	const stopWeb = attachTerminationHandler(webChild);
	const stopAgent = attachTerminationHandler(agentChild);

	try {
		await waitForHttp(localAppUrl);
		await warmLocalWebRoutes();
		if (process.env.ALOOM_OPEN_BROWSER !== "0") {
			openBrowser(localAppUrl);
		}
	} catch (error) {
		for (const stopWatcher of stopPackageWatchers) {
			stopWatcher();
		}
		stopWeb();
		stopAgent();
		throw error;
	}

	try {
		await Promise.all([
			...packageWatchers.map((child, index) =>
				waitForChildExit(
					child,
					`Workspace package watch ${LOCAL_WATCH_PACKAGES[index]}`,
				),
			),
			waitForChildExit(webChild, "Web dev"),
			waitForChildExit(agentChild, "Agent dev"),
		]);
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
