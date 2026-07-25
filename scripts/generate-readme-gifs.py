#!/usr/bin/env python3
"""Regenerate README demo GIFs (terminal-style storyboards). Requires Pillow."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"

W, H = 640, 400
BG = (12, 14, 18)
PANEL = (22, 26, 33)
BORDER = (48, 54, 64)
FG = (220, 224, 230)
DIM = (140, 148, 160)
ACCENT = (180, 190, 200)
GREEN = (110, 190, 140)
YELLOW = (210, 180, 100)
CYAN = (130, 190, 200)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf"
        if bold
        else "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/liberation/LiberationMono-Bold.ttf"
        if bold
        else "/usr/share/fonts/liberation/LiberationMono-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


F_BODY = font(14)
F_SMALL = font(12)


def base(title: str):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [16, 16, W - 16, H - 16], radius=12, fill=PANEL, outline=BORDER, width=2
    )
    for i, c in enumerate([(239, 68, 68), (234, 179, 8), (34, 197, 94)]):
        d.ellipse([28 + i * 18, 28, 40 + i * 18, 40], fill=c)
    d.text((100, 26), title, font=F_SMALL, fill=DIM)
    return img, d


def draw_lines(d, lines, y0=56, lh=20):
    y = y0
    for line in lines:
        text, color = line if isinstance(line, tuple) else (line, FG)
        d.text((36, y), text, font=F_BODY, fill=color)
        y += lh


def fade_frames(frames, hold=12):
    out = []
    for f in frames:
        out.extend([f] * hold)
    return out


def save_gif(path: Path, frames, duration=100):
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        optimize=True,
    )
    print(f"wrote {path}")


def render(name: str, title: str, story: list[list]):
    frames = []
    for scene in story:
        img, d = base(title)
        draw_lines(d, scene)
        frames.append(img)
    save_gif(OUT / name, fade_frames(frames))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    render(
        "gatemcp-compress.gif",
        "gatemcp · compress",
        [
            [
                ("> gate_compress_file", CYAN),
                ("  filePath: src/App.tsx", DIM),
                ("  depth: signature", DIM),
            ],
            [
                ("> gate_compress_file", CYAN),
                ("  filePath: src/App.tsx", DIM),
                ("  depth: signature", DIM),
                ("", FG),
                ("  reading… 48 KB", YELLOW),
            ],
            [
                ("> gate_compress_file", CYAN),
                ("  filePath: src/App.tsx", DIM),
                ("  depth: signature", DIM),
                ("", FG),
                ("  originalTokens:  2,664", FG),
                ("  optimizedTokens:   191", GREEN),
                ("  savingsPercent:    93%", GREEN),
                ("", FG),
                ("  export function App()", ACCENT),
                ("  export function useTheme()", ACCENT),
            ],
            [
                ("> gate_compress_file", CYAN),
                ("  filePath: src/App.tsx", DIM),
                ("  depth: signature", DIM),
                ("", FG),
                ("  originalTokens:  2,664", FG),
                ("  optimizedTokens:   191", GREEN),
                ("  savingsPercent:    93%", GREEN),
                ("", FG),
                ("  export function App()", ACCENT),
                ("  export function useTheme()", ACCENT),
                ("", FG),
                ("  billingScope: tool_payload_only", DIM),
            ],
        ],
    )
    render(
        "gatemcp-catalog.gif",
        "gatemcp · catalog mode",
        [
            [
                ("> tools/list  GATE_TOOL_MODE=full", YELLOW),
                ("", FG),
                ("  12 tools advertised every turn", FG),
                ("  ~schema tax on every request", DIM),
            ],
            [
                ("> tools/list  GATE_TOOL_MODE=catalog", CYAN),
                ("", FG),
                ("  gate_help", GREEN),
                ("  gate_init", GREEN),
                ("  gate_compress_file", GREEN),
                ("  gate_graph_query", GREEN),
                ("  gate_session_stats", GREEN),
                ("  gate_invoke   ← long tail", ACCENT),
            ],
            [
                ("> tools/list  GATE_TOOL_MODE=catalog", CYAN),
                ("", FG),
                ("  gate_help", GREEN),
                ("  gate_init", GREEN),
                ("  gate_compress_file", GREEN),
                ("  gate_graph_query", GREEN),
                ("  gate_session_stats", GREEN),
                ("  gate_invoke   ← long tail", ACCENT),
                ("", FG),
                ("  schema surface: small by default", GREEN),
            ],
        ],
    )
    render(
        "gatemcp-benchmark.gif",
        "gatemcp · benchmarks",
        [
            [
                ("> gate_session_stats", CYAN),
                ("  projectRoot: …/react/packages", DIM),
            ],
            [
                ("> gate_session_stats", CYAN),
                ("  projectRoot: …/react/packages", DIM),
                ("", FG),
                ("  files_considered:  2,080", FG),
                ("  tokens before:     3.93M", FG),
                ("  tokens after:        446k", GREEN),
            ],
            [
                ("> gate_session_stats", CYAN),
                ("  projectRoot: …/react/packages", DIM),
                ("", FG),
                ("  files_considered:  2,080", FG),
                ("  tokens before:     3.93M", FG),
                ("  tokens after:        446k", GREEN),
                ("  reduction:            89%", GREEN),
                ("  symbol recall:      99.1%", ACCENT),
                ("", FG),
                ("  facebook/react packages/ (v0.3.2 bench)", DIM),
            ],
        ],
    )


if __name__ == "__main__":
    main()
