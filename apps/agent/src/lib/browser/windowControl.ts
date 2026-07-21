import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProviderWindowGeometry } from "./windowGeometry.js";

const execFileAsync = promisify(execFile);
const WINDOW_TOLERANCE_PX = 4;

function parseObservedGeometry(value: string): ProviderWindowGeometry | null {
	const parts = value
		.trim()
		.split("|")
		.map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
		return null;
	}
	return {
		x: parts[0] ?? 0,
		y: parts[1] ?? 0,
		width: parts[2] ?? 0,
		height: parts[3] ?? 0,
	};
}

export function parseObservedGeometryList(
	value: string,
): ProviderWindowGeometry[] {
	return value
		.trim()
		.split(";")
		.map(parseObservedGeometry)
		.filter(
			(geometry): geometry is ProviderWindowGeometry => geometry !== null,
		);
}

function geometryMatches(
	actual: ProviderWindowGeometry,
	expected: ProviderWindowGeometry,
): boolean {
	return (Object.keys(expected) as Array<keyof ProviderWindowGeometry>).every(
		(key) => Math.abs(actual[key] - expected[key]) <= WINDOW_TOLERANCE_PX,
	);
}

export async function normalizeFirefoxWindowStore(
	profileDir: string,
	geometry: ProviderWindowGeometry,
): Promise<boolean> {
	const filePath = path.join(profileDir, "xulstore.json");
	let document: Record<string, unknown>;
	try {
		document = JSON.parse(await readFile(filePath, "utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		return false;
	}

	const browserKey = "chrome://browser/content/browser.xhtml";
	const browser = {
		...((document[browserKey] ?? {}) as Record<string, unknown>),
	};
	const mainWindow = {
		...((browser["main-window"] ?? {}) as Record<string, unknown>),
		sizemode: "normal",
		screenX: String(geometry.x),
		screenY: String(geometry.y),
		width: String(geometry.width),
		height: String(geometry.height),
	};
	browser["main-window"] = mainWindow;
	document[browserKey] = browser;

	const temporary = `${filePath}.${process.pid}.tmp`;
	await writeFile(temporary, JSON.stringify(document), "utf8");
	await rename(temporary, filePath);
	return true;
}

async function findProfileProcessId(
	profileDir: string,
): Promise<number | null> {
	if (process.platform === "win32") {
		const escaped = profileDir.replace(/'/g, "''");
		const script = [
			`$match = Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'firefox|camoufox') -and ($_.CommandLine -like '*${escaped}*') } | Select-Object -First 1`,
			"if ($match) { Write-Output $match.ProcessId }",
		].join("; ");
		try {
			const { stdout } = await execFileAsync(
				"powershell.exe",
				["-NoProfile", "-NonInteractive", "-Command", script],
				{ timeout: 5_000 },
			);
			const pid = Number(stdout.trim());
			return Number.isInteger(pid) && pid > 0 ? pid : null;
		} catch {
			return null;
		}
	}
	try {
		const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);
		const line = stdout
			.split("\n")
			.find(
				(entry) =>
					entry.includes(profileDir) && /firefox|camoufox/i.test(entry),
			);
		if (!line) return null;
		const pid = Number(line.trim().split(/\s+/, 1)[0]);
		return Number.isInteger(pid) ? pid : null;
	} catch {
		return null;
	}
}

async function runWindowsWindowCommand(
	profileDir: string,
	action: "minimize" | "focus",
): Promise<void> {
	const pid = await findProfileProcessId(profileDir);
	if (!pid) return;
	const showCommand = action === "minimize" ? 6 : 9;
	const focusLine =
		action === "focus"
			? "[AnspectraWindow]::SetForegroundWindow($handle) | Out-Null"
			: "";
	const script = [
		"Add-Type @'",
		"using System;",
		"using System.Runtime.InteropServices;",
		"public static class AnspectraWindow {",
		'  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
		'  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
		"}",
		"'@",
		`$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
		"if ($process) {",
		"  $handle = $process.MainWindowHandle",
		"  if ($handle -ne [IntPtr]::Zero) {",
		`    [AnspectraWindow]::ShowWindowAsync($handle, ${showCommand}) | Out-Null`,
		`    ${focusLine}`,
		"  }",
		"}",
	].join("\n");
	await execFileAsync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", script],
		{ timeout: 8_000 },
	).catch(() => null);
}

async function runMacWindowCommand(
	profileDir: string,
	action: "minimize" | "focus",
): Promise<void> {
	const pid = await findProfileProcessId(profileDir);
	if (!pid) return;
	const script =
		action === "minimize"
			? `tell application "System Events" to tell first process whose unix id is ${pid} to set value of attribute "AXMinimized" of every window to true`
			: `tell application "System Events" to tell first process whose unix id is ${pid}\nset frontmost to true\nrepeat with targetWindow in windows\ntry\nset value of attribute "AXMinimized" of targetWindow to false\nperform action "AXRaise" of targetWindow\nend try\nend repeat\nend tell`;
	await execFileAsync("osascript", ["-e", script]).catch(() => null);
}

async function fitMacWindow(
	profileDir: string,
	geometry: ProviderWindowGeometry,
): Promise<ProviderWindowGeometry | null> {
	const pid = await findProfileProcessId(profileDir);
	if (!pid) return null;
	const script = `tell application "System Events"
set targetProcess to first process whose unix id is ${pid}
repeat with attemptNumber from 1 to 20
if (count of windows of targetProcess) > 0 then
tell targetProcess
set observedValues to {}
repeat with candidateWindow in windows
try
set candidateSubrole to subrole of candidateWindow
if candidateSubrole is "AXStandardWindow" or candidateSubrole is "AXDialog" then
try
try
set value of attribute "AXFullScreen" of candidateWindow to false
end try
try
set value of attribute "AXZoomed" of candidateWindow to false
end try
try
set value of attribute "AXMinimized" of candidateWindow to false
end try
set position of candidateWindow to {${geometry.x}, ${geometry.y}}
set size of candidateWindow to {${geometry.width}, ${geometry.height}}
delay 0.1
set actualPosition to position of candidateWindow
set actualSize to size of candidateWindow
set end of observedValues to ((item 1 of actualPosition as integer) as text) & "|" & ((item 2 of actualPosition as integer) as text) & "|" & ((item 1 of actualSize as integer) as text) & "|" & ((item 2 of actualSize as integer) as text)
on error
set end of observedValues to "0|0|0|0"
end try
end if
end try
end repeat
if (count of observedValues) > 0 then
set previousDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to ";"
set outputValue to observedValues as text
set AppleScript's text item delimiters to previousDelimiters
return outputValue
end if
end tell
end if
delay 0.2
end repeat
return ""
end tell`;
	const { stdout } = await execFileAsync("osascript", ["-e", script], {
		timeout: 10_000,
	}).catch(() => ({ stdout: "" }));
	const observed = parseObservedGeometryList(stdout);
	return observed.length > 0 &&
		observed.every((item) => geometryMatches(item, geometry))
		? (observed[0] ?? null)
		: null;
}

async function fitWindowsWindow(
	profileDir: string,
	geometry: ProviderWindowGeometry,
): Promise<ProviderWindowGeometry | null> {
	const pid = await findProfileProcessId(profileDir);
	if (!pid) return null;
	const script = [
		"Add-Type @'",
		"using System;",
		"using System.Runtime.InteropServices;",
		"public static class AnspectraWindowFit {",
		'  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);',
		'  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
		"  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
		"}",
		"'@",
		`$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
		"if ($process) {",
		"  $handle = $process.MainWindowHandle",
		"  if ($handle -ne [IntPtr]::Zero) {",
		`    [AnspectraWindowFit]::MoveWindow($handle, ${geometry.x}, ${geometry.y}, ${geometry.width}, ${geometry.height}, $true) | Out-Null`,
		"    $rect = New-Object AnspectraWindowFit+RECT",
		"    [AnspectraWindowFit]::GetWindowRect($handle, [ref]$rect) | Out-Null",
		'    Write-Output "$($rect.Left)|$($rect.Top)|$($rect.Right - $rect.Left)|$($rect.Bottom - $rect.Top)"',
		"  }",
		"}",
	].join("\n");
	const { stdout } = await execFileAsync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", script],
		{ timeout: 8_000 },
	).catch(() => ({ stdout: "" }));
	return parseObservedGeometry(stdout);
}

export async function minimizeProviderWindow(
	profileDir: string,
): Promise<void> {
	if (process.platform === "darwin") {
		await runMacWindowCommand(profileDir, "minimize");
	} else if (process.platform === "win32") {
		await runWindowsWindowCommand(profileDir, "minimize");
	}
}

export async function focusProviderWindow(profileDir: string): Promise<void> {
	if (process.platform === "darwin") {
		await runMacWindowCommand(profileDir, "focus");
	} else if (process.platform === "win32") {
		await runWindowsWindowCommand(profileDir, "focus");
	}
}

export async function fitProviderWindow(
	profileDir: string,
	geometry: ProviderWindowGeometry,
): Promise<ProviderWindowGeometry | null> {
	const deadline = Date.now() + 30_000;
	do {
		const observed =
			process.platform === "darwin"
				? await fitMacWindow(profileDir, geometry)
				: process.platform === "win32"
					? await fitWindowsWindow(profileDir, geometry)
					: null;
		if (observed && geometryMatches(observed, geometry)) return observed;
		await new Promise((resolve) => setTimeout(resolve, 250));
	} while (Date.now() < deadline);
	return null;
}
