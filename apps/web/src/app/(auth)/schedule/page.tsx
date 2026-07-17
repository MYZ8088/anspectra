import { redirect } from "next/navigation";

export default async function SchedulePage({
	searchParams,
}: {
	searchParams?: Promise<{ workspace?: string }>;
}) {
	const params = await searchParams;
	const workspace = params?.workspace
		? `?workspace=${encodeURIComponent(params.workspace)}`
		: "";
	redirect(`/monitor${workspace}`);
}
