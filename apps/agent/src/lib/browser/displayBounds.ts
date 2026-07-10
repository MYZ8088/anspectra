import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type HostDisplayBounds = {
	fullWidth: number;
	fullHeight: number;
	availableWidth: number;
	availableHeight: number;
	availableLeft: number;
	availableTop: number;
};

function validBounds(value: HostDisplayBounds): boolean {
	return (
		value.fullWidth > 0 &&
		value.fullHeight > 0 &&
		value.availableWidth > 0 &&
		value.availableHeight > 0
	);
}

async function resolveMacDisplayBounds(): Promise<HostDisplayBounds | null> {
	const script = [
		'ObjC.import("AppKit")',
		"const screen = $.NSScreen.mainScreen",
		"const full = screen.frame",
		"const visible = screen.visibleFrame",
		"const fullHeight = Number(full.size.height)",
		"JSON.stringify({",
		"fullWidth: Number(full.size.width),",
		"fullHeight,",
		"availableWidth: Number(visible.size.width),",
		"availableHeight: Number(visible.size.height),",
		"availableLeft: Number(visible.origin.x),",
		"availableTop: fullHeight - Number(visible.origin.y) - Number(visible.size.height)",
		"})",
	].join("\n");
	try {
		const { stdout } = await execFileAsync(
			"osascript",
			["-l", "JavaScript", "-e", script],
			{ timeout: 5_000 },
		);
		const parsed = JSON.parse(stdout.trim()) as HostDisplayBounds;
		return validBounds(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

async function resolveWindowsDisplayBounds(): Promise<HostDisplayBounds | null> {
	const script = [
		"Add-Type -AssemblyName System.Windows.Forms",
		"$screen = [System.Windows.Forms.Screen]::PrimaryScreen",
		"$bounds = $screen.Bounds",
		"$working = $screen.WorkingArea",
		"[PSCustomObject]@{",
		"fullWidth = $bounds.Width; fullHeight = $bounds.Height;",
		"availableWidth = $working.Width; availableHeight = $working.Height;",
		"availableLeft = $working.X; availableTop = $working.Y",
		"} | ConvertTo-Json -Compress",
	].join("; ");
	try {
		const { stdout } = await execFileAsync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{ timeout: 5_000 },
		);
		const parsed = JSON.parse(stdout.trim()) as HostDisplayBounds;
		return validBounds(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function resolveHostDisplayBounds(): Promise<HostDisplayBounds | null> {
	if (process.platform === "darwin") return resolveMacDisplayBounds();
	if (process.platform === "win32") return resolveWindowsDisplayBounds();
	return null;
}
