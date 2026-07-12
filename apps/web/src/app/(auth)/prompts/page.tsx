import { redirect } from "next/navigation";

export default async function RetiredCustomPromptsPage({
	searchParams,
}: {
	searchParams: Promise<{ workspace?: string }>;
}) {
	const { workspace } = await searchParams;
	redirect(
		`/prompt-library${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`,
	);
}
