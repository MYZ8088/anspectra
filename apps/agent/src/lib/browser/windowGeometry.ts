import type { HostDisplayBounds } from "./displayBounds.js";

export type ProviderWindowGeometry = {
	width: number;
	height: number;
	x: number;
	y: number;
};

const MAX_WINDOW_WIDTH = 1360;
const MAX_WINDOW_HEIGHT = 760;
const HORIZONTAL_MARGIN = 96;
const VERTICAL_MARGIN = 80;
const MIN_HORIZONTAL_EDGE_GAP = 48;
const MIN_VERTICAL_EDGE_GAP = 32;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 650;

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: fallback;
}

function clampWindowDimension(
	available: number,
	maximum: number,
	minimum: number,
	margin: number,
): number {
	const preferred = Math.min(maximum, Math.max(minimum, available - margin));
	return Math.round(Math.min(Math.max(320, available - 32), preferred));
}

function fitsHostDisplay(
	geometry: ProviderWindowGeometry,
	hostDisplay: HostDisplayBounds,
): boolean {
	const right = hostDisplay.availableLeft + hostDisplay.availableWidth;
	const bottom = hostDisplay.availableTop + hostDisplay.availableHeight;
	return (
		geometry.width > 0 &&
		geometry.height > 0 &&
		geometry.x >= hostDisplay.availableLeft &&
		geometry.y >= hostDisplay.availableTop &&
		geometry.x + geometry.width <= right &&
		geometry.y + geometry.height <= bottom
	);
}

function hasSafeHostMargins(
	geometry: ProviderWindowGeometry,
	hostDisplay: HostDisplayBounds,
): boolean {
	if (!fitsHostDisplay(geometry, hostDisplay)) return false;

	const leftGap = geometry.x - hostDisplay.availableLeft;
	const rightGap =
		hostDisplay.availableLeft +
		hostDisplay.availableWidth -
		(geometry.x + geometry.width);
	const topGap = geometry.y - hostDisplay.availableTop;
	const bottomGap =
		hostDisplay.availableTop +
		hostDisplay.availableHeight -
		(geometry.y + geometry.height);
	const needsHorizontalGap =
		hostDisplay.availableWidth >= MIN_WINDOW_WIDTH + MIN_HORIZONTAL_EDGE_GAP * 2;
	const needsVerticalGap =
		hostDisplay.availableHeight >= MIN_WINDOW_HEIGHT + MIN_VERTICAL_EDGE_GAP * 2;

	return (
		(!needsHorizontalGap ||
			(leftGap >= MIN_HORIZONTAL_EDGE_GAP &&
				rightGap >= MIN_HORIZONTAL_EDGE_GAP)) &&
		(!needsVerticalGap ||
			(topGap >= MIN_VERTICAL_EDGE_GAP &&
				bottomGap >= MIN_VERTICAL_EDGE_GAP))
	);
}

export function normalizePersistentWindowGeometry(
	launchOptions: Record<string, unknown>,
	hostDisplay?: HostDisplayBounds | null,
	previousGeometry?: ProviderWindowGeometry | null,
): {
	launchOptions: Record<string, unknown>;
	geometry: ProviderWindowGeometry;
	changed: boolean;
} {
	const next = { ...launchOptions };
	const env = { ...((launchOptions.env ?? {}) as Record<string, string>) };
	let geometry: ProviderWindowGeometry | null = null;

	for (const key of Object.keys(env).filter((name) =>
		name.startsWith("CAMOU_CONFIG_"),
	)) {
		let config: Record<string, unknown>;
		try {
			config = JSON.parse(env[key] ?? "{}") as Record<string, unknown>;
		} catch {
			continue;
		}

		const screenWidth =
			hostDisplay?.fullWidth ?? finiteNumber(config["screen.width"], 1440);
		const screenHeight =
			hostDisplay?.fullHeight ?? finiteNumber(config["screen.height"], 900);
		const availableWidth = finiteNumber(
			hostDisplay?.availableWidth ?? config["screen.availWidth"],
			screenWidth,
		);
		const availableHeight = finiteNumber(
			hostDisplay?.availableHeight ?? config["screen.availHeight"],
			screenHeight,
		);
		const availableLeft = finiteNumber(
			hostDisplay?.availableLeft ?? config["screen.availLeft"],
			0,
		);
		const availableTop = finiteNumber(
			hostDisplay?.availableTop ?? config["screen.availTop"],
			0,
		);
		const reusableGeometry =
			hostDisplay &&
			previousGeometry &&
			hasSafeHostMargins(previousGeometry, hostDisplay)
				? previousGeometry
				: null;
		const width =
			reusableGeometry?.width ??
			clampWindowDimension(
				availableWidth,
				MAX_WINDOW_WIDTH,
				MIN_WINDOW_WIDTH,
				HORIZONTAL_MARGIN,
			);
		const height =
			reusableGeometry?.height ??
			clampWindowDimension(
				availableHeight,
				MAX_WINDOW_HEIGHT,
				MIN_WINDOW_HEIGHT,
				VERTICAL_MARGIN,
			);
		const x =
			reusableGeometry?.x ??
			Math.round(availableLeft + (availableWidth - width) / 2);
		const y =
			reusableGeometry?.y ??
			Math.round(availableTop + (availableHeight - height) / 2);

		const oldOuterWidth = finiteNumber(config["window.outerWidth"], width);
		const oldOuterHeight = finiteNumber(config["window.outerHeight"], height);
		if (typeof config["window.innerWidth"] === "number") {
			const chromeWidth = Math.max(
				0,
				oldOuterWidth - Number(config["window.innerWidth"]),
			);
			config["window.innerWidth"] = Math.max(1, width - chromeWidth);
		}
		if (typeof config["window.innerHeight"] === "number") {
			const chromeHeight = Math.max(
				0,
				oldOuterHeight - Number(config["window.innerHeight"]),
			);
			config["window.innerHeight"] = Math.max(1, height - chromeHeight);
		}
		config["window.outerWidth"] = width;
		config["window.outerHeight"] = height;
		config["window.screenX"] = x;
		config["window.screenY"] = y;
		if (hostDisplay && !reusableGeometry) {
			config["screen.width"] = screenWidth;
			config["screen.height"] = screenHeight;
			config["screen.availWidth"] = availableWidth;
			config["screen.availHeight"] = availableHeight;
			config["screen.availLeft"] = availableLeft;
			config["screen.availTop"] = availableTop;
		}
		env[key] = JSON.stringify(config);
		geometry ??= { width, height, x, y };
	}

	geometry ??= { width: 1280, height: 800, x: 40, y: 60 };
	next.env = env;
	return {
		launchOptions: next,
		geometry,
		changed: JSON.stringify(next) !== JSON.stringify(launchOptions),
	};
}
