#!/usr/bin/env python3
"""Generates the extension icons (two screens with an orange hinge). Requires Pillow."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
os.makedirs(OUT, exist_ok=True)

INK = (24, 33, 47, 255)
PAPER = (255, 255, 255, 255)
HINGE = (255, 90, 31, 255)


def icon(size):
    s = size * 8  # supersample, then downscale for clean edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=INK)
    pad = s * 0.2
    gap = s * 0.05
    mid = s / 2
    r = int(s * 0.07)
    d.rounded_rectangle((pad, pad, mid - gap, s - pad), radius=r, fill=PAPER)
    d.rounded_rectangle((mid + gap, pad, s - pad, s - pad), radius=r, fill=PAPER)
    d.rectangle((mid - gap * 0.8, pad * 0.8, mid + gap * 0.8, s - pad * 0.8), fill=HINGE)
    return img.resize((size, size), Image.LANCZOS)


for n in (16, 32, 48, 128):
    icon(n).save(os.path.join(OUT, "icon-%d.png" % n))
    print("wrote icon-%d.png" % n)
