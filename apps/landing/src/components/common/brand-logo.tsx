import { cn } from "@anspectra/utils";

type BrandLogoProps = {
	alt?: string;
	className?: string;
};

export function BrandLogo({
	alt = "Anspectra",
	className,
}: BrandLogoProps): React.JSX.Element {
	return (
		<img
			src="/logo.png"
			alt={alt}
			className={cn("object-contain", className)}
		/>
	);
}
