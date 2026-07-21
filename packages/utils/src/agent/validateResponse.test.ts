import { describe, expect, it } from "vitest";
import { validateResponse } from "./validateResponse.js";

describe("validateResponse", () => {
	it("accepts a substantive answer that discusses login and verification", () => {
		const response = `${"企业产品安全评估需要覆盖身份认证、权限与审计。".repeat(80)}
		支持企业微信扫码登录，也要验证手机号登录、验证码和人机验证流程。`;

		expect(validateResponse(response, "deepseek")).toEqual({ valid: true });
	});

	it("rejects a short login wall", () => {
		const response =
			"请先登录后继续使用。你可以选择微信扫码登录或手机号登录，然后返回聊天页面。";

		expect(validateResponse(response, "qwen")).toMatchObject({ valid: false });
	});

	it("rejects a short human-verification surface", () => {
		const response =
			"Security verification required. Please verify you are human to continue using this service.";

		expect(validateResponse(response, "doubao")).toMatchObject({
			valid: false,
		});
	});

	it("rejects a short planning-only response", () => {
		const response =
			"我将严格按照功能、成本、数据、集成、实施难度五大维度进行对比，所有可核验信息均标注公开来源及日期，同时整理清晰对比表并保证内容严谨。";

		expect(validateResponse(response, "doubao")).toMatchObject({
			valid: false,
		});
	});

	it("rejects a Doubao document-card summary without its document body", () => {
		const response = `我将从功能、成本、数据、集成、实施难度五个维度系统对比 Aloom 与 Profound，全程标注可核验公开来源、明确无法确认的信息，保证内容严谨合规、信息完整。
		Aloom与Profound平台五维度对比分析（功能、成本、数据、集成、实施难度）
		创建时间：23:04
		需要我帮你整理一份极简对比总表，方便你快速查阅核心差异吗？`;

		expect(validateResponse(response, "doubao")).toMatchObject({
			valid: false,
		});
	});
});
