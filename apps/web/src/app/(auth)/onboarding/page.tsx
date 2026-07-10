"use client";

import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function FirstWorkspaceOnboardingPage() {
	const router = useRouter();
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";

	useEffect(() => {
		if (!workspaceId) return;
		router.replace(`/monitor?workspace=${workspaceId}`);
	}, [router, workspaceId]);

	return (
		<div className="flex min-h-full items-center justify-center text-stone-500">
			<Loader2 className="size-5 animate-spin" />
		</div>
	);
}
