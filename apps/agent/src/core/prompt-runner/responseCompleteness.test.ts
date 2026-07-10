import { describe, expect, it } from "vitest";
import { getIncompleteResponseReason } from "./responseCompleteness.js";

describe("response completeness", () => {
	it("rejects a heading-only partial answer", () => {
		expect(
			getIncompleteResponseReason(
				"# Three Concise Evaluation Points for B2B T",
				"In three concise points, explain what a B2B team should evaluate.",
			),
		).toBe("heading_only");
	});

	it("rejects a three-point answer captured after only two points", () => {
		expect(
			getIncompleteResponseReason(
				"# 企业选型\n\n## 一、数据能力\n1. 数据覆盖\n2. 数据性能",
				"请用三点说明企业选择产品分析工具时应评估哪些因素。",
			),
		).toBe("requested_3_sections_received_2");
	});

	it("accepts a complete three-point answer", () => {
		expect(
			getIncompleteResponseReason(
				"1. Pricing and scale.\n2. Data governance.\n3. Integrations and workflow fit.",
				"In three concise points, explain what a B2B team should evaluate.",
			),
		).toBeNull();
	});
});
