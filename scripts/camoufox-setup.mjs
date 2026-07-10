import {
	ensureEnvFiles,
	ensureLocalCamoufoxRuntime,
	inspectLocalCamoufoxRuntime,
} from "./lib/runtime.mjs";

await ensureEnvFiles();
await ensureLocalCamoufoxRuntime();
const diagnostics = await inspectLocalCamoufoxRuntime();

console.log(
	JSON.stringify(
		{
			ok: diagnostics.ok,
			python: diagnostics.probe?.python ?? diagnostics.pythonBin,
			pythonVersion: diagnostics.probe?.pythonVersion ?? null,
			packageVersion: diagnostics.probe?.packageVersion ?? null,
			browserChannel: diagnostics.activeChannel,
			geoip: diagnostics.probe?.geoip ?? false,
			executablePath: diagnostics.probe?.executablePath ?? null,
		},
		null,
		2,
	),
);
