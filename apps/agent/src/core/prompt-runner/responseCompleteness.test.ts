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

	it("rejects a Qwen search plan captured before the final answer", () => {
		expect(
			getIncompleteResponseReason(
				"我将使用网页搜索来查找 PostHog 官方网站及其产品定位信息。",
				"请使用网页搜索查找 PostHog 官方网站。",
			),
		).toBe("plan_only");
	});

	it("rejects a Qwen search-step transition before the final answer", () => {
		expect(
			getIncompleteResponseReason(
				"根据搜索结果，我来访问 PostHog 官方网站获取更准确的产品定位信息。",
				"请使用网页搜索查找 PostHog 官方网站。",
			),
		).toBe("plan_only");
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

	it("accepts Qwen bold escaped numbered sections and ignores a thematic break", () => {
		expect(
			getIncompleteResponseReason(
				[
					"企业应重点评估以下三个核心因素：",
					"**1\\. 核心功能与业务场景的契合度** 第一项的完整说明。",
					"**2\\. 技术集成能力与数据合规性** 第二项的完整说明。",
					"**3\\. 总体拥有成本与团队易用性** 第三项的完整说明。",
					"* * *",
					"_以上内容为一般性参考。_",
				].join("\n\n"),
				"请用三点说明企业选择产品分析工具时应评估哪些因素。",
			),
		).toBeNull();
	});
});
