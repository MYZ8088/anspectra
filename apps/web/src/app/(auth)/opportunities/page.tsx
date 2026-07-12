import { redirect } from "next/navigation";

export default async function RetiredOpportunitiesPage({
	searchParams,
}: {
	searchParams: Promise<{ workspace?: string }>;
}) {
	const { workspace } = await searchParams;
	redirect(
		`/dashboard${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`,
	);
}
