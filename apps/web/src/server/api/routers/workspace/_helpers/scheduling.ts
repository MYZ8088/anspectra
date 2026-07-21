import { ValidationError } from "@anspectra/errors";
import { CronExpressionParser } from "cron-parser";

export function parseCronExpressionOrThrow(cronExpression: string) {
	try {
		return CronExpressionParser.parse(cronExpression, {
			currentDate: new Date(),
		});
	} catch (err) {
		throw new ValidationError("Invalid cron expression", {
			cronExpression,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
