import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/forms/login-form";
import { env } from "@/env";

export default function LoginPage() {
	const showGoogle = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
	return (
		<AuthPageShell subtitle="Measure how your product appears across Doubao, DeepSeek, Yuanbao, and Qwen.">
			<LoginForm showGoogle={showGoogle} />
		</AuthPageShell>
	);
}
