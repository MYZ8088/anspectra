import {
	ensureEnvFiles,
	inspectLocalCamoufoxRuntime,
} from "./lib/runtime.mjs";

await ensureEnvFiles();
const diagnostics = await inspectLocalCamoufoxRuntime();

console.log(
	JSON.stringify(
		{
			ok: diagnostics.ok,
			runtimeRoot: diagnostics.runtimeRoot,
			python: diagnostics.probe?.python ?? diagnostics.pythonBin,
			pythonVersion: diagnostics.probe?.pythonVersion ?? null,
			packageVersion: diagnostics.probe?.packageVersion ?? null,
			browserChannel: diagnostics.activeChannel,
			browserInstalled: diagnostics.versionOutput
				? /\bInstalled\s+Yes\b/i.test(diagnostics.versionOutput)
				: false,
			geoip: diagnostics.probe?.geoip ?? false,
			executablePath: diagnostics.probe?.executablePath ?? null,
			failures: diagnostics.failures,
		},
		null,
		2,
	),
);

if (!diagnostics.ok) process.exitCode = 1;
