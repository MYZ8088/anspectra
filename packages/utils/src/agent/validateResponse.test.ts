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
});
