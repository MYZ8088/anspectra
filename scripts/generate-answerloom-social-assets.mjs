import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = path.join(
	repoRoot,
	".answerloom-storage/debug/branding/monitor-1100.png",
);
const logoPath = path.join(
	repoRoot,
	"assets/brand/answerloom-lockup-dark.svg",
);
const svgPath = path.join(repoRoot, "assets/brand/answerloom-social.svg");
const targets = [
	"apps/web/src/app/opengraph-image.png",
	"apps/web/src/app/twitter-image.png",
	"apps/landing/src/app/opengraph-image.png",
	"apps/landing/src/app/twitter-image.png",
];

const [screenshot, logo] = await Promise.all([
	readFile(screenshotPath),
	readFile(logoPath),
]);
const screenshotUri = `data:image/jpeg;base64,${screenshot.toString("base64")}`;
const logoUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="screen"><rect x="472" y="70" width="708" height="490" rx="8"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#111827"/>
  <rect x="455" width="745" height="630" fill="#F8FAFC"/>
  <rect x="0" y="0" width="10" height="315" fill="#0F9D8A"/>
  <rect x="0" y="315" width="10" height="315" fill="#F05D5E"/>
  <image href="${logoUri}" x="34" y="36" width="382" height="80"/>
  <text x="42" y="214" fill="#F9FAFB" font-family="Arial, sans-serif" font-size="55" font-weight="700" letter-spacing="0">
    <tspan x="42" dy="0">Measure what</tspan>
    <tspan x="42" dy="64">AI answers.</tspan>
  </text>
  <text x="43" y="363" fill="#CBD5E1" font-family="Arial, sans-serif" font-size="23" letter-spacing="0">
    <tspan x="43" dy="0">Official Web monitoring</tspan>
    <tspan x="43" dy="38">Evidence-led optimization</tspan>
    <tspan x="43" dy="38">Paired retesting</tspan>
  </text>
  <circle cx="50" cy="519" r="7" fill="#0F9D8A"/>
  <circle cx="75" cy="519" r="7" fill="#F05D5E"/>
  <text x="43" y="565" fill="#94A3B8" font-family="Arial, sans-serif" font-size="17" letter-spacing="0">GEO workflow for teams that need traceable evidence</text>
  <rect x="471" y="69" width="710" height="492" rx="8" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2"/>
  <g clip-path="url(#screen)">
    <image href="${screenshotUri}" x="472" y="70" width="708" height="490" preserveAspectRatio="xMidYMin meet"/>
  </g>
</svg>`;

await writeFile(svgPath, svg, "utf8");
for (const target of targets) {
	execFileSync("rsvg-convert", [
		"--width",
		"1200",
		"--height",
		"630",
		"--output",
		path.join(repoRoot, target),
		svgPath,
	]);
}
console.log(`Generated ${targets.length} AnswerLoom social images.`);
