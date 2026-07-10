import { z } from "zod";

const asNumber = (fallback: number) =>
	z.preprocess((value) => {
		if (typeof value === "number") return value;
		if (typeof value !== "string") return fallback;
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : fallback;
	}, z.number());

const ServicesEnvSchema = z.object({
	REDIS_HOST: z.string().trim().default("redis"),
	REDIS_PORT: asNumber(6379).default(6379),
	REDIS_PASSWORD: z.string().optional(),
	API_BASE_URL: z.string().url().optional(),
	INTERNAL_CRON_SECRET: z.string().optional(),
	OPENAI_API_KEY: z.string().optional(),
	ANTHROPIC_API_KEY: z.string().optional(),
	AIHUBMIX_API_KEY: z.string().optional(),
	aihubmix_api_key: z.string().optional(),
	AIHUBMIX_BASE_URL: z.string().url().default("https://aihubmix.com/v1"),
	AIHUBMIX_ANALYSIS_MODEL: z.string().default("deepseek-v4-pro"),
	AIHUBMIX_ANALYSIS_FALLBACK_MODEL: z.string().default("gpt-4.1-mini"),
	ANALYSIS_LLM_PROVIDER: z
		.enum(["openai", "claude", "aihubmix"])
		.default("openai"),
	PUBLISHER_ENCRYPTION_KEY: z.string().min(16).optional(),
});

export const env = ServicesEnvSchema.parse(process.env);
