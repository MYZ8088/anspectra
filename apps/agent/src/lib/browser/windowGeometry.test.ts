import { describe, expect, it } from "vitest";
import { normalizePersistentWindowGeometry } from "./windowGeometry.js";

describe("persistent provider window geometry", () => {
	it("fits a generated full-screen identity inside the usable display", () => {
		const result = normalizePersistentWindowGeometry({
			env: {
				CAMOU_CONFIG_1: JSON.stringify({
					"screen.width": 1728,
					"screen.height": 1117,
					"screen.availWidth": 1728,
					"screen.availHeight": 1084,
					"screen.availTop": 33,
					"window.outerWidth": 1728,
					"window.outerHeight": 1084,
					"window.innerWidth": 1700,
					"window.innerHeight": 1000,
				}),
			},
		});

		expect(result.geometry).toEqual({
			width: 1360,
			height: 760,
			x: 184,
			y: 195,
		});
		const config = JSON.parse(
			(result.launchOptions.env as Record<string, string>).CAMOU_CONFIG_1 ??
				"{}",
		) as Record<string, number>;
		expect(config["window.outerWidth"]).toBe(1360);
		expect(config["window.outerHeight"]).toBe(760);
		expect(config["window.innerWidth"]).toBe(1332);
		expect(config["window.innerHeight"]).toBe(676);
		expect(config["window.screenX"]).toBe(184);
		expect(config["window.screenY"]).toBe(195);
	});

	it("keeps the window within a smaller usable display", () => {
		const result = normalizePersistentWindowGeometry({
			env: {
				CAMOU_CONFIG_1: JSON.stringify({
					"screen.width": 1280,
					"screen.height": 800,
					"screen.availWidth": 1280,
					"screen.availHeight": 720,
					"window.outerWidth": 1280,
					"window.outerHeight": 720,
				}),
			},
		});

		expect(result.geometry.width).toBeLessThanOrEqual(1280);
		expect(result.geometry.height).toBeLessThanOrEqual(720);
		expect(result.geometry.x).toBeGreaterThanOrEqual(0);
		expect(result.geometry.y).toBeGreaterThanOrEqual(0);
	});

	it("uses the real host working area instead of the generated fingerprint screen", () => {
		const result = normalizePersistentWindowGeometry(
			{
				env: {
					CAMOU_CONFIG_1: JSON.stringify({
						"screen.width": 1728,
						"screen.height": 1117,
						"screen.availWidth": 1728,
						"screen.availHeight": 1084,
						"screen.availTop": 33,
						"window.outerWidth": 1728,
						"window.outerHeight": 1084,
					}),
				},
			},
			{
				fullWidth: 1512,
				fullHeight: 982,
				availableWidth: 1512,
				availableHeight: 854,
				availableLeft: 0,
				availableTop: 33,
			},
		);

		expect(result.geometry).toEqual({
			width: 1360,
			height: 760,
			x: 76,
			y: 80,
		});
		const config = JSON.parse(
			(result.launchOptions.env as Record<string, string>).CAMOU_CONFIG_1 ??
				"{}",
		) as Record<string, number>;
		expect(config["screen.width"]).toBe(1512);
		expect(config["screen.height"]).toBe(982);
		expect(config["screen.availHeight"]).toBe(854);
	});

	it("replaces a verified geometry that is still too close to the display edges", () => {
		const launchOptions = {
			env: {
				CAMOU_CONFIG_1: JSON.stringify({
					"screen.width": 1512,
					"screen.height": 982,
					"screen.availWidth": 1512,
					"screen.availHeight": 854,
					"screen.availTop": 33,
					"window.outerWidth": 1440,
					"window.outerHeight": 806,
				}),
			},
		};
		const result = normalizePersistentWindowGeometry(
			launchOptions,
			{
				fullWidth: 1512,
				fullHeight: 982,
				availableWidth: 1512,
				availableHeight: 857,
				availableLeft: 0,
				availableTop: 33,
			},
			{ width: 1440, height: 806, x: 36, y: 57 },
		);

		expect(result.geometry).toEqual({
			width: 1360,
			height: 760,
			x: 76,
			y: 82,
		});
		const config = JSON.parse(
			(result.launchOptions.env as Record<string, string>).CAMOU_CONFIG_1 ??
				"{}",
		) as Record<string, number>;
		expect(config["screen.availHeight"]).toBe(857);
	});

	it("preserves a verified geometry with visible safety margins", () => {
		const launchOptions = {
			env: {
				CAMOU_CONFIG_1: JSON.stringify({
					"screen.width": 1512,
					"screen.height": 982,
					"screen.availWidth": 1512,
					"screen.availHeight": 854,
					"screen.availTop": 33,
					"window.outerWidth": 1360,
					"window.outerHeight": 760,
				}),
			},
		};
		const result = normalizePersistentWindowGeometry(
			launchOptions,
			{
				fullWidth: 1512,
				fullHeight: 982,
				availableWidth: 1512,
				availableHeight: 857,
				availableLeft: 0,
				availableTop: 33,
			},
			{ width: 1360, height: 760, x: 76, y: 80 },
		);

		expect(result.geometry).toEqual({
			width: 1360,
			height: 760,
			x: 76,
			y: 80,
		});
	});
});
