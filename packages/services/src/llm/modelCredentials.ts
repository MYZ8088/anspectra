import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { ValidationError } from "@aloom/errors";

const API_KEY_AAD_PREFIX = "aloom:analysis-model:";

function deriveEncryptionKey(secret: string): Buffer {
	return createHash("sha256")
		.update(`aloom-analysis-model\0${secret}`)
		.digest();
}

export function normalizeAnalysisBaseUrl(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value.trim());
	} catch (error) {
		throw new ValidationError("Enter a valid API base URL", undefined, error);
	}
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new ValidationError("The API base URL must use HTTP or HTTPS");
	}
	if (parsed.username || parsed.password) {
		throw new ValidationError("Do not include credentials in the API base URL");
	}
	return parsed.toString().replace(/\/+$/, "");
}

export function encryptAnalysisApiKey(args: {
	apiKey: string;
	workspaceId: string;
	secret: string;
}): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv(
		"aes-256-gcm",
		deriveEncryptionKey(args.secret),
		iv,
	);
	cipher.setAAD(Buffer.from(`${API_KEY_AAD_PREFIX}${args.workspaceId}`));
	const encrypted = Buffer.concat([
		cipher.update(args.apiKey, "utf8"),
		cipher.final(),
	]);
	return [iv, cipher.getAuthTag(), encrypted]
		.map((part) => part.toString("base64url"))
		.join(".");
}

export function decryptAnalysisApiKey(args: {
	encryptedApiKey: string;
	workspaceId: string;
	secret: string;
}): string {
	const [ivRaw, tagRaw, bodyRaw] = args.encryptedApiKey.split(".");
	if (!ivRaw || !tagRaw || !bodyRaw) {
		throw new ValidationError("The saved model credential is corrupted");
	}
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			deriveEncryptionKey(args.secret),
			Buffer.from(ivRaw, "base64url"),
		);
		decipher.setAAD(Buffer.from(`${API_KEY_AAD_PREFIX}${args.workspaceId}`));
		decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
		return Buffer.concat([
			decipher.update(Buffer.from(bodyRaw, "base64url")),
			decipher.final(),
		]).toString("utf8");
	} catch (error) {
		throw new ValidationError(
			"The saved model credential could not be decrypted",
			undefined,
			error,
		);
	}
}
