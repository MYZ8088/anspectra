import { describe, expect, it } from "vitest";
import { parseObservedGeometryList } from "./windowControl.js";

describe("provider window geometry readback", () => {
	it("parses every standard window returned by macOS", () => {
		expect(parseObservedGeometryList("76|82|1360|760;76|82|1360|760")).toEqual([
			{ x: 76, y: 82, width: 1360, height: 760 },
			{ x: 76, y: 82, width: 1360, height: 760 },
		]);
	});

	it("drops malformed window observations", () => {
		expect(parseObservedGeometryList("Window|Camoufox;76|82|1360|760")).toEqual(
			[{ x: 76, y: 82, width: 1360, height: 760 }],
		);
	});

	it("keeps failed window sentinels in the verification set", () => {
		expect(parseObservedGeometryList("76|82|1360|760;0|0|0|0")).toEqual([
			{ x: 76, y: 82, width: 1360, height: 760 },
			{ x: 0, y: 0, width: 0, height: 0 },
		]);
	});
});
