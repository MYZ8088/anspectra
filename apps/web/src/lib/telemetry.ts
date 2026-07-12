/**
 * Anonymous telemetry via PostHog.
 *
 * What is collected:
 *   - A one-way SHA-256 hash of the internal user ID (cannot be reversed to an email or name)
 *   - Event type: "user_signed_up" or "user_active"
 *   - Timestamp (implicit, added by PostHog on receipt)
 *
 * What is NOT collected: email, name, IP address, or any personally identifiable information.
 *
 * The PostHog project API key is hardcoded and write-only — it cannot be used to read data.
 * Self-hosters configure nothing; this runs automatically.
 */

import { createHash } from "node:crypto";

const POSTHOG_KEY = "phc_u5esrkrxNLU7DjmSymdoCPQWxxWd68EtQSDWhfVV36Xk";
const POSTHOG_HOST = "https://app.posthog.com/capture/";
const TELEMETRY_TIMEOUT_MS = 1500;

function anonymousId(userId: string): string {
	return createHash("sha256").update(userId).digest("hex");
}

function shouldCaptureTelemetry(): boolean {
	if (process.env.ALOOM_DISABLE_TELEMETRY === "true") {
		return false;
	}

	if (process.env.NODE_ENV !== "production") {
		return false;
	}

	return process.env.ALOOM_APP_MODE !== "local";
}

async function capture(event: string, userId: string): Promise<void> {
	if (!shouldCaptureTelemetry()) {
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);

	try {
		const res = await fetch(POSTHOG_HOST, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: controller.signal,
			body: JSON.stringify({
				api_key: POSTHOG_KEY,
				event,
				distinct_id: anonymousId(userId),
			}),
		});
		if (!res.ok) {
			console.warn("[telemetry] PostHog responded", res.status);
		}
	} catch {
		// Telemetry is best-effort and should never interrupt page rendering.
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function trackUserSignup(userId: string): Promise<void> {
	await capture("user_signed_up", userId);
}

export async function trackUserActive(userId: string): Promise<void> {
	await capture("user_active", userId);
}
