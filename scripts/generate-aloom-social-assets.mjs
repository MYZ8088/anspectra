import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = path.join(
	repoRoot,
	"assets/brand/aloom-lockup-dark.svg",
);
const svgPath = path.join(repoRoot, "assets/brand/aloom-social.svg");
const targets = [
	"apps/web/src/app/opengraph-image.png",
	"apps/web/src/app/twitter-image.png",
	"apps/landing/src/app/opengraph-image.png",
	"apps/landing/src/app/twitter-image.png",
];

const logo = await readFile(logoPath);
const logoUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F7F8FA"/>
  <rect width="430" height="630" fill="#17191F"/>
  <rect x="0" width="8" height="630" fill="#0AAED6"/>
  <image href="${logoUri}" x="34" y="36" width="350" height="80"/>
  <text x="42" y="214" fill="#F7F8FA" font-family="Arial, sans-serif" font-size="55" font-weight="700" letter-spacing="0">
    <tspan x="42" dy="0">Measure what</tspan>
    <tspan x="42" dy="64">AI answers.</tspan>
  </text>
  <text x="43" y="363" fill="#C9CED8" font-family="Arial, sans-serif" font-size="23" letter-spacing="0">
	    <tspan x="43" dy="0">Official Web detection</tspan>
	    <tspan x="43" dy="38">Fixed prompt suites</tspan>
	    <tspan x="43" dy="38">Comparable monitoring</tspan>
  </text>
	  <text x="43" y="565" fill="#8F98A8" font-family="Arial, sans-serif" font-size="17" letter-spacing="0">Doubao / DeepSeek / Yuanbao / Qwen</text>
  <g transform="translate(470 55)" font-family="Arial, sans-serif" letter-spacing="0">
    <text x="0" y="28" fill="#17191F" font-size="25" font-weight="700">Detection report</text>
    <text x="0" y="57" fill="#697180" font-size="15">Full Matrix / Quick / 4 providers</text>
    <rect x="0" y="81" width="680" height="112" rx="6" fill="#FFFFFF" stroke="#D8DCE3"/>
    <text x="22" y="111" fill="#697180" font-size="13">ALOOM GEO SCORE V1</text>
    <text x="22" y="157" fill="#17191F" font-size="35" font-weight="700">72.4 / 100</text>
    <rect x="175" y="133" width="472" height="12" rx="6" fill="#E5E8ED"/>
    <rect x="175" y="133" width="402" height="12" rx="6" fill="#0AAED6"/>
    <text x="175" y="168" fill="#697180" font-size="13">85% scoring coverage / 204 of 216 collected</text>

    <text x="0" y="235" fill="#17191F" font-size="17" font-weight="700">Provider scorecards</text>
    <g transform="translate(0 254)">
      <rect width="680" height="142" rx="6" fill="#FFFFFF" stroke="#D8DCE3"/>
      <g fill="#555E6D" font-size="14">
        <text x="20" y="31">Doubao</text><text x="20" y="61">DeepSeek</text>
        <text x="20" y="91">Yuanbao</text><text x="20" y="121">Qwen</text>
      </g>
      <g fill="#E5E8ED">
        <rect x="125" y="19" width="415" height="10" rx="5"/>
        <rect x="125" y="49" width="415" height="10" rx="5"/>
        <rect x="125" y="79" width="415" height="10" rx="5"/>
        <rect x="125" y="109" width="415" height="10" rx="5"/>
      </g>
      <g fill="#0AAED6">
        <rect x="125" y="19" width="372" height="10" rx="5"/>
        <rect x="125" y="49" width="387" height="10" rx="5"/>
        <rect x="125" y="79" width="348" height="10" rx="5"/>
        <rect x="125" y="109" width="395" height="10" rx="5"/>
      </g>
      <g fill="#17191F" font-size="13" font-weight="700" text-anchor="end">
        <text x="655" y="29">74.0</text><text x="655" y="59">78.2</text>
        <text x="655" y="89">65.7</text><text x="655" y="119">71.8</text>
      </g>
    </g>

    <text x="0" y="437" fill="#17191F" font-size="17" font-weight="700">Intent x decision stage</text>
    <g transform="translate(0 455)">
      <g fill="#DDF5FA">
        <rect x="0" y="0" width="92" height="35" rx="4"/><rect x="100" y="0" width="92" height="35" rx="4"/>
        <rect x="300" y="0" width="92" height="35" rx="4"/><rect x="500" y="0" width="92" height="35" rx="4"/>
        <rect x="100" y="43" width="92" height="35" rx="4"/><rect x="200" y="43" width="92" height="35" rx="4"/>
        <rect x="400" y="43" width="92" height="35" rx="4"/><rect x="500" y="43" width="92" height="35" rx="4"/>
      </g>
      <g fill="#0AAED6">
        <rect x="200" y="0" width="92" height="35" rx="4"/><rect x="400" y="0" width="92" height="35" rx="4"/>
        <rect x="0" y="43" width="92" height="35" rx="4"/><rect x="300" y="43" width="92" height="35" rx="4"/>
      </g>
      <rect x="600" y="0" width="60" height="78" rx="4" fill="#17191F"/>
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
console.log(`Generated ${targets.length} Aloom social images.`);
