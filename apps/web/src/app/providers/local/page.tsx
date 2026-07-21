import { ProvidersScreen } from "@/components/providers-screen";
import { env } from "@/env";
import { resolveAppMode } from "@anspectra/types";
import { redirect } from "next/navigation";

export default function LocalProvidersPage() {
	if (resolveAppMode(env.NEXT_PUBLIC_ANSPECTRA_APP_MODE) !== "local") {
		redirect("/providers");
	}

	return (
		<ProvidersScreen
			title="Provider Access"
			description="Sign in to any provider below on this machine. Close each provider window after the login finishes. Saved sessions stay local until you choose to upload them."
		/>
	);
}
