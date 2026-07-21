import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const source = path.join(
	repoRoot,
	"assets",
	"brand",
	"anspectra-mark-source.png",
);
const expectedSha256 =
	"3fb03694cf05b9686f87ff8a045f1d680049e20b7325e4c394dcbe96a70ab509";

const sourceBuffer = await readFile(source);
const actualSha256 = createHash("sha256").update(sourceBuffer).digest("hex");
if (actualSha256 !== expectedSha256) {
	throw new Error(
		`Anspectra master artwork checksum mismatch: ${actualSha256}`,
	);
}

async function createTransparentMark() {
	const { data, info } = await sharp(sourceBuffer)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const rgba = Buffer.alloc(info.width * info.height * 4);

	for (
		let sourceOffset = 0, targetOffset = 0;
		sourceOffset < data.length;
		sourceOffset += 3, targetOffset += 4
	) {
		const red = data[sourceOffset];
		const green = data[sourceOffset + 1];
		const blue = data[sourceOffset + 2];
		const alpha = 255 - Math.min(red, green, blue);

		if (alpha <= 5) {
			rgba[targetOffset] = 0;
			rgba[targetOffset + 1] = 0;
			rgba[targetOffset + 2] = 0;
			rgba[targetOffset + 3] = 0;
			continue;
		}

		const whiteContribution = 255 - alpha;
		rgba[targetOffset] = Math.max(
			0,
			Math.min(255, Math.round(((red - whiteContribution) * 255) / alpha)),
		);
		rgba[targetOffset + 1] = Math.max(
			0,
			Math.min(255, Math.round(((green - whiteContribution) * 255) / alpha)),
		);
		rgba[targetOffset + 2] = Math.max(
			0,
			Math.min(255, Math.round(((blue - whiteContribution) * 255) / alpha)),
		);
		rgba[targetOffset + 3] = alpha;
	}

	return sharp(rgba, {
		raw: { width: info.width, height: info.height, channels: 4 },
	})
		.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 5 })
		.png()
		.toBuffer();
}

const transparentMark = await createTransparentMark();

const targets = [
	["apps/web/public/logo.png", 512],
	["apps/web/public/logo-dark.png", 512],
	["apps/web/src/app/icon.png", 512],
	["apps/web/src/app/apple-icon.png", 180],
	["apps/landing/public/logo.png", 512],
	["apps/landing/public/logo-dark.png", 512],
	["apps/landing/src/app/icon.png", 512],
	["apps/landing/src/app/apple-icon.png", 180],
	["docs/images/anspectra-mark.png", 512],
];

for (const [relativePath, size] of targets) {
	const outputPath = path.join(repoRoot, relativePath);
	await mkdir(path.dirname(outputPath), { recursive: true });
	const inset = Math.max(8, Math.round(size * 0.08));
	await sharp(transparentMark)
		.resize(size - inset * 2, size - inset * 2, { fit: "contain" })
		.extend({
			top: inset,
			bottom: inset,
			left: inset,
			right: inset,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png({ compressionLevel: 9 })
		.toFile(outputPath);
}

console.log(
	`Verified Anspectra artwork ${actualSha256} and generated ${targets.length} deterministic derivatives.`,
);
