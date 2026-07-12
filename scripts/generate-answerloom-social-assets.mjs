import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const logo = await readFile(logoPath);
const logoUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
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
	    <tspan x="43" dy="0">Official Web detection</tspan>
	    <tspan x="43" dy="38">Fixed prompt suites</tspan>
	    <tspan x="43" dy="38">Comparable monitoring</tspan>
  </text>
  <circle cx="50" cy="519" r="7" fill="#0F9D8A"/>
  <circle cx="75" cy="519" r="7" fill="#F05D5E"/>
	  <text x="43" y="565" fill="#94A3B8" font-family="Arial, sans-serif" font-size="17" letter-spacing="0">Doubao / DeepSeek / Yuanbao / Qwen</text>
  <g transform="translate(490 55)" font-family="Arial, sans-serif" letter-spacing="0">
    <text x="0" y="28" fill="#111827" font-size="25" font-weight="700">Detection report</text>
    <text x="0" y="57" fill="#64748B" font-size="15">Full Matrix / Single / 4 providers</text>
    <rect x="0" y="81" width="660" height="112" rx="8" fill="#FFFFFF" stroke="#CBD5E1"/>
    <text x="22" y="111" fill="#64748B" font-size="13">COLLECTION COMPLETION</text>
    <text x="22" y="157" fill="#111827" font-size="35" font-weight="700">94.4%</text>
    <rect x="175" y="133" width="452" height="12" rx="6" fill="#E2E8F0"/>
    <rect x="175" y="133" width="427" height="12" rx="6" fill="#0F9D8A"/>
    <text x="175" y="168" fill="#64748B" font-size="13">204 collected / 216 planned</text>

    <text x="0" y="235" fill="#111827" font-size="17" font-weight="700">Provider coverage</text>
    <g transform="translate(0 254)">
      <rect width="660" height="142" rx="8" fill="#FFFFFF" stroke="#CBD5E1"/>
      <g fill="#475569" font-size="14">
        <text x="20" y="31">Doubao</text><text x="20" y="61">DeepSeek</text>
        <text x="20" y="91">Yuanbao</text><text x="20" y="121">Qwen</text>
      </g>
      <g fill="#E2E8F0">
        <rect x="125" y="19" width="395" height="10" rx="5"/>
        <rect x="125" y="49" width="395" height="10" rx="5"/>
        <rect x="125" y="79" width="395" height="10" rx="5"/>
        <rect x="125" y="109" width="395" height="10" rx="5"/>
      </g>
      <g fill="#0F9D8A">
        <rect x="125" y="19" width="372" height="10" rx="5"/>
        <rect x="125" y="49" width="387" height="10" rx="5"/>
        <rect x="125" y="79" width="348" height="10" rx="5"/>
        <rect x="125" y="109" width="395" height="10" rx="5"/>
      </g>
      <g fill="#111827" font-size="13" font-weight="700" text-anchor="end">
        <text x="635" y="29">94%</text><text x="635" y="59">98%</text>
        <text x="635" y="89">88%</text><text x="635" y="119">100%</text>
      </g>
    </g>

    <text x="0" y="437" fill="#111827" font-size="17" font-weight="700">Intent x decision stage</text>
    <g transform="translate(0 455)">
      <g fill="#D5F0EA">
        <rect x="0" y="0" width="92" height="35" rx="4"/><rect x="100" y="0" width="92" height="35" rx="4"/>
        <rect x="300" y="0" width="92" height="35" rx="4"/><rect x="500" y="0" width="92" height="35" rx="4"/>
        <rect x="100" y="43" width="92" height="35" rx="4"/><rect x="200" y="43" width="92" height="35" rx="4"/>
        <rect x="400" y="43" width="92" height="35" rx="4"/><rect x="500" y="43" width="92" height="35" rx="4"/>
      </g>
      <g fill="#0F9D8A">
        <rect x="200" y="0" width="92" height="35" rx="4"/><rect x="400" y="0" width="92" height="35" rx="4"/>
        <rect x="0" y="43" width="92" height="35" rx="4"/><rect x="300" y="43" width="92" height="35" rx="4"/>
      </g>
      <rect x="600" y="0" width="60" height="78" rx="4" fill="#F05D5E"/>
    </g>
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
