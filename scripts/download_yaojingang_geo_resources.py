#!/usr/bin/env python3
"""Download and categorize resources from the Yao Jingang GEO X thread."""

from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TODAY = "2026-06-30"
OUT_ROOT = Path.home() / "Desktop" / "yaojingang-geo-resources-2026-06-30"
USER_AGENT = "Mozilla/5.0 (compatible; CodexResourceArchive/1.0)"


@dataclass(frozen=True)
class DownloadItem:
    item_id: str
    category: str
    source_type: str
    title: str
    source_url: str
    output_relpath: str
    notes: str

    @property
    def output_path(self) -> Path:
        return OUT_ROOT / self.output_relpath


PDF_ITEMS = [
    DownloadItem(
        item_id="geo_manual_eval_standard",
        category="documents",
        source_type="pdf",
        title="GEO内容工程操作手册与评估标准",
        source_url="https://doc.laoyao.cn/9fl0bc",
        output_relpath="documents/pdfs/geo_manual_eval_standard_2026-06-30.pdf",
        notes="X 主帖第 1 个资料链接，t.co/o2XZweS5WX 展开后得到。",
    ),
    DownloadItem(
        item_id="geo_system_research_report",
        category="documents",
        source_type="pdf",
        title="GEO内容工程系统研究报告",
        source_url="https://doc.laoyao.cn/t754wa",
        output_relpath="documents/pdfs/geo_system_research_report_2026-06-30.pdf",
        notes="X 主帖第 2 个资料链接，t.co/4llvtD61gs 展开后得到。",
    ),
    DownloadItem(
        item_id="geo_method_single_article_tutorial",
        category="documents",
        source_type="pdf",
        title="GEO 内容工程方法体系与单篇内容实操教程",
        source_url="https://doc.laoyao.cn/54yx5b",
        output_relpath="documents/pdfs/geo_method_single_article_tutorial_2026-06-30.pdf",
        notes="X 主帖第 3 个资料链接，t.co/Ad9ga8CY4I 展开后得到。",
    ),
]

TWEET_IDS = [
    ("yaojingang", "2070878893582766223", "主帖：直播资料、资源及系统"),
    ("yaojingang", "2070798158339383579", "关联帖：开源 GEO 提示词和 skill"),
    ("yaojingang", "2070651940116291954", "链路帖：GEO 专题公开课第二场"),
    ("vista8", "2070497871124918353", "链路帖：WaytoAGI 公开课入口"),
]

LINK_CHAIN = [
    {
        "from": "https://t.co/o2XZweS5WX",
        "to": "https://doc.laoyao.cn/9fl0bc",
        "type": "pdf",
        "title": "GEO内容工程操作手册与评估标准",
    },
    {
        "from": "https://t.co/4llvtD61gs",
        "to": "https://doc.laoyao.cn/t754wa",
        "type": "pdf",
        "title": "GEO内容工程系统研究报告",
    },
    {
        "from": "https://t.co/Ad9ga8CY4I",
        "to": "https://doc.laoyao.cn/54yx5b",
        "type": "pdf",
        "title": "GEO 内容工程方法体系与单篇内容实操教程",
    },
    {
        "from": "https://t.co/lmKRDtrUon",
        "to": "https://twitter.com/yaojingang/status/2070798158339383579",
        "type": "x_thread",
        "title": "开源一套GEO提示词和skill",
    },
    {
        "from": "https://t.co/XBrB66KEtl",
        "to": "https://twitter.com/yaojingang/status/2070651940116291954",
        "type": "x_thread",
        "title": "GEO专题公开课第二场",
    },
    {
        "from": "https://t.co/4dpCTzcvKE",
        "to": "https://twitter.com/vista8/status/2070497871124918353",
        "type": "x_thread",
        "title": "WaytoAGI 公开课入口",
    },
    {
        "from": "https://t.co/sbvAdm4W2y",
        "to": "https://vc.feishu.cn/j/108720872",
        "type": "live_course_link",
        "title": "飞书直播入口，当前请求返回 404",
    },
]

REPO = {
    "name": "ganhuo-geo-skill",
    "full_name": "yuanyuanyuan430/ganhuo-geo-skill",
    "url": "https://github.com/yuanyuanyuan430/ganhuo-geo-skill",
    "clone_url": "https://github.com/yuanyuanyuan430/ganhuo-geo-skill.git",
    "api_url": "https://api.github.com/repos/yuanyuanyuan430/ganhuo-geo-skill",
    "description": "面向中国内容团队的干活 GEO Skill，把旧文章改造成 AI 搜索友好的内容资产",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def request_url(url: str, *, timeout: int = 45) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def retry(operation, *, attempts: int = 3):
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return operation()
        except Exception as exc:  # noqa: BLE001 - batch fault tolerance.
            last_error = exc
            if attempt < attempts - 1:
                delay = (2, 4, 8)[attempt]
                print(f"  ✗ Attempt {attempt + 1} failed ({exc}), retrying in {delay}s...")
                time.sleep(delay)
    raise RuntimeError(str(last_error))


def update_progress(
    *,
    status: str,
    total_items: int,
    processed_items: int,
    failed_items: int,
    current_item: str | None,
    completed_ids: list[str],
    started_at: str,
) -> None:
    write_json(
        OUT_ROOT / "progress.json",
        {
            "status": status,
            "started_at": started_at,
            "total_items": total_items,
            "processed_items": processed_items,
            "failed_items": failed_items,
            "current_item": current_item,
            "last_updated": now_iso(),
            "eta_seconds": 0,
            "completed_ids": completed_ids,
        },
    )


def append_failure(failures: list[dict[str, Any]], item_id: str, error: Exception) -> None:
    failures.append(
        {
            "item": item_id,
            "error": str(error),
            "attempts": 3,
            "failed_at": now_iso(),
        }
    )
    write_json(OUT_ROOT / "failed.json", failures)


def clean_tweet_html(tweet_html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", tweet_html, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def fetch_tweet(username: str, tweet_id: str, label: str) -> dict[str, Any]:
    url = f"https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2F{username}%2Fstatus%2F{tweet_id}"
    raw = request_url(url)
    data = json.loads(raw.decode("utf-8"))
    data["archive_label"] = label
    data["tweet_id"] = tweet_id
    data["username"] = username

    json_path = OUT_ROOT / "sources" / "x_posts" / f"x_post_{username}_{tweet_id}_{TODAY}.json"
    md_path = OUT_ROOT / "sources" / "x_posts" / f"x_post_{username}_{tweet_id}_{TODAY}.md"
    write_json(json_path, data)
    md_path.write_text(
        f"""# {label}

**作者:** {data.get("author_name")} ({data.get("author_url")})

**原链接:** {data.get("url")}

**抓取日期:** {TODAY}

## oEmbed 文本

{clean_tweet_html(data.get("html", ""))}
""",
        encoding="utf-8",
    )
    return {
        "id": f"x_post_{username}_{tweet_id}",
        "type": "x_oembed",
        "title": label,
        "url": data.get("url"),
        "json_path": str(json_path.relative_to(OUT_ROOT)),
        "markdown_path": str(md_path.relative_to(OUT_ROOT)),
    }


def download_pdf(item: DownloadItem) -> dict[str, Any]:
    data = request_url(item.source_url, timeout=60)
    item.output_path.parent.mkdir(parents=True, exist_ok=True)
    item.output_path.write_bytes(data)
    return {
        **asdict(item),
        "path": str(item.output_path.relative_to(OUT_ROOT)),
        "size_bytes": item.output_path.stat().st_size,
    }


def fetch_repo_metadata() -> dict[str, Any]:
    raw = request_url(REPO["api_url"])
    data = json.loads(raw.decode("utf-8"))
    metadata_path = OUT_ROOT / "repositories" / "metadata" / "github_repo_yuanyuanyuan430_ganhuo_geo_skill_2026-06-30.json"
    write_json(metadata_path, data)
    return {
        "id": "github_repo_metadata_ganhuo_geo_skill",
        "type": "github_metadata",
        "title": REPO["full_name"],
        "url": REPO["url"],
        "path": str(metadata_path.relative_to(OUT_ROOT)),
        "default_branch": data.get("default_branch"),
        "description": data.get("description"),
    }


def clone_repo() -> dict[str, Any]:
    repo_dir = OUT_ROOT / "repositories" / "ganhuo-geo-skill"
    repo_dir.parent.mkdir(parents=True, exist_ok=True)
    if repo_dir.exists() and (repo_dir / ".git").exists():
        status = "existing_clone"
    elif repo_dir.exists():
        status = "skipped_existing_non_git_directory"
    else:
        subprocess.run(
            ["git", "clone", "--depth", "1", REPO["clone_url"], str(repo_dir)],
            check=True,
            text=True,
        )
        status = "cloned"
    readme_candidates = [repo_dir / "README.md", repo_dir / "readme.md"]
    readme_path = next((path for path in readme_candidates if path.exists()), None)
    return {
        "id": "github_repo_ganhuo_geo_skill",
        "type": "github_repository",
        "title": REPO["full_name"],
        "url": REPO["url"],
        "clone_url": REPO["clone_url"],
        "path": str(repo_dir.relative_to(OUT_ROOT)),
        "status": status,
        "readme_path": str(readme_path.relative_to(OUT_ROOT)) if readme_path else None,
    }


def write_link_chain() -> dict[str, Any]:
    path = OUT_ROOT / "sources" / "link_chain" / f"link_chain_yaojingang_geo_{TODAY}.json"
    write_json(path, LINK_CHAIN)
    return {
        "id": "link_chain_yaojingang_geo",
        "type": "link_chain",
        "title": "X 帖子短链展开链路",
        "url": "https://x.com/yaojingang/status/2070878893582766223",
        "path": str(path.relative_to(OUT_ROOT)),
    }


def create_readme(manifest: dict[str, Any]) -> str:
    return f"""# 姚金刚 GEO 资料与仓库归档

生成日期：{TODAY}

来源主帖：https://x.com/yaojingang/status/2070878893582766223

## 目录结构

- `documents/pdfs/`：主帖中的 3 个 PDF 资料。
- `repositories/ganhuo-geo-skill/`：定位到的 GitHub 仓库本地克隆。
- `repositories/metadata/`：GitHub 仓库 API 元数据。
- `sources/x_posts/`：相关 X 帖子的 oEmbed JSON 和可读 Markdown。
- `sources/link_chain/`：t.co 短链展开结果和链路说明。
- `manifest.json`：本次归档的机器可读清单。

## 已归档内容

- PDF：{len([item for item in manifest["items"] if item.get("source_type") == "pdf"])} 个
- X 帖子记录：{len([item for item in manifest["items"] if item.get("type") == "x_oembed"])} 个
- GitHub 仓库：{len([item for item in manifest["items"] if item.get("type") == "github_repository"])} 个

## 注意

公开 oEmbed 返回的长帖正文存在截断；本归档保存了可公开读取的帖子记录、展开链路、PDF 和通过 GitHub 搜索确认的匹配仓库。飞书直播入口 `https://vc.feishu.cn/j/108720872` 在抓取时返回 404。

仓库 `yuanyuanyuan430/ganhuo-geo-skill` 是根据 X 帖子中的描述“开源一套GEO提示词和skill”“把已有文章改造成 GEO / AI 搜索友好的版本”等关键词，通过 GitHub 公开搜索接口定位；仓库描述与帖子描述一致。
"""


def main() -> int:
    started_at = now_iso()
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    for rel in (
        "documents/pdfs",
        "repositories/metadata",
        "sources/x_posts",
        "sources/link_chain",
    ):
        (OUT_ROOT / rel).mkdir(parents=True, exist_ok=True)

    tasks: list[tuple[str, Any]] = []
    for pdf in PDF_ITEMS:
        tasks.append((pdf.item_id, lambda pdf=pdf: download_pdf(pdf)))
    for username, tweet_id, label in TWEET_IDS:
        tasks.append((f"x_post_{username}_{tweet_id}", lambda username=username, tweet_id=tweet_id, label=label: fetch_tweet(username, tweet_id, label)))
    tasks.append(("link_chain_yaojingang_geo", write_link_chain))
    tasks.append(("github_repo_metadata_ganhuo_geo_skill", fetch_repo_metadata))
    tasks.append(("github_repo_ganhuo_geo_skill", clone_repo))

    total = len(tasks)
    print(
        f"=== Task: Yao Jingang GEO resources archive | Total: {total} | "
        f"Source: X + doc.laoyao.cn + GitHub | Output: {OUT_ROOT} ==="
    )

    progress_path = OUT_ROOT / "progress.json"
    completed_ids: list[str] = []
    if progress_path.exists():
        try:
            completed_ids = json.loads(progress_path.read_text(encoding="utf-8")).get("completed_ids", [])
            print(f"Resuming from checkpoint: {len(completed_ids)} completed")
        except json.JSONDecodeError:
            completed_ids = []

    failures: list[dict[str, Any]] = []
    failed_path = OUT_ROOT / "failed.json"
    if failed_path.exists():
        try:
            failures = json.loads(failed_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            failures = []

    manifest_items: list[dict[str, Any]] = []
    processed = 0
    update_progress(
        status="in_progress",
        total_items=total,
        processed_items=processed,
        failed_items=len(failures),
        current_item=None,
        completed_ids=completed_ids,
        started_at=started_at,
    )

    for index, (item_id, operation) in enumerate(tasks, start=1):
        print(f"[{now_iso()}] Processing {index}/{total}: {item_id}")
        update_progress(
            status="in_progress",
            total_items=total,
            processed_items=processed,
            failed_items=len(failures),
            current_item=item_id,
            completed_ids=completed_ids,
            started_at=started_at,
        )
        if item_id in completed_ids:
            print("  ✓ Completed (checkpoint skip)")
            processed += 1
            continue
        try:
            result = retry(operation)
            manifest_items.append(result)
            completed_ids.append(item_id)
            processed += 1
            print("  ✓ Completed")
        except Exception as exc:  # noqa: BLE001 - continue batch.
            append_failure(failures, item_id, exc)
            print(f"  ✗ Failed ({exc})")

        update_progress(
            status="in_progress",
            total_items=total,
            processed_items=processed,
            failed_items=len(failures),
            current_item=item_id,
            completed_ids=completed_ids,
            started_at=started_at,
        )

    manifest = {
        "generated_at": now_iso(),
        "generated_date": TODAY,
        "root": str(OUT_ROOT),
        "source_thread": "https://x.com/yaojingang/status/2070878893582766223",
        "repo": REPO,
        "items": manifest_items,
        "failures": failures,
    }
    write_json(OUT_ROOT / "manifest.json", manifest)
    (OUT_ROOT / "README.md").write_text(create_readme(manifest), encoding="utf-8")

    if failures:
        update_progress(
            status="completed_with_failures",
            total_items=total,
            processed_items=processed,
            failed_items=len(failures),
            current_item=None,
            completed_ids=completed_ids,
            started_at=started_at,
        )
        print(f"Completed with {len(failures)} failures. See {failed_path}")
        return 1

    if progress_path.exists():
        progress_path.unlink()
    if failed_path.exists():
        failed_path.unlink()
    print(f"Completed successfully. Output: {OUT_ROOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
