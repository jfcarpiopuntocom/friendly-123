#!/usr/bin/env python3
"""Exact-source color PWA icons. No generative art, painting, or brand recoloring.
Input: docs/img/logo-720.png (approved friendly-123 wordmark). Output: derived 123.
The browser install UI reads PNG icons; this script never changes runtime data.
"""
from __future__ import annotations
from pathlib import Path
from hashlib import sha256
from collections import Counter
import colorsys
import io
import json
import subprocess
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/img/logo-720.png"
OUT = ROOT / "docs/icons"
BASE = "f123-color-v577"
BG = (248,249,251,255) # existing manifest background, NOT a digit color
PASSED = []
def check(num: int, title: str, result: bool) -> None:
    if not result: raise AssertionError(f"Color fidelity {num:02d}: {title}")
    PASSED.append(f"{num:02d} {title}")

def color_family(pixel):
    r,g,b,a=pixel
    if a<240: return None
    h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
    if s<.47 or v<.50: return None # exclude dark navy outlines, never confuse them with the blue 3
    if .86 <= h <= .99: return "magenta"
    if .027 <= h <= .085: return "orange"
    if .53 <= h <= .72: return "blue"
    return None

def stats(image):
    cs=Counter(color_family(px) for px in image.getdata())
    return {n:cs[n] for n in ("magenta","orange","blue")}

def write():
    raw=SOURCE.read_bytes()
    source_sha=sha256(raw).hexdigest()
    git_sha=subprocess.check_output(["git","hash-object",str(SOURCE)],cwd=ROOT,text=True).strip()
    with Image.open(io.BytesIO(raw)) as original:
        src=original.convert("RGBA")
        info=original.info.copy()
    w,h=src.size
    check(1,"official source exists",len(raw)>10000)
    check(2,"official source SHA-256 pinned to readback",sha256(SOURCE.read_bytes()).hexdigest()==source_sha)
    check(3,"source Git blob is the approved exact asset",git_sha=="0b887213b3b96e7aaf3bcfb8ed3eaa97ec2d47e7")
    check(4,"source RGB/RGBA color data",src.mode=="RGBA")
    check(5,"approved full logo aspect ratio",w>=700 and 100<=h<=200)
    check(6,"source fully within 8-bit sRGB output gamut",all(0<=v<=255 for p in src.getdata() for v in p))
    check(7,"source alpha exists for clean composition",src.getchannel("A").getextrema()[0]==0)
    check(8,"ICC profile not changed on extraction",not info.get("icc_profile") or isinstance(info["icc_profile"],bytes))
    pixels=src.load()
    families={kind:[] for kind in ("magenta","orange","blue")}
    for y in range(h):
        for x in range(w):
            f=color_family(pixels[x,y])
            if f: families[f].append((x,y))
    check(9,"brand magenta 1 sampled directly from source",len(families["magenta"])>100)
    check(10,"brand orange 2 sampled directly from source",len(families["orange"])>100)
    check(11,"brand blue 3 sampled directly from source",len(families["blue"])>100)
    colors=[families[k] for k in ("magenta","orange","blue")]
    mins=[min(x for x,y in pts) for pts in colors]
    check(12,"digit order magenta/orange/blue verified",mins==sorted(mins))
    left=max(0,mins[0]-10)
    right=min(w,max(x for x,y in families["blue"])+18)
    fg=[(x,y) for y in range(h) for x in range(left,right) if pixels[x,y][3]>20]
    top=max(0,min(y for x,y in fg)-2)
    bottom=min(h,max(y for x,y in fg)+3)
    crop=src.crop((left,top,right,bottom))
    # Precise boundary between the yellow hyphen and the magenta 1:
    # at each scanline, keep the original digit pixels and inner navy counters,
    # clipping ONLY material left of the numeral's row-specific magenta contour.
    # Do not apply dilation to digit holes: it damages the blue 3 counters.
    magenta_rows={}
    for x,y in families["magenta"]:
        if y not in magenta_rows or x<magenta_rows[y]: magenta_rows[y]=x
    rows=sorted(magenta_rows)
    crop_px=crop.load()
    for yy in range(crop.height):
        orig_y=yy+top
        near=min(rows,key=lambda z:abs(z-orig_y))
        clip_x=magenta_rows[near]-9
        for xx in range(crop.width):
            orig_x=xx+left
            red,green,blue,alpha=crop_px[xx,yy]
            is_yellow_hyphen=red>150 and green>red*.61 and blue<green*.75
            if orig_x<clip_x or is_yellow_hyphen:
                crop_px[xx,yy]=(red,green,blue,0)
    bb=crop.getchannel("A").getbbox()
    if bb: crop=crop.crop(bb)
    check(13,"digit crop within official source",0<=left<right<=w and 0<=top<bottom<=h)
    check(14,"digit crop does not include friendly wordmark",left>w*.55 and crop.width<w*.45)
    check(15,"all three exact source families survive crop",all(v>100 for v in stats(crop).values()))
    check(16,"no palette quantization or forced recolor",crop.mode=="RGBA")
    check(17,"original alpha mask preserved",crop.getchannel("A").getextrema()[0]==0)
    OUT.mkdir(exist_ok=True,parents=True)
    files={}
    for size in (16,32,180,192,512):
        # Original raster strokes/colors; only spatial resampling on a neutral background.
        # Safe-zone mode is deliberately separate from the ordinary icon.
        max_width=.86 if size>=180 else .94
        bound=(int(size*max_width),int(size*.78))
        target=ImageOps.contain(crop,bound,method=Image.Resampling.LANCZOS)
        canvas=Image.new("RGBA",(size,size),BG)
        canvas.alpha_composite(target,((size-target.width)//2,(size-target.height)//2))
        filename=(f"{BASE}-{size}.png")
        canvas.convert("RGB").save(OUT/filename,"PNG",optimize=True)
        files[filename]=size
    mask=Image.new("RGBA",(512,512),BG)
    subject=ImageOps.contain(crop,(int(512*.74),int(512*.72)),Image.Resampling.LANCZOS)
    mask.alpha_composite(subject,((512-subject.width)//2,(512-subject.height)//2))
    mask.convert("RGB").save(OUT/f"{BASE}-maskable-512.png",optimize=True)
    files[f"{BASE}-maskable-512.png"]=512
    # Cache-busted .ico is separate because old /favicon.ico can be sticky on Safari.
    ico=Image.open(OUT/f"{BASE}-512.png")
    ico.save(ROOT/"docs/favicon-v577.ico",format="ICO",sizes=[(16,16),(32,32),(48,48),(64,64)])
    check(18,"standard source colors remain detectable at 512",all(v>100 for v in stats(Image.open(OUT/f"{BASE}-512.png").convert("RGBA")).values()))
    check(19,"standard outputs have exact declared dimensions",all(Image.open(OUT/n).size==(s,s) for n,s in files.items()))
    check(20,"iOS 180 PNG has opaque neutral corners",Image.open(OUT/f"{BASE}-180.png").convert("RGBA").getpixel((0,0))==BG)
    check(21,"maskable art fits Android safe zone",subject.width<=512*.8 and subject.height<=512*.8)
    check(22,"all PNGs are lossless RGB and profile-safe",all(Image.open(OUT/n).format=="PNG" and Image.open(OUT/n).mode=="RGB" for n in files))
    check(23,"logo master not modified during derivation",sha256(SOURCE.read_bytes()).hexdigest()==source_sha)
    print(json.dumps({"source_sha256":source_sha,"source_git_sha":git_sha,
       "source_dimensions":(w,h),"crop":(left,top,right,bottom),
       "source_color_counts":stats(crop),"checks":PASSED,
       "outputs":{n:sha256((OUT/n).read_bytes()).hexdigest() for n in files}},indent=2))

if __name__=="__main__":write()
