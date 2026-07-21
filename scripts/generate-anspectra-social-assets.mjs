import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const markPath = path.join(repoRoot, "docs/images/anspectra-mark.png");
const reportPath = path.join(repoRoot, "docs/images/anspectra-detection.png");
const [markBuffer, reportBuffer] = await Promise.all([
	readFile(markPath),
	readFile(reportPath),
]);
const markDataUri = `data:image/png;base64,${markBuffer.toString("base64")}`;

const socialSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F5F7F9"/>
  <rect width="390" height="630" fill="#131A22"/>
  <rect x="0" width="7" height="630" fill="#08A8D1"/>
  <g font-family="Inter, Arial, sans-serif" letter-spacing="0">
    <rect x="42" y="38" width="70" height="70" rx="6" fill="#FFFFFF"/>
    <image href="${markDataUri}" x="47" y="43" width="60" height="60" preserveAspectRatio="xMidYMid meet"/>
    <text x="128" y="84" fill="#FFFFFF" font-size="31" font-weight="700">Anspectra</text>
    <text x="42" y="224" fill="#FFFFFF" font-size="47" font-weight="700">
      <tspan x="42" dy="0">Measure AI</tspan>
      <tspan x="42" dy="58">Web answers.</tspan>
    </text>
    <text x="42" y="362" fill="#B8C1CB" font-size="20">
      <tspan x="42" dy="0">Fixed prompt suites</tspan>
      <tspan x="42" dy="35">Persistent local browsers</tspan>
      <tspan x="42" dy="35">Comparable provider reports</tspan>
    </text>
    <text x="42" y="565" fill="#72D7EF" font-size="15" font-weight="700">DOUBAO · DEEPSEEK · YUANBAO · QWEN</text>
  </g>
  <g transform="translate(430 54)">
    <rect width="724" height="522" rx="8" fill="#FFFFFF" stroke="#D9DEE4"/>
  </g>
</svg>`;

const baseBuffer = await sharp(Buffer.from(socialSvg)).png().toBuffer();
const reportPanel = await sharp(reportBuffer)
	.resize(722, 520, { fit: "cover", position: "top" })
	.png()
	.toBuffer();
const socialBuffer = await sharp(baseBuffer)
	.composite([{ input: reportPanel, left: 431, top: 55 }])
	.png({ compressionLevel: 9 })
	.toBuffer();

for (const target of [
	"apps/web/src/app/opengraph-image.png",
	"apps/web/src/app/twitter-image.png",
	"apps/landing/src/app/opengraph-image.png",
	"apps/landing/src/app/twitter-image.png",
]) {
	await sharp(socialBuffer).toFile(path.join(repoRoot, target));
}

console.log(
	"Generated Anspectra social images from the verified report screenshot.",
);
