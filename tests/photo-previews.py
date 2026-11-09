"""Run the production filter renderer against local JPEG fixtures.

Python only decodes, applies EXIF orientation, resizes for the app's 1440px cap,
and assembles labelled contact sheets. All effects come from filters.js in Node.

Usage: python tests/photo-previews.py [--node PATH] [--source JPEG ...]
Outputs: .preview-temp/analog-quality/ (never modifies the fixture photographs).
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".preview-temp" / "analog-quality"
BUNDLED_NODE = Path(r"C:\Program Files\WindowsApps\OpenAI.Codex_26.1103.4239.0_x64__2p2nqsd0c76g0\app\resources\cua_node\bin\node.exe")
NEW_IDS = [
    "album1991", "school1994", "summer1996", "flash1998", "minilab1995", "camcorder1999",
    "expired-roll", "sunfaded-slide", "amber-print", "rose-print", "silver-print",
    "sepia-archive", "half-frame", "toy-lens", "red-leak", "warm-mist",
]


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in [Path("C:/Windows/Fonts/malgun.ttf"), Path("C:/Windows/Fonts/arial.ttf")]:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def contact_sheet(job: dict, metrics: dict, ids: list[str], page: int) -> Path:
    cell_width, cell_height, heading = 460, 480, 68
    sheet = Image.new("RGB", (cell_width * 3, cell_height * 3 + heading), "#121216")
    draw = ImageDraw.Draw(sheet)
    title_font, label_font, meta_font = font(24), font(21), font(14)
    draw.text((20, 12), "Vintage Cam · 90s / Vintage / Retro", font=title_font, fill="#f1ddd0")
    draw.text((20, 44), f"{job['label']} · 80% · seed 42 · page {page}", font=meta_font, fill="#b8b1ae")
    records = {result["id"]: result for result in metrics["results"]}
    for index, preset_id in enumerate(["original", *ids]):
        x = index % 3 * cell_width
        y = index // 3 * cell_height + heading
        filename = Path(job["output"]) / (preset_id + ".png")
        with Image.open(filename) as opened:
            preview = opened.convert("RGB")
            preview.thumbnail((cell_width - 20, cell_height - 64), Image.Resampling.LANCZOS)
            sheet.paste(preview, (x + (cell_width - preview.width) // 2, y + (cell_height - 64 - preview.height) // 2))
        record = records[preset_id]
        draw.text((x + 12, y + cell_height - 52), record["name"], font=label_font, fill="#fff0e4")
        draw.text((x + 12, y + cell_height - 24), preset_id, font=meta_font, fill="#a9a4a2")
    destination = Path(job["output"]) / f"contact-{page}.jpg"
    sheet.save(destination, quality=94, subsampling=0)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", type=Path, help="Node executable; defaults to PATH, then the installed Codex runtime.")
    parser.add_argument("--source", nargs="+", type=Path, help="Optional local JPEG paths.")
    args = parser.parse_args()
    node = args.node or shutil.which("node") or BUNDLED_NODE
    if not Path(node).is_file():
        parser.error("Node was not found. Supply --node with its executable path.")

    if args.source:
        sources = [source.resolve() for source in args.source]
    else:
        sources = []
        for prefix in ["P20251122_", "P20260823_160130945_"]:
            sources.extend(sorted((ROOT / "test_img").glob(prefix + "*.JPG"))[:1])
        if len(sources) < 2:
            for candidate in sorted((ROOT / "test_img").glob("*.JPG")):
                if candidate not in sources:
                    sources.append(candidate)
                if len(sources) >= 2:
                    break
    if not sources:
        parser.error("No JPEG fixtures were found in test_img.")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for number, source in enumerate(sources, start=1):
        destination = OUTPUT / f"photo-{number}"
        destination.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as original:
            oriented = ImageOps.exif_transpose(original)
            profile = original.info.get("icc_profile")
            if profile:
                # Browser Canvas uses sRGB by default. Honour embedded camera
                # profiles during decoding so QA receives the same colour space.
                decoded = ImageCms.profileToProfile(
                    oriented, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                    ImageCms.createProfile("sRGB"), outputMode="RGBA",
                )
            else:
                decoded = oriented.convert("RGBA")
            decoded.thumbnail((1440, 1440), Image.Resampling.LANCZOS)
            raw_path = destination / "source.rgba"
            raw_path.write_bytes(decoded.tobytes())
            jobs.append({
                "label": f"Photo {number}", "source": str(source), "input": str(raw_path),
                "output": str(destination), "width": decoded.width, "height": decoded.height,
            })
    jobs_path = OUTPUT / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    subprocess.run([str(node), str(ROOT / "tests" / "render-photo-previews.cjs"), str(jobs_path)], check=True, cwd=ROOT)

    for job in jobs:
        metrics = json.loads((Path(job["output"]) / "metrics.json").read_text(encoding="utf-8"))
        for record in metrics["results"]:
            image = Image.frombytes("RGBA", (job["width"], job["height"]), Path(record["output"]).read_bytes())
            image.save(Path(job["output"]) / (record["id"] + ".png"))
        for page, ids in enumerate([NEW_IDS[:8], NEW_IDS[8:]], start=1):
            print(contact_sheet(job, metrics, ids, page))
    print(f"Metrics: {OUTPUT / 'metrics.json'}")


if __name__ == "__main__":
    main()
