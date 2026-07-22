import type { Metadata } from "next";

export const appIcons: Metadata["icons"] = {
	icon: [
		{
			url: "/anspectra-mark-v2.png",
			media: "(prefers-color-scheme: light)",
			type: "image/png",
		},
		{
			url: "/anspectra-mark-v2-dark.png",
			media: "(prefers-color-scheme: dark)",
			type: "image/png",
		},
	],
	shortcut: [
		{
			url: "/anspectra-mark-v2.png",
			type: "image/png",
		},
	],
	apple: [
		{
			url: "/anspectra-mark-v2.png",
			type: "image/png",
		},
	],
};
