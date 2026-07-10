import type * as React from "react";

import { cn } from "@answerloom/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"placeholder:text-gray-400 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex field-sizing-content min-h-14 w-full rounded-[var(--app-radius)] border border-gray-200/40 bg-white px-4 py-3 text-sm text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_16px_-14px_rgba(15,23,42,0.1)] transition-[color,box-shadow,border-color,background-color] duration-200 ease-out outline-none hover:bg-stone-50/80 hover:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_12px_24px_-16px_rgba(15,23,42,0.16)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/5 dark:bg-neutral-950 dark:text-gray-100 dark:placeholder:text-gray-500 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_10px_22px_-16px_rgba(0,0,0,0.36)] dark:hover:bg-neutral-900 dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.18),0_14px_26px_-16px_rgba(0,0,0,0.44)] sm:min-h-16 sm:px-4.5 sm:py-3.5 md:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
