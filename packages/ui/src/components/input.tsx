import type * as React from "react";

import { cn } from "@answerloom/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"file:text-foreground placeholder:text-gray-400 selection:bg-primary selection:text-primary-foreground h-8 w-full min-w-0 rounded-[var(--app-radius)] border border-gray-200/40 bg-white px-3 py-2 text-[13px] text-gray-900 shadow-[0_16px_38px_-30px_rgba(15,23,42,0.24)] transition-[color,box-shadow,border-color,background-color] duration-200 ease-out outline-none hover:bg-stone-50/80 hover:border-gray-300/50 hover:shadow-[0_18px_42px_-30px_rgba(15,23,42,0.28)] file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[13px] file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/5 dark:bg-neutral-950 dark:text-gray-100 dark:placeholder:text-gray-500 dark:shadow-[0_16px_38px_-30px_rgba(0,0,0,0.5)] dark:hover:bg-neutral-900 dark:hover:border-white/8 dark:hover:shadow-[0_18px_42px_-30px_rgba(0,0,0,0.54)] sm:h-9 sm:px-3.5 sm:text-sm",
				"[&:-webkit-autofill]:[-webkit-text-fill-color:theme(colors.gray.900)] [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_white] [&:-webkit-autofill:hover]:shadow-[inset_0_0_0px_1000px_rgb(250_250_249)] [&:-webkit-autofill:focus]:shadow-[inset_0_0_0px_1000px_white] dark:[&:-webkit-autofill]:[-webkit-text-fill-color:theme(colors.gray.100)] dark:[&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_theme(colors.neutral.950)] dark:[&:-webkit-autofill:hover]:shadow-[inset_0_0_0px_1000px_theme(colors.neutral.900)] dark:[&:-webkit-autofill:focus]:shadow-[inset_0_0_0px_1000px_theme(colors.neutral.950)]",
				"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
