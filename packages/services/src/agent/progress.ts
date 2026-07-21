import type { Provider } from "@anspectra/types";
import { redis } from "./redis.js";

const AGENT_PROGRESS_TTL_SECONDS = 24 * 60 * 60;

export type ProviderExecutionStatus =
	| "pending"
	| "running"
	| "cooling_down"
	| "waiting_human"
	| "partial"
	| "completed"
	| "failed"
	| "stopped";

const COMPLETED_TTL_SECONDS = 120;

const UPDATE_PROGRESS_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local data = cjson.decode(raw)
data['providers'][ARGV[1]] = ARGV[2]
if ARGV[3] ~= '' then
  data['results'][ARGV[1]] = tonumber(ARGV[3])
end
data['updateId'] = (data['updateId'] or 0) + 1
local total = 0
for _, v in pairs(data['results']) do total = total + v end
data['stats']['actualResponses'] = total
local allDone = true
for _, v in pairs(data['providers']) do
  if v ~= 'completed' and v ~= 'partial' and v ~= 'failed' and v ~= 'stopped' then allDone = false; break end
end
local ttl = ${AGENT_PROGRESS_TTL_SECONDS}
if allDone then
  data['status'] = 'completed'
  ttl = ${COMPLETED_TTL_SECONDS}
end
redis.call('SET', KEYS[1], cjson.encode(data), 'EX', ttl)
return cjson.encode(data)
`;

export function buildProgressKey(jobGroupId: string): string {
	return `job:${jobGroupId}:result`;
}

export async function updateProviderProgress(args: {
	jobGroupId: string;
	provider: Provider;
	status: ProviderExecutionStatus;
	resultCount?: number | null;
}): Promise<void> {
	const countArg =
		args.resultCount === undefined || args.resultCount === null
			? ""
			: String(args.resultCount);

	await redis.eval(
		UPDATE_PROGRESS_LUA,
		1,
		buildProgressKey(args.jobGroupId),
		args.provider,
		args.status,
		countArg,
	);
}

const RECORD_CHALLENGE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local data = cjson.decode(raw)
data['challenges'] = data['challenges'] or {}
data['challenges'][ARGV[1]] = cjson.decode(ARGV[2])
data['providers'][ARGV[1]] = 'waiting_human'
data['status'] = 'waiting_human'
data['updateId'] = (data['updateId'] or 0) + 1
redis.call('SET', KEYS[1], cjson.encode(data), 'EX', ${AGENT_PROGRESS_TTL_SECONDS})
return cjson.encode(data)
`;

export async function recordProviderChallenge(args: {
	jobGroupId: string;
	provider: Provider;
	challenge: {
		kind: string;
		pageUrl: string;
		message: string;
		createdAt: string;
		expiresAt: string;
	};
}): Promise<void> {
	await redis.eval(
		RECORD_CHALLENGE_LUA,
		1,
		buildProgressKey(args.jobGroupId),
		args.provider,
		JSON.stringify(args.challenge),
	);
}

const CLEAR_CHALLENGE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local data = cjson.decode(raw)
if data['challenges'] then data['challenges'][ARGV[1]] = nil end
data['providers'][ARGV[1]] = 'pending'
data['status'] = 'pending'
data['updateId'] = (data['updateId'] or 0) + 1
redis.call('SET', KEYS[1], cjson.encode(data), 'EX', ${AGENT_PROGRESS_TTL_SECONDS})
return cjson.encode(data)
`;

export async function clearProviderChallenge(args: {
	jobGroupId: string;
	provider: Provider;
}): Promise<void> {
	await redis.eval(
		CLEAR_CHALLENGE_LUA,
		1,
		buildProgressKey(args.jobGroupId),
		args.provider,
	);
}
