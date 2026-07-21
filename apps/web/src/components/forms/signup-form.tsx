"use client";
import {
	AuthFormChrome,
	formFieldClassName,
	formLabelClassName,
	formPrimaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { PasswordField } from "@/components/forms/password-field";
import { authClient } from "@/lib/auth/auth-client";
import {
	getPostAuthProvidersPath,
	getSafeAuthRedirectPath,
} from "@/lib/auth/redirect";
import {
	Button,
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
	Input,
	toast,
	useForm,
} from "@anspectra/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

const formSchema = z.object({
	username: z.string().min(3),
	email: z.string().email(),
	password: z.string().min(8),
});

export function SignupForm({
	className,
	showGoogle = false,
	...props
}: React.ComponentProps<"div"> & { showGoogle?: boolean }) {
	const searchParams = useSearchParams();
	const [isLoading, setIsLoading] = useState(false);
	const rawNext = searchParams?.get("next");
	const redirectPath = getSafeAuthRedirectPath(rawNext);
	const postAuthRedirectPath = getPostAuthProvidersPath(rawNext);
	const loginHref =
		redirectPath === "/"
			? "/login"
			: `/login?next=${encodeURIComponent(redirectPath)}`;

	const signInWithGoogle = async () => {
		await authClient.signIn.social({
			provider: "google",
			callbackURL: postAuthRedirectPath,
		});
	};

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			username: "",
			email: "",
			password: "",
		},
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);

		const { error } = await authClient.signUp.email({
			email: values.email,
			password: values.password,
			name: values.username,
		});

		if (error) {
			const message = error.message?.toLowerCase().includes("already exists")
				? "An account with this email already exists. Please sign in instead."
				: (error.message ?? "Failed to sign up.");
			toast.error(message);
			setIsLoading(false);
			return;
		}

		window.location.href = postAuthRedirectPath;
	}

	return (
		<AuthFormChrome
			googleLabel="Continue with Google"
			switchText="Already have an account?"
			switchLabel="Log in"
			switchHref={loginHref}
			onGoogleClick={showGoogle ? signInWithGoogle : undefined}
			className={className}
			{...props}
		>
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
					<div className="grid gap-4">
						<div className="grid gap-2.5">
							<FormField
								control={form.control}
								name="username"
								render={({ field }) => (
									<FormItem>
										<FormLabel className={formLabelClassName}>
											Full name
										</FormLabel>
										<FormControl>
											<Input
												autoComplete="name"
												placeholder="Ava Patel"
												className={formFieldClassName}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<div className="grid gap-2.5">
							<FormField
								control={form.control}
								name="email"
								render={({ field }) => (
									<FormItem>
										<FormLabel className={formLabelClassName}>Email</FormLabel>
										<FormControl>
											<Input
												type="email"
												autoComplete="email"
												placeholder="name@company.com"
												className={formFieldClassName}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<PasswordField
							control={form.control}
							name="password"
							autoComplete="new-password"
						/>
						<Button
							type="submit"
							className={formPrimaryButtonClassName}
							disabled={isLoading}
						>
							{isLoading ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								"Create account"
							)}
						</Button>
					</div>
				</form>
			</Form>
		</AuthFormChrome>
	);
}
