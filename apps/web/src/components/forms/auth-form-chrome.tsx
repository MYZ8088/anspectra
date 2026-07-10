"use client";

import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@answerloom/ui";
import { cn } from "@answerloom/utils";
import Link from "next/link";
import type { ReactNode } from "react";
import { FcGoogle } from "react-icons/fc";

type AuthFormChromeProps = React.ComponentProps<"div"> & {
	title?: string;
	description?: string;
	googleLabel?: string;
	switchText: string;
	switchLabel: string;
	switchHref: string;
	onGoogleClick?: () => void | Promise<void>;
	children: ReactNode;
};

export const formSurfaceClassName =
	"min-w-0 overflow-hidden rounded-[var(--app-radius)] border border-transparent bg-white py-0 shadow-[0_12px_34px_-24px_rgba(0,0,0,0.22)] dark:border-transparent dark:bg-neutral-950 dark:shadow-[0_14px_36px_-24px_rgba(0,0,0,0.58)]";

export const formPanelClassName =
	"rounded-[var(--app-radius)] border border-transparent bg-white shadow-[0_12px_34px_-24px_rgba(0,0,0,0.18)] dark:border-transparent dark:bg-neutral-950 dark:shadow-[0_14px_36px_-24px_rgba(0,0,0,0.5)]";

export const formFieldClassName =
	"h-8 rounded-[var(--app-radius)] border border-gray-200/40 bg-white px-3 text-[11px] text-gray-900 placeholder:text-[10px] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_16px_-14px_rgba(15,23,42,0.1)] placeholder:text-gray-400 dark:border-white/5 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_10px_22px_-16px_rgba(0,0,0,0.36)] sm:h-8.5 sm:px-3 sm:text-[12px] sm:placeholder:text-[11px] lg:h-9 lg:px-3.5 lg:text-[13px] lg:placeholder:text-[12px] xl:h-10 xl:px-4 xl:text-[14px] xl:placeholder:text-[13px]";

export const formTextareaClassName =
	"min-h-[6.25rem] rounded-[var(--app-radius)] border border-gray-200/40 bg-white px-3 py-2.5 text-[11px] text-gray-900 placeholder:text-[10px] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_16px_-14px_rgba(15,23,42,0.1)] placeholder:text-gray-400 dark:border-white/5 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_10px_22px_-16px_rgba(0,0,0,0.36)] sm:min-h-[7rem] sm:px-3 sm:py-2.5 sm:text-[12px] sm:placeholder:text-[11px] lg:min-h-[7.5rem] lg:px-3.5 lg:py-3 lg:text-[13px] lg:placeholder:text-[12px] xl:min-h-[8.5rem] xl:px-4 xl:py-3.5 xl:text-[14px] xl:placeholder:text-[13px]";

export const formLabelClassName =
	"text-[9px] font-semibold uppercase tracking-[0.12em] text-gray-700 dark:text-gray-300 sm:text-[10px]";

export const formPrimaryButtonClassName =
	"h-8 w-full rounded-[var(--app-radius)] bg-gray-950 px-3 text-[11px] text-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_10px_22px_-14px_rgba(15,23,42,0.22)] hover:bg-gray-800 hover:text-white hover:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_18px_34px_-16px_rgba(15,23,42,0.34)] dark:bg-white dark:text-gray-950 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_12px_26px_-16px_rgba(0,0,0,0.4)] dark:hover:bg-gray-200 dark:hover:text-gray-950 dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.16),0_18px_34px_-16px_rgba(0,0,0,0.5)] sm:h-8.5 sm:px-3 sm:text-[12px] lg:h-9 lg:px-3.5 lg:text-[13px] xl:h-10 xl:px-4 xl:text-[14px]";

export const formSecondaryButtonClassName =
	"h-8 rounded-[var(--app-radius)] border border-transparent bg-white px-3 text-[11px] text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_18px_-14px_rgba(15,23,42,0.12)] hover:bg-stone-100 hover:text-gray-950 hover:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_16px_30px_-16px_rgba(15,23,42,0.22)] dark:border-transparent dark:bg-gray-950 dark:text-gray-200 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_10px_24px_-16px_rgba(0,0,0,0.4)] dark:hover:bg-gray-900 dark:hover:text-gray-100 dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.18),0_16px_30px_-16px_rgba(0,0,0,0.5)] sm:h-8.5 sm:px-3 sm:text-[12px] lg:h-9 lg:px-3.5 lg:text-[13px] xl:h-10 xl:px-4 xl:text-[14px]";

export const formToolbarButtonClassName =
	"inline-flex h-8 justify-center rounded-[var(--app-radius)] border border-transparent bg-white px-3 text-[13px] text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_18px_-14px_rgba(15,23,42,0.12)] hover:bg-stone-100 hover:text-gray-950 hover:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_16px_30px_-16px_rgba(15,23,42,0.22)] dark:border-transparent dark:bg-gray-950 dark:text-gray-200 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_10px_24px_-16px_rgba(0,0,0,0.4)] dark:hover:bg-gray-900 dark:hover:text-gray-100 dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.18),0_16px_30px_-16px_rgba(0,0,0,0.5)] sm:h-9 sm:px-3.5 sm:text-sm xl:h-10 xl:px-4 xl:text-[15px]";

export const formToolbarGhostButtonClassName =
	"inline-flex h-8 justify-center rounded-[var(--app-radius)] border border-transparent bg-white px-3 text-[13px] text-gray-500 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_16px_-14px_rgba(15,23,42,0.1)] hover:bg-stone-100 hover:text-gray-950 hover:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_14px_26px_-16px_rgba(15,23,42,0.18)] dark:border-transparent dark:bg-gray-950 dark:text-gray-400 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_10px_22px_-16px_rgba(0,0,0,0.36)] dark:hover:bg-neutral-900 dark:hover:text-gray-100 dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.18),0_16px_28px_-16px_rgba(0,0,0,0.44)] sm:h-9 sm:px-3.5 sm:text-sm xl:h-10 xl:px-4 xl:text-[15px]";

export const formToolbarSelectClassName =
	"h-8 rounded-[var(--app-radius)] border border-transparent bg-white px-3 text-[13px] text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_18px_-14px_rgba(15,23,42,0.12)] hover:bg-gray-50 hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_10px_22px_-14px_rgba(15,23,42,0.16)] dark:border-transparent dark:bg-gray-950 dark:text-gray-200 dark:shadow-[0_1px_2px_rgba(0,0,0,0.14),0_10px_24px_-16px_rgba(0,0,0,0.4)] dark:hover:bg-gray-900 sm:h-9 sm:px-3.5 sm:text-sm xl:h-10 xl:px-4 xl:text-[15px]";

export const formHintClassName =
	"text-[8px] leading-3.5 text-gray-400 dark:text-gray-500 sm:text-[9px] sm:leading-4 lg:text-[10px] lg:leading-4.5 xl:text-[11px] xl:leading-5";

export const formDialogContentClassName =
	"min-w-0 w-full max-w-[min(100vw-1rem,32rem)] overflow-hidden rounded-[var(--app-radius)] border border-transparent bg-white p-0 shadow-[0_12px_34px_-24px_rgba(0,0,0,0.22)] dark:border-transparent dark:bg-neutral-950 dark:shadow-[0_14px_36px_-24px_rgba(0,0,0,0.58)]";

export const formDialogHeaderClassName =
	"space-y-0.75 px-4 pt-3.5 pb-0 text-left sm:px-4.5 sm:pt-4 lg:space-y-1 lg:px-5 lg:pt-4.5";

export const formDialogBodyClassName =
	"grid gap-2 px-4 py-3.25 sm:gap-2.25 sm:px-4.5 sm:py-3.75 lg:gap-2.5 lg:px-5 lg:py-4.25";

export const formDialogFieldGroupClassName = "grid gap-2.5";

export const formDialogSupportCardClassName =
	"rounded-[var(--app-radius)] bg-stone-50/90 px-4 py-3 text-left shadow-[0_14px_30px_-28px_rgba(15,23,42,0.18)] dark:bg-neutral-900/80 dark:shadow-[0_14px_30px_-28px_rgba(0,0,0,0.4)]";

export const formDialogStickyTopClassName =
	"sticky top-0 z-10 border-b border-gray-100/80 bg-white/95 px-4 pt-4 pb-3.5 backdrop-blur-sm shadow-[0_10px_24px_-20px_rgba(0,0,0,0.14)] sm:px-5 sm:pt-5 sm:pb-4 dark:border-gray-800/80 dark:bg-neutral-950/95 dark:shadow-[0_12px_28px_-20px_rgba(0,0,0,0.38)]";

export const formDialogScrollBodyClassName =
	"flex-1 space-y-3 overflow-y-auto px-4 pt-3.5 pb-2 sm:space-y-3.5 sm:px-5 sm:pt-4";

export const formDialogFooterClassName =
	"flex-col-reverse gap-2.5 border-t border-gray-100 px-4 py-3.5 sm:flex-row sm:justify-end sm:px-5 sm:py-4 dark:border-gray-900";

export const formSectionTitleClassName =
	"text-[12px] font-medium tracking-[-0.025em] text-gray-950 dark:text-gray-50 sm:text-[14px] lg:text-[15px] xl:text-[17px]";

export const formSectionDescriptionClassName =
	"text-sm leading-6 text-gray-500 dark:text-gray-400";

export const formResponsePreviewCardClassName =
	"rounded-[var(--app-radius)] border border-transparent bg-white px-5 py-5 shadow-[0_12px_34px_-24px_rgba(0,0,0,0.16)] transition-[box-shadow,background-color] duration-200 ease-out hover:shadow-[0_14px_36px_-24px_rgba(0,0,0,0.18)] dark:border-transparent dark:bg-neutral-950 dark:shadow-[0_14px_36px_-24px_rgba(0,0,0,0.46)] sm:px-6 sm:py-6";

export const formResponseMetricsPanelClassName =
	"rounded-[var(--app-radius)] bg-transparent px-1 py-1";

export const formSubtleActionClassName =
	"inline-flex items-center rounded-[var(--app-radius)] px-0 py-0 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100";

export function AuthFormChrome({
	title,
	description,
	googleLabel,
	switchText,
	switchLabel,
	switchHref,
	onGoogleClick,
	children,
	className,
	...props
}: AuthFormChromeProps): React.JSX.Element {
	return (
		<div className={cn("flex flex-col gap-4", className)} {...props}>
			<Card className={formSurfaceClassName}>
				{title || description ? (
					<CardHeader className="space-y-0.75 px-4 pt-3.5 pb-0 text-left sm:px-4.5 sm:pt-4 lg:space-y-1 lg:px-5 lg:pt-4.5 xl:px-6 xl:pt-5">
						<div className="space-y-0.75 sm:space-y-1 lg:space-y-1.25 xl:space-y-1.5">
							{title ? (
								<CardTitle className="text-[1rem] tracking-[-0.04em] sm:text-[1.14rem] lg:text-[1.28rem] xl:text-[1.5rem]">
									{title}
								</CardTitle>
							) : null}
							{description ? (
								<CardDescription className="max-w-sm text-[10px] leading-4 sm:text-[11px] sm:leading-4.5 lg:text-[12px] lg:leading-5 xl:max-w-md xl:text-[13px] xl:leading-5.5">
									{description}
								</CardDescription>
							) : null}
						</div>
					</CardHeader>
				) : null}
				<CardContent className="px-4 py-3.25 sm:px-4.5 sm:py-3.75 lg:px-5 lg:py-4.25 xl:px-6 xl:py-5">
					<div className="grid min-w-0 gap-2 sm:gap-2.25 lg:gap-2.5 xl:gap-3">
						{onGoogleClick ? (
							<>
								<Button
									variant="outline"
									className={cn(
										formSecondaryButtonClassName,
										"w-full justify-center text-sm font-medium xl:text-[15px]",
									)}
									type="button"
									onClick={onGoogleClick}
								>
									<FcGoogle className="h-4 w-4" />
									{googleLabel}
								</Button>
								<div className="relative py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-border after:border-t xl:py-2 xl:text-[11px]">
									<span className="relative z-10 bg-white px-3 dark:bg-neutral-950">
										Or continue with
									</span>
								</div>
							</>
						) : null}
						{children}
						<div className="text-center text-[10px] text-muted-foreground sm:text-[11px] lg:text-[12px] xl:text-[13px]">
							{switchText}{" "}
							<Link
								href={switchHref}
								className="font-medium text-foreground underline-offset-4 hover:underline"
							>
								{switchLabel}
							</Link>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
