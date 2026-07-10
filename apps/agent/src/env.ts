import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_MODE_LIST } from "@answerloom/types";
import dotenv from "dotenv";
import { z } from "zod";

const envFilePath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	".env",
);

if (process.env.NODE_ENV !== "production") {
	if (fs.existsSync(envFilePath)) {
		dotenv.config({ path: envFilePath });
	}
}

const asNumber = (fallback: number) =>
	z.preprocess((value) => {
		if (typeof value === "number") return value;
		if (typeof value !== "string") return fallback;
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : fallback;
	}, z.number());

const asBoolean = (fallback = false) =>
	z.preprocess((value) => {
		if (typeof value === "boolean") return value;
		if (typeof value !== "string") return fallback;
		const normalized = value.trim().toLowerCase();
		if (!normalized) return fallback;
		return normalized === "true" || normalized === "1";
	}, z.boolean());

const AgentEnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	ANSWERLOOM_APP_MODE: z.enum(APP_MODE_LIST).default("local"),
	AGENT_AUTH_UPLOAD_TOKEN: z.string().trim().optional(),
	COLLECTOR_API_URL: z.string().trim().url().optional(),
	COLLECTOR_DEVICE_TOKEN: z.string().trim().optional(),
	DEBUG_ENABLED: asBoolean(false).default(false),
	PROXY_SCHEME: z.enum(["http", "https"]).optional(),
	THORDATA_PROXY_API_URL: z.string().trim().url().optional(),
	REDIS_HOST: z.string().trim().default("redis"),
	REDIS_PORT: asNumber(6379).default(6379),
	REDIS_PASSWORD: z.string().default(""),
});

export const env = AgentEnvSchema.parse({
	...process.env,
	ANSWERLOOM_APP_MODE: process.env.ANSWERLOOM_APP_MODE,
});
