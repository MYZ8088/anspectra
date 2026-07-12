import { cn } from "@aloom/utils";

type BrandLogoProps = {
	alt?: string;
	className?: string;
	darkClassName?: string;
	lightClassName?: string;
};

export function BrandLogo({
	alt = "Aloom",
	className,
	darkClassName,
	lightClassName,
}: BrandLogoProps): React.JSX.Element {
	return (
		<>
			<img
				src="/logo.png"
				alt={alt}
				className={cn("object-contain dark:hidden", className, lightClassName)}
			/>
			<img
				src="/logo-dark.png"
				alt={alt}
				className={cn(
					"hidden object-contain dark:block",
					className,
					darkClassName,
				)}
			/>
		</>
	);
}
