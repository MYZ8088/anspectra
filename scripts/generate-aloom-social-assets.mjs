import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const english = {
	fontFamily: "Inter, Arial, sans-serif",
	headlineSize: 51,
	headline: ["Measure what", "AI answers."],
	benefits: [
		"Official Web detection",
		"Fixed prompt suites",
		"Comparable monitoring",
	],
	providersFooter: "Doubao / DeepSeek / Yuanbao / Qwen",
	reportTitle: "Detection report",
	reportSubtitle: "Full Matrix / Quick Scan / 4 providers",
	scoreLabel: "ALOOM GEO SCORE V1",
	coverage: "85% scoring coverage  ·  204 of 216 samples collected",
	providerTitle: "Provider scorecards",
	providerNames: ["Doubao", "DeepSeek", "Yuanbao", "Qwen"],
	heatmapTitle: "Intent × decision stage",
};

const chinese = {
	fontFamily:
		"PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif",
	headlineSize: 52,
	headline: ["看清 AI", "如何回答。"],
	benefits: ["官方 Web 检测", "固定提示词套件", "可比周期监测"],
	providersFooter: "豆包 / DeepSeek / 元宝 / 千问",
	reportTitle: "GEO 检测报告",
	reportSubtitle: "完整矩阵 / 快速扫描 / 4 个平台",
	scoreLabel: "ALOOM GEO 评分 V1",
	coverage: "85% 评分覆盖率  ·  计划 216 个，已采集 204 个",
	providerTitle: "平台评分卡",
	providerNames: ["豆包", "DeepSeek", "元宝", "千问"],
	heatmapTitle: "意图 × 决策阶段",
};

function renderSocial(copy) {
	const [provider1, provider2, provider3, provider4] = copy.providerNames;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F7F8FA"/>
  <rect width="408" height="630" fill="#17191F"/>
  <rect width="8" height="630" fill="#00AEE6"/>
  <g font-family="${copy.fontFamily}" letter-spacing="0">
    <text x="42" y="208" fill="#F7F8FA" font-size="${copy.headlineSize}" font-weight="700">
      <tspan x="42" dy="0">${copy.headline[0]}</tspan>
      <tspan x="42" dy="64">${copy.headline[1]}</tspan>
    </text>
    <text x="43" y="358" fill="#C9CED8" font-size="22">
      <tspan x="43" dy="0">${copy.benefits[0]}</tspan>
      <tspan x="43" dy="38">${copy.benefits[1]}</tspan>
      <tspan x="43" dy="38">${copy.benefits[2]}</tspan>
    </text>
    <text x="43" y="568" fill="#8F98A8" font-size="16">${copy.providersFooter}</text>
  </g>

  <g transform="translate(448 44)" font-family="${copy.fontFamily}" letter-spacing="0">
    <text x="0" y="28" fill="#17191F" font-size="27" font-weight="700">${copy.reportTitle}</text>
    <text x="0" y="59" fill="#697180" font-size="15">${copy.reportSubtitle}</text>

    <rect x="0" y="84" width="704" height="132" rx="6" fill="#FFFFFF" stroke="#D8DCE3"/>
    <text x="24" y="119" fill="#697180" font-size="13">${copy.scoreLabel}</text>
    <text x="24" y="174" fill="#17191F" font-size="38" font-weight="700">72.4</text>
    <text x="119" y="174" fill="#697180" font-size="16">/ 100</text>
    <rect x="224" y="143" width="432" height="12" rx="6" fill="#E5E8ED"/>
    <rect x="224" y="143" width="367" height="12" rx="6" fill="#00AEE6"/>
    <text x="224" y="181" fill="#697180" font-size="13">${copy.coverage}</text>

    <text x="0" y="258" fill="#17191F" font-size="18" font-weight="700">${copy.providerTitle}</text>
    <g transform="translate(0 276)">
      <rect width="704" height="158" rx="6" fill="#FFFFFF" stroke="#D8DCE3"/>
      <g fill="#555E6D" font-size="14">
        <text x="20" y="35">${provider1}</text>
        <text x="20" y="70">${provider2}</text>
        <text x="20" y="105">${provider3}</text>
        <text x="20" y="140">${provider4}</text>
      </g>
      <g fill="#E5E8ED">
        <rect x="126" y="24" width="430" height="10" rx="5"/>
        <rect x="126" y="59" width="430" height="10" rx="5"/>
        <rect x="126" y="94" width="430" height="10" rx="5"/>
        <rect x="126" y="129" width="430" height="10" rx="5"/>
      </g>
      <g fill="#00AEE6">
        <rect x="126" y="24" width="374" height="10" rx="5"/>
        <rect x="126" y="59" width="391" height="10" rx="5"/>
        <rect x="126" y="94" width="328" height="10" rx="5"/>
        <rect x="126" y="129" width="359" height="10" rx="5"/>
      </g>
      <g fill="#17191F" font-size="13" font-weight="700" text-anchor="end">
        <text x="676" y="34">74.0</text>
        <text x="676" y="69">78.2</text>
        <text x="676" y="104">65.7</text>
        <text x="676" y="139">71.8</text>
      </g>
    </g>

    <text x="0" y="478" fill="#17191F" font-size="18" font-weight="700">${copy.heatmapTitle}</text>
    <g transform="translate(0 496)">
      <g fill="#DDF5FA">
        <rect x="0" y="0" width="94" height="34" rx="4"/><rect x="102" y="0" width="94" height="34" rx="4"/>
        <rect x="306" y="0" width="94" height="34" rx="4"/><rect x="510" y="0" width="94" height="34" rx="4"/>
        <rect x="102" y="42" width="94" height="34" rx="4"/><rect x="204" y="42" width="94" height="34" rx="4"/>
        <rect x="408" y="42" width="94" height="34" rx="4"/><rect x="510" y="42" width="94" height="34" rx="4"/>
      </g>
      <g fill="#00AEE6">
        <rect x="204" y="0" width="94" height="34" rx="4"/><rect x="408" y="0" width="94" height="34" rx="4"/>
        <rect x="0" y="42" width="94" height="34" rx="4"/><rect x="306" y="42" width="94" height="34" rx="4"/>
      </g>
      <rect x="612" y="0" width="68" height="76" rx="4" fill="#17191F"/>
    </g>
  </g>

  <rect x="408" y="0" width="40" height="160" fill="#F7F8FA"/>
  <g transform="translate(32 20)">
    <g transform="scale(.72)">
      <path fill="#F7F8FA" d="M18 104 57 23h20v63h34v18H67V37h-3l-30 67H18Z"/>
      <path fill="#18BCE8" d="m47 91 15-32v32H47Z"/>
    </g>
    <text x="96" y="65" fill="#F7F8FA" font-family="Inter, Arial, sans-serif" font-size="43" font-weight="700" letter-spacing="0">Aloom</text>
  </g>
</svg>`;
}

async function writeVariant({ copy, svgTarget, pngTargets }) {
	const svgPath = path.join(repoRoot, svgTarget);
	await writeFile(svgPath, renderSocial(copy), "utf8");
	for (const target of pngTargets) {
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
}

await writeVariant({
	copy: english,
	svgTarget: "assets/brand/aloom-social.svg",
	pngTargets: [
		"apps/web/src/app/opengraph-image.png",
		"apps/web/src/app/twitter-image.png",
		"apps/landing/src/app/opengraph-image.png",
		"apps/landing/src/app/twitter-image.png",
		"docs/images/aloom-detection.png",
	],
});

await writeVariant({
	copy: chinese,
	svgTarget: "assets/brand/aloom-social.zh-CN.svg",
	pngTargets: ["docs/images/aloom-detection.zh-CN.png"],
});

console.log("Generated English and Chinese Aloom report images.");
