import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
	"postgresql://postgres:postgres@127.0.0.1:5432/anspectra";

const {
	nextDetectionScheduleAfterInitialRun,
	nextDetectionScheduleAt,
	resolveDetectionScheduleModes,
} = await import("./detectionSchedules.js");
const { nextDetectionRunAt, parseDetectionRunPlan } = await import(
	"./detectionRunPlan.js"
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

	it("does not duplicate an immediate run later on the same local day", () => {
		const next = nextDetectionScheduleAfterInitialRun({
			cadence: "daily",
			timezone: "Asia/Shanghai",
			localTime: "21:00",
			from: new Date("2026-07-12T12:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-07-13T13:00:00.000Z");
	});

	it("keeps tomorrow when today's recurring time already passed", () => {
		const next = nextDetectionScheduleAfterInitialRun({
			cadence: "daily",
			timezone: "Asia/Shanghai",
			localTime: "09:00",
			from: new Date("2026-07-12T12:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-07-13T01:00:00.000Z");
	});

	it("moves a same-day weekly recurrence to the following week", () => {
		const next = nextDetectionScheduleAfterInitialRun({
			cadence: "weekly",
			timezone: "Asia/Shanghai",
			localTime: "21:00",
			dayOfWeek: 5,
			from: new Date("2026-07-17T12:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-07-24T13:00:00.000Z");
	});

	it("moves a same-day monthly recurrence to the following month", () => {
		const next = nextDetectionScheduleAfterInitialRun({
			cadence: "monthly",
			timezone: "Asia/Shanghai",
			localTime: "21:00",
			dayOfMonth: 17,
			from: new Date("2026-07-17T12:00:00.000Z"),
		});
		expect(next.toISOString()).toBe("2026-08-17T13:00:00.000Z");
	});

	it("schedules the next run in a finite detection plan", () => {
		const next = nextDetectionRunAt(
			{
				totalRuns: 3,
				cadence: "weekly",
				timezone: "Asia/Shanghai",
				localTime: "09:30",
				dayOfWeek: 5,
				dayOfMonth: null,
			},
			new Date("2026-07-17T00:00:00.000Z"),
		);
		expect(next.toISOString()).toBe("2026-07-24T01:30:00.000Z");
	});

	it("rejects a damaged finite run plan instead of silently using one run", () => {
		expect(() =>
			parseDetectionRunPlan({
				totalRuns: 3,
				cadence: "monthly",
				timezone: "Asia/Shanghai",
				localTime: "09:00",
				dayOfMonth: 31,
			}),
		).toThrow("Detection run plan is invalid");
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
