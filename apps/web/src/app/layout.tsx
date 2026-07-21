import "../styles/globals.css";
import { appIcons } from "@/lib/app-metadata";
import { TRPCReactProvider } from "@/trpc/react";
import { Toaster } from "@anspectra/ui";
import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist } from "next/font/google";

export const metadata: Metadata = {
	metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
	title: "Anspectra",
	description:
		"Measure product visibility across Doubao, DeepSeek, Yuanbao, and Qwen through their official Web interfaces.",
	robots: {
		index: false,
		follow: false,
	},
	icons: appIcons,
	openGraph: {
		title: "Anspectra",
		description:
			"Measure product visibility across Doubao, DeepSeek, Yuanbao, and Qwen through their official Web interfaces.",
		type: "website",
		images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
	},
	twitter: {
		card: "summary_large_image",
		title: "Anspectra",
		description:
			"Measure product visibility across Doubao, DeepSeek, Yuanbao, and Qwen through their official Web interfaces.",
		images: ["/twitter-image"],
	},
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export default async function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
	return (
		<html lang="en" className={`${geist.variable}`} suppressHydrationWarning>
			<body>
				<ThemeProvider attribute="class" defaultTheme="light" enableSystem>
					<TRPCReactProvider>
						{children}
						<Toaster />
					</TRPCReactProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
