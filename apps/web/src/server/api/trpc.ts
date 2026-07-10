import "server-only";

import { db } from "@answerloom/db";
import { BaseError } from "@answerloom/errors";
import { auth } from "@lib/auth/auth";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

export const createTRPCContext = async (opts: { headers: Headers }) => {
	const session = await auth.api.getSession({ headers: opts.headers });

	return {
		db,
		auth,
		session,
		...opts,
	};
};

export const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		const domainError = error.cause instanceof BaseError ? error.cause : null;
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? error.cause.flatten() : null,
				domainCode: domainError?.code ?? null,
				meta: domainError?.meta ?? null,
				isOperational: domainError?.isOperational ?? null,
			},
		};
	},
});

export const createTRPCRouter = t.router;
