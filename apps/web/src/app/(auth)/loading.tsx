import { Skeleton } from "@anspectra/ui";

const CARD_SKELETON_KEYS = [
	"card-skeleton-1",
	"card-skeleton-2",
	"card-skeleton-3",
	"card-skeleton-4",
	"card-skeleton-5",
	"card-skeleton-6",
] as const;

export default function Loading() {
	return (
		<div className="space-y-6 p-6">
			<div className="flex items-center justify-between">
				<Skeleton className="h-6 w-32" />
				<Skeleton className="h-8 w-20" />
			</div>
			<div className="space-y-3">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{CARD_SKELETON_KEYS.map((key) => (
					<Skeleton
						key={key}
						className="h-40 w-full rounded-[var(--app-radius)]"
					/>
				))}
			</div>
		</div>
	);
}
