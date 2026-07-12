import SchedulePageClient from "./schedule-page-client";

export default async function SchedulePage({
	searchParams,
}: {
	searchParams?: Promise<{ workspace?: string }>;
}) {
	const params = await searchParams;

	return <SchedulePageClient workspaceId={params?.workspace ?? ""} />;
}
