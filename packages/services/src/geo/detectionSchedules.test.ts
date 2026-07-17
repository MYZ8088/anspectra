import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
	"postgresql://postgres:postgres@127.0.0.1:5432/aloom";

const { nextDetectionScheduleAt, resolveDetectionScheduleModes } = await import(
	"./detectionSchedules.js"
);

describe("nextDetectionScheduleAt", () => {
	it("calculates daily occurrences in the selected timezone", () => {
		const next = nextDetectionScheduleAt({
			cadence: "daily",
			timezone: "Asia/Shanghai",
			localTime: "09:00",
			from: new Date("2026-07-12T00:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-07-12T01:00:00.000Z");
	});

	it("moves a daily occurrence to tomorrow after today's time has passed", () => {
		const next = nextDetectionScheduleAt({
			cadence: "daily",
			timezone: "Asia/Shanghai",
			localTime: "09:00",
			from: new Date("2026-07-12T02:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-07-13T01:00:00.000Z");
	});

	it("calculates weekly occurrences in the selected timezone", () => {
		const next = nextDetectionScheduleAt({
			cadence: "weekly",
			timezone: "Asia/Shanghai",
			localTime: "09:00",
			dayOfWeek: 1,
			from: new Date("2026-07-12T00:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-07-13T01:00:00.000Z");
	});

	it("limits monthly schedules to stable calendar days", () => {
		const next = nextDetectionScheduleAt({
			cadence: "monthly",
			timezone: "Asia/Shanghai",
			localTime: "09:00",
			dayOfMonth: 15,
			from: new Date("2026-07-12T00:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-07-15T01:00:00.000Z");
	});

	it("rejects invalid IANA timezones", () => {
		expect(() =>
			nextDetectionScheduleAt({
				cadence: "weekly",
				timezone: "Not/A_Timezone",
				localTime: "09:00",
			}),
		).toThrow("valid IANA timezone");
	});

	it("freezes one supported official Web mode per provider", () => {
		expect(
			resolveDetectionScheduleModes(["doubao", "qwen"], {
				doubao: "expert",
				qwen: "reasoning",
			}),
		).toEqual({ doubao: "expert", qwen: "reasoning" });
	});

	it("rejects a mode that the scheduled provider cannot expose", () => {
		expect(() =>
			resolveDetectionScheduleModes(["doubao"], { doubao: "web_search" }),
		).toThrow("does not support official Web mode");
	});
});
