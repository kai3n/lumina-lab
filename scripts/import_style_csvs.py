#!/usr/bin/env python3
"""Rebuild the sample style catalog from the Style CSVs (scripts/style-csvs/).
Parses -> downloads competitor reference images -> removes any competitor "GB"
engraving -> self-hosts under public/assets/designs -> writes styleSeedData.js.

Requires Pillow + opencv-python + network. Idempotent: images already in
public/assets/designs are reused (delete that dir to force a fresh fetch).
"""
import csv, re, json, urllib.request, io
from pathlib import Path
from urllib.parse import unquote
from PIL import Image
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CSVDIR = ROOT / "scripts" / "style-csvs"
DESIGNS = ROOT / "public/assets/designs"
OUT = ROOT / "src/lib/styleSeedData.js"

CSV = {
    "engagement": CSVDIR / "Style - Engagement Rings.csv",
    "bands": CSVDIR / "Style - Bands.csv",
    "earrings": CSVDIR / "Style - Earrings.csv",
    "bracelets": CSVDIR / "Style - Bracelets.csv",
    "necklaces": CSVDIR / "Style - Necklaces & Pendants.csv",
}

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

# 경쟁사(Grown Brilliance) "GB" 각인이 밴드 안쪽에 렌더된 이미지 — 각인 글자 픽셀만
# 지역 임계값으로 마스킹하고 cv2.inpaint(Telea)로 주변 금속 질감을 전파해 자연스럽게
# 제거한다. {파일명: ((x0,y0,x1,y1), k, dilate)} — k는 임계값 강도(클수록 덜 포함),
# dilate는 마스크 확장 커널 크기. 좌표는 해당 그로운브릴리언스 렌더(1200px 기준).
GB_MARK_BOXES = {
    "RIGWR4428-WG-RB-WH-500-M0-new.jpg": ((706, 682, 770, 724), 0.55, 5),
    "BNGTXR00883-WG-RB-WH-100-M0-new.jpg": ((740, 684, 812, 720), 0.55, 5),
    "BNG341590-WG-RB-WH-300-M0-new.jpg": ((708, 672, 786, 716), 0.30, 7),
    "BNGYR1450K-WG-RB-WH-200-M0-new.jpg": ((752, 674, 824, 718), 0.30, 7),
    "BNGYR1450K-WG-RB-WH-200-M1-new.jpg": ((622, 624, 680, 676), 0.30, 7),
    "PNGTXP01957-RG-M2.jpg": ((648, 504, 692, 546), 0.5, 5),
    "AJE06021-WG-M1.jpg": ((816, 468, 870, 510), 0.35, 7),  # 허기 후프 안쪽 밴드
}

def strip_competitor_mark(name, im):
    spec = GB_MARK_BOXES.get(name)
    if not spec:
        return im
    (x0, y0, x1, y1), k, dl = spec
    arr = cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
    reg = gray[y0:y1, x0:x1]
    thr = reg.mean() - k * reg.std()  # 각인 글자는 주변 밝은 금속보다 어둡다
    mask = np.zeros(gray.shape, np.uint8)
    mask[y0:y1, x0:x1] = (reg < thr).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    mask = cv2.dilate(mask, np.ones((dl, dl), np.uint8), 1)
    out = cv2.inpaint(arr, mask, 4, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))

def inner_url(url):
    m = re.search(r"(https://images\.grownbrilliance\.com/.*)$", url)
    return m.group(1) if m else url

def basename_for(url):
    u = inner_url(url); tail = unquote(u.split("?")[0].rsplit("/", 1)[-1])
    tail = re.sub(r"[^A-Za-z0-9._-]", "_", tail)
    if not re.search(r"\.(jpg|jpeg|png|webp)$", tail, re.I):
        tail = tail + ".jpg"
    return re.sub(r"\.(jpeg|png|webp)$", ".jpg", tail, flags=re.I)

_img_cache = {}
def localize(url):
    """download -> strip competitor mark -> save; return /assets/designs/<name> or None."""
    if url in _img_cache: return _img_cache[url]
    name = basename_for(url); dst = DESIGNS / name
    web = f"/assets/designs/{name}"
    if dst.exists():
        _img_cache[url] = web; return web
    try:
        req = urllib.request.Request(inner_url(url), headers=UA)
        data = urllib.request.urlopen(req, timeout=30).read()
        im = strip_competitor_mark(name, Image.open(io.BytesIO(data)))
        im.convert("RGB").save(dst, "JPEG", quality=90)
        print(f"  ✓ {name}")
        _img_cache[url] = web; return web
    except Exception as e:
        print(f"  ✗ {url[:70]} -> {e}")
        _img_cache[url] = None; return None

# --- name cleanup ---
def norm_name(en):
    en = re.sub(r"（.*?）|\(.*?\)", "", en)
    en = re.sub(r"\s+", " ", en).strip()
    en = en.replace("EternityPavé", "Eternity Pavé")
    en = re.sub(r"three-quarter", "Three-Quarter", en, flags=re.I)
    en = re.sub(r"\bHalo Halo\b", "Halo", en)          # "Hidden Halo Halo" -> "Hidden Halo"
    en = re.sub(r"\bEarrings Earrings\b", "Earrings", en)
    en = re.sub(r"\bTennis Bracelet\d\b", "Tennis Bracelet", en)
    return en.strip()

NECK_ALIAS = {
    "Solitaire": "Solitaire Pendant", "Halo": "Halo Pendant", "Clover": "Clover Pendant",
    "Graduated": "Graduated Necklace", "Journey": "Journey Necklace", "Butterfly": "Butterfly Pendant",
    "Cross": "Cross Pendant", "Cross 2": "Statement Cross Pendant",
}

# --- token-based i18n (jewelry KR uses loanwords; ZH/ES semantic) ---
TOK = [
    ("Classic", "클래식", "经典", "clásico"),
    ("Four-Prong", "4프롱", "四爪", "cuatro garras"),
    ("Six-Prong", "6프롱", "六爪", "seis garras"),
    ("Cathedral", "캐시드럴", "大教堂", "catedral"),
    ("Basket", "바스켓", "篮式", "basket"),
    ("Hidden Halo", "히든 헤일로", "隐藏光环", "halo oculto"),
    ("Half-Eternity", "하프 이터니티", "半永恒", "medio eternity"),
    ("Full-Eternity", "풀 이터니티", "全永恒", "eternity completo"),
    ("Three-Quarter Eternity", "쓰리쿼터 이터니티", "四分之三永恒", "eternity tres cuartos"),
    ("Eternity", "이터니티", "永恒", "eternity"),
    ("Knife Edge", "나이프 엣지", "刀锋", "knife edge"),
    ("Pavé", "파베", "密钉", "pavé"),
    ("Three Stone", "쓰리 스톤", "三石", "tres piedras"),
    ("Side Stone", "사이드 스톤", "侧石", "piedra lateral"),
    ("Solitaire", "솔리테어", "单钻", "solitario"),
    ("Halo", "헤일로", "光环", "halo"),
    ("Band", "밴드", "戒圈", "banda"),
    ("Ring", "링", "戒指", "anillo"),
]
def i18n_from_tokens(en, lang):
    idx = {"ko": 1, "zh": 2, "es": 3}[lang]
    out = en
    for tok in sorted(TOK, key=lambda t: -len(t[0])):
        out = re.sub(re.escape(tok[0]), tok[idx], out)
    out = re.sub(r"\s+", " ", out).strip()
    return out

# canonical names for SKU-identified products (reused from prior import) + their i18n
PRODUCT_TITLE_OVERRIDES = {
    "EAGTXE01900": "Round Diamond Stud Earrings", "EAGJOE555": "Inside-Out Hoop Earrings",
    "EAGTXE02393": "Princess Halo Stud Earrings", "EAGAJE06021": "Cushion Huggie Hoop Earrings",
    "AJE06021": "Cushion Huggie Hoop Earrings", "EAGTXE02084": "Emerald Halo Drop Earrings",
    "EAGTXE02083": "Emerald Halo Drop Earrings", "AJE09546": "Round and Pear Drop Earrings",
    "AJE00461": "Marquise Flower Stud Earrings", "AJE00896": "Marquise Flower Stud Earrings",
    "BCGTXBR00769": "Four-Prong Tennis Bracelet", "BCGVG2664K": "Shared-Prong Bangle Bracelet",
    "BRAAAB02136V": "Boundless Eternity Bracelet", "BCGTXBR01703": "Emerald Tennis Bracelet",
    "BRAAAB01755U": "Boundless Station Bracelet",
    "PNGTXP07660R300": "Round Solitaire Pendant", "PNGTXP01957": "Round Halo Pendant",
    "857162W1404L": "Cluster Flower Pendant", "NCGRVN01233R500": "Thirteen-Stone Demi Eternity Necklace",
    "857170W14L": "Round and Pear Diamond Drop Necklace", "DP2284": "Marquise Pear Flower Pendant",
    "NCGXK4149Q": "Four-Prong Tennis Necklace", "NCGKN29498": "Station Necklace",
    "PNGKP0960": "Diamond Cross Pendant", "NJOP7967": "Shield Diamond Cross Statement Pendant",
}
TRANSLATIONS = {
    "Round Diamond Stud Earrings": {"ko": "라운드 다이아몬드 스터드 이어링", "zh": "圆形钻石耳钉", "es": "Aretes de diamantes redondos"},
    "Princess Halo Stud Earrings": {"ko": "프린세스 헤일로 스터드 이어링", "zh": "公主方光环耳钉", "es": "Aretes halo princess"},
    "Inside-Out Hoop Earrings": {"ko": "인사이드 아웃 후프 이어링", "zh": "内外镶钻圈形耳环", "es": "Aros inside-out"},
    "Cushion Huggie Hoop Earrings": {"ko": "쿠션 허기 후프 이어링", "zh": "垫形贴耳圈耳环", "es": "Aros huggie cushion"},
    "Emerald Halo Drop Earrings": {"ko": "에메랄드 헤일로 드롭 이어링", "zh": "祖母绿形光环垂坠耳环", "es": "Aretes colgantes halo esmeralda"},
    "Round and Pear Drop Earrings": {"ko": "라운드 앤 페어 드롭 이어링", "zh": "圆形梨形垂坠耳环", "es": "Aretes colgantes redondo y pera"},
    "Marquise Flower Stud Earrings": {"ko": "마퀴즈 플라워 스터드 이어링", "zh": "马眼形花朵耳钉", "es": "Aretes flor marquise"},
    "Four-Prong Tennis Bracelet": {"ko": "4프롱 테니스 브레이슬릿", "zh": "四爪网球手链", "es": "Pulsera tenis de 4 garras"},
    "Shared-Prong Bangle Bracelet": {"ko": "쉐어드 프롱 뱅글 브레이슬릿", "zh": "共爪手镯", "es": "Brazalete de garras compartidas"},
    "Boundless Eternity Bracelet": {"ko": "바운드리스 이터니티 브레이슬릿", "zh": "无界永恒手链", "es": "Pulsera eternity boundless"},
    "Emerald Tennis Bracelet": {"ko": "에메랄드 테니스 브레이슬릿", "zh": "祖母绿网球手链", "es": "Pulsera tenis esmeralda"},
    "Boundless Station Bracelet": {"ko": "바운드리스 스테이션 브레이슬릿", "zh": "无界站点手链", "es": "Pulsera station boundless"},
    "Round Solitaire Pendant": {"ko": "라운드 솔리테어 펜던트", "zh": "圆形单钻吊坠", "es": "Colgante solitario redondo"},
    "Round Halo Pendant": {"ko": "라운드 헤일로 펜던트", "zh": "圆形光环吊坠", "es": "Colgante halo redondo"},
    "Cluster Flower Pendant": {"ko": "클러스터 플라워 펜던트", "zh": "簇镶花朵吊坠", "es": "Colgante floral cluster"},
    "Thirteen-Stone Demi Eternity Necklace": {"ko": "13스톤 데미 이터니티 네크리스", "zh": "十三石半圈永恒项链", "es": "Collar demi eternity de trece piedras"},
    "Round and Pear Diamond Drop Necklace": {"ko": "라운드 앤 페어 다이아 드롭 네크리스", "zh": "圆形与梨形钻石垂坠项链", "es": "Collar de diamantes redondo y pera"},
    "Marquise Pear Flower Pendant": {"ko": "마퀴즈 페어 플라워 펜던트", "zh": "马眼形梨形花朵吊坠", "es": "Colgante floral marquise y pera"},
    "Four-Prong Tennis Necklace": {"ko": "4프롱 테니스 네크리스", "zh": "四爪网球项链", "es": "Collar tenis de 4 garras"},
    "Station Necklace": {"ko": "스테이션 네크리스", "zh": "站钻项链", "es": "Collar station"},
    "Diamond Cross Pendant": {"ko": "다이아몬드 크로스 펜던트", "zh": "钻石十字吊坠", "es": "Colgante cruz de diamantes"},
    "Shield Diamond Cross Statement Pendant": {"ko": "쉴드 다이아몬드 크로스 펜던트", "zh": "盾形钻石十字吊坠", "es": "Colgante cruz shield"},
    "Clover Pendant": {"ko": "클로버 펜던트", "zh": "四叶草吊坠", "es": "Colgante trébol"},
    "Graduated Necklace": {"ko": "그라데이티드 네크리스", "zh": "渐变排钻项链", "es": "Collar graduado"},
    "Journey Necklace": {"ko": "저니 네크리스", "zh": "渐进式项链", "es": "Collar journey"},
    "Butterfly Pendant": {"ko": "버터플라이 펜던트", "zh": "蝴蝶吊坠", "es": "Colgante mariposa"},
    "Diamond Hoops": {"ko": "다이아몬드 후프", "zh": "钻石圈耳环", "es": "Aros de diamantes"},
    "Huggie Earrings": {"ko": "허기 이어링", "zh": "贴耳圈耳环", "es": "Aros huggie"},
    "Drop Earrings": {"ko": "드롭 이어링", "zh": "垂坠耳环", "es": "Aretes colgantes"},
    "Journey Earrings": {"ko": "저니 이어링", "zh": "渐变耳环", "es": "Aretes journey"},
    "Flower Stud Earrings": {"ko": "플라워 스터드 이어링", "zh": "花朵耳钉", "es": "Aretes flor"},
    "Solitaire Studs": {"ko": "솔리테어 스터드", "zh": "单钻耳钉", "es": "Aretes solitario"},
    "Halo Studs": {"ko": "헤일로 스터드", "zh": "光环耳钉", "es": "Aretes halo"},
    "Tennis Bracelet": {"ko": "테니스 브레이슬릿", "zh": "网球手链", "es": "Pulsera tenis"},
    "Diamond Bangle": {"ko": "다이아몬드 뱅글", "zh": "满钻手镯", "es": "Brazalete de diamantes"},
    "Station Bracelet": {"ko": "스테이션 브레이슬릿", "zh": "站钻手链", "es": "Pulsera station"},
    "Tennis Necklace": {"ko": "테니스 네크리스", "zh": "网球项链", "es": "Collar tenis"},
    "Solitaire Pendant": {"ko": "솔리테어 펜던트", "zh": "单钻吊坠", "es": "Colgante solitario"},
    "Halo Pendant": {"ko": "헤일로 펜던트", "zh": "光环吊坠", "es": "Colgante halo"},
    "Cross Pendant": {"ko": "크로스 펜던트", "zh": "十字吊坠", "es": "Colgante cruz"},
    "Statement Cross Pendant": {"ko": "스테이트먼트 크로스 펜던트", "zh": "宣言十字吊坠", "es": "Colgante cruz statement"},
    "French Pavé Eternity Band": {"ko": "프렌치 파베 이터니티 밴드", "zh": "法式密钉永恒戒圈", "es": "Banda eternity pavé francés"},
    "Low Dome Basket Eternity Band": {"ko": "로우 돔 바스켓 이터니티 밴드", "zh": "低圆顶篮式永恒戒圈", "es": "Banda eternity basket domo bajo"},
    "Pavé Band": {"ko": "파베 밴드", "zh": "密钉戒圈", "es": "Banda pavé"},
    "Channel Set Band": {"ko": "채널 세트 밴드", "zh": "槽镶戒圈", "es": "Banda channel set"},
}

def product_title_for(ref, urls):
    hay = " ".join([ref or "", *(urls or [])])
    for marker, title in PRODUCT_TITLE_OVERRIDES.items():
        if marker in hay:
            return title
    return ""

def i18n(en, zh=""):
    zh = zh if zh and not zh.startswith("http") else ""
    if en in TRANSLATIONS:
        t = TRANSLATIONS[en]  # canonical name → authoritative i18n (ignore CSV's descriptive zh)
        return {"en": en, "ko": t["ko"], "zh": t["zh"], "es": t["es"]}
    return {
        "en": en,
        "ko": i18n_from_tokens(en, "ko"),
        "zh": zh or i18n_from_tokens(en, "zh"),
        "es": i18n_from_tokens(en, "es"),
    }

DETAIL = {
    "detailLabel": {"en": "Custom starter design", "ko": "맞춤 시작 디자인", "zh": "定制起点设计", "es": "Diseño inicial personalizado"},
    "description": {
        "en": "This is a sample starting point, not a limit. Share references and we can adjust shape, scale, stones, metal, and finish after review.",
        "ko": "이 디자인은 제한이 아니라 시작점입니다. 원하는 레퍼런스를 보내주시면 형태, 크기, 스톤, 메탈, 마감을 검토 후 조정할 수 있습니다.",
        "zh": "这是起点样例，不是限制。上传参考后，我们可评估并调整造型、尺寸、宝石、金属与细节。",
        "es": "Este diseño es un punto de partida, no un límite. Comparte referencias y ajustamos forma, escala, piedras, metal y acabado tras revisar.",
    },
    "flexibleText": {"en": "Shape, stone, metal, scale", "ko": "형태, 스톤, 메탈, 크기", "zh": "造型、宝石、金属、比例", "es": "Forma, piedra, metal, escala"},
    "beforeProductionText": {"en": "Quote and CAD approval", "ko": "견적 및 CAD 승인", "zh": "报价与 CAD 确认", "es": "Cotización y aprobación CAD"},
}
FLEX = {
    "bangle": {"en": "Length, clasp, stone size", "ko": "길이, 잠금장식, 스톤 크기", "zh": "长度、扣件、宝石尺寸", "es": "Largo, broche, tamaño de piedra"},
    "necklace": {"en": "Chain, length, pendant scale", "ko": "체인, 길이, 펜던트 크기", "zh": "链型、长度、吊坠比例", "es": "Cadena, largo, escala del colgante"},
    "earrings": {"en": "Pairing, post, drop length", "ko": "페어링, 포스트, 드롭 길이", "zh": "配对、耳针、垂坠长度", "es": "Par, poste, largo de caída"},
}
DEFAULTS = {  # estWeightG, laborUsd, leadDays, metalOptions
    "ring": (4.2, 95, 12, ["18kw", "18ky", "18kr", "pt"]),
    "earrings": (2.4, 80, 10, ["14kw", "14ky", "14kr", "18kw", "18ky"]),
    "bangle": (9.6, 170, 16, ["14kw", "14ky", "18kw", "18ky"]),
    "necklace": (4.2, 85, 12, ["14kw", "14ky", "18kw", "18ky", "pt"]),
}
def subcat(cat, name):
    t = name.lower()
    if cat == "ring":
        # 센터스톤 키워드가 우선 — "Half-Eternity Pavé Solitaire"처럼 밴드(생크)가 파베/이터니티여도
        # 솔리테어·헤일로·쓰리스톤이면 약혼반지다. 웨딩밴드는 센터스톤 없는 밴드류만.
        if any(k in t for k in ("solitaire", "halo", "three stone", "side stone", "toi et moi")): return "engagementRing"
        if any(k in t for k in ("band", "eternity", "pavé", "channel")): return "weddingBand"
        return "engagementRing"
    if cat == "earrings":
        if "drop" in t or "journey" in t: return "drops"
        if "hoop" in t or "huggie" in t: return "huggies"
        return "studs"
    if cat == "bangle":
        if "bangle" in t: return "bangle"
        if "station" in t: return "chainBracelet"
        return "tennisBracelet"
    if cat == "necklace":
        if "tennis" in t: return "tennisNecklace"
        if any(k in t for k in ("station", "graduated", "eternity", "demi")): return "stationNecklace"
        return "pendant"
    return ""

def cell(r, i): return r[i].strip() if i < len(r) and r[i] else ""
def rows(p):
    with p.open(newline="", encoding="utf-8-sig") as f: return list(csv.reader(f))
def parse_imgs(v):
    # 구분자는 ASCII '|' 또는 전각 '｜'(스프레드시트 입력) — 동일 URL 중복은 제거
    seen, out = set(), []
    for p in v.replace("｜", "|").split("|"):
        p = p.strip()
        if p.startswith("http") and p not in seen:
            seen.add(p); out.append(p)
    return out

# --- keep each carousel scoped to one product family (drop mixed-SKU extras) ---
def _sig_from_code(code):
    groups = re.findall(r"\d{3,}", code or "")
    return max(groups, key=len) if groups else (code or "")
def _signature(url):
    u = unquote(url or "")
    m = re.search(r"/productimages/([^/]+)/", u) or re.search(r"/pid/([^/?#]+)", u)
    if m: return _sig_from_code(m.group(1))
    m = re.search(r"[/-](BE[A-Z0-9]+)[-_]", u)  # Brilliant Earth 렌더/상품 코드 (탑뷰·사이드샷 공통)
    if m: return m.group(1)
    m = re.search(r"/Custom/([^/]+)/", u)       # Blue Nile 팩샷 세트 코드
    if m: return m.group(1)
    m = re.search(r"/products/(\d+)/", u)       # BigCommerce 상품 id (jewelrypoint)
    if m: return m.group(1)
    return ""
def related_media(urls, ref=""):
    media = [u for u in urls if u.startswith("http")]
    if not media: return []
    rs = _signature(ref)
    if rs:
        same = [u for u in media if _signature(u) == rs]
        if same: return same
    ts = _signature(media[0])
    if not ts: return media[:1]           # non-coded hosts (VTO/BlueNile): keep cover only
    return [u for u in media if _signature(u) == ts]

# --- parse each CSV into (cat, en, zh, ref, [urls]) ---
def parse_engagement():
    out = []
    for r in rows(CSV["engagement"]):
        for nc, rc, ic in [(0, 1, 2), (4, 5, 6), (7, 8, 9)]:
            name = norm_name(cell(r, nc)); imgs = parse_imgs(cell(r, ic))
            if name and name not in ("Solitaire", "Halo", "Three Stone") and imgs:
                out.append(("ring", name, "", cell(r, rc), imgs))
    return out

def parse_table(key, cat):
    out = []; started = key != "necklaces"
    for r in rows(key if isinstance(key, Path) else CSV[key])[1:]:
        c0 = cell(r, 0)
        if key == "necklaces" and c0.startswith("Suggested Style"): started = True; continue
        if not started: continue
        raw = norm_name(c0)
        if cat == "necklace": raw = NECK_ALIAS.get(raw, raw)
        imgs = parse_imgs(cell(r, 3))
        if raw and imgs:
            out.append((cat, raw, cell(r, 1), cell(r, 2), imgs))
    return out

def parse_earrings():
    out = []
    for r in rows(CSV["earrings"])[1:]:
        stud = norm_name(cell(r, 0)); hoop = norm_name(cell(r, 3))
        if stud:
            nm = f"{stud} Studs" if stud in ("Solitaire", "Halo") else norm_name(f"{stud} Earrings")
            imgs = parse_imgs(cell(r, 6))
            if imgs: out.append(("earrings", nm, cell(r, 1), cell(r, 5), imgs))
        if hoop:
            imgs = parse_imgs(cell(r, 8))
            if imgs: out.append(("earrings", hoop, cell(r, 4), cell(r, 7), imgs))
    return out

def existing_id_map():
    """기존 styleSeedData.js의 ID를 (category, en 이름) 기준으로 고정한다.
    CSV 중간에 행이 삽입돼도 기존 스타일 번호가 밀리지 않게(서버 starter_designs·주문의
    스타일 참조 보존) — 새 스타일만 카테고리별 최대 번호 다음을 받는다."""
    if not OUT.exists(): return {}, {}
    m = re.search(r"export const styleSeedData = (\[.*\]);", OUT.read_text(encoding="utf-8"), re.S)
    if not m: return {}, {}
    ids, maxn = {}, {}
    for s in json.loads(m.group(1)):
        ids.setdefault((s["category"], s["name"]["en"]), []).append(s["id"])
        num = int(s["id"].rsplit("-", 1)[1])
        maxn[s["category"]] = max(maxn.get(s["category"], 0), num)
    return ids, maxn

def build():
    parsed = (parse_engagement() + parse_table("bands", "ring") + parse_earrings()
              + parse_table("bracelets", "bangle") + parse_table("necklaces", "necklace"))
    prefix = {"ring": "RING", "earrings": "EARR", "bangle": "BRAC", "necklace": "NECK"}
    prev_ids, maxn = existing_id_map()
    styles = []
    for cat, en, zh, ref, urls in parsed:
        en = product_title_for(ref, urls) or en   # SKU-based canonical name for products
        urls = related_media(urls, ref)           # one product family per carousel
        local = [p for p in (localize(u) for u in urls[:5]) if p]
        if not local:
            print(f"  (skip, no image) {en}"); continue
        bucket = prev_ids.get((cat, en))
        if bucket:
            sid = bucket.pop(0)                    # 기존 스타일 → 기존 ID 유지
        else:
            maxn[cat] = maxn.get(cat, 0) + 1       # 신규 스타일 → 다음 번호
            sid = f"{prefix[cat]}-{maxn[cat]:03d}"
        w, labor, lead, metals = DEFAULTS[cat]
        s = {
            "id": sid, "category": cat, "subcategory": subcat(cat, en),
            "coverImage": local[0], "media": [{"kind": "image", "src": p} for p in local],
            "mediaComplete": True, "metalOptions": metals, "estWeightG": w,
            "laborUsd": labor, "leadDays": lead, "availableForSale": True, "published": True,
            "supplierEvidence": ref or "CSV style import", "firstQuoteAt": "2026-06-27",
            "name": i18n(en, zh),
        }
        s.update({k: dict(v) for k, v in DETAIL.items()})
        if cat in FLEX: s["flexibleText"] = dict(FLEX[cat])
        styles.append(s)
    return styles

if __name__ == "__main__":
    DESIGNS.mkdir(parents=True, exist_ok=True)
    styles = build()
    payload = json.dumps(styles, ensure_ascii=False, indent=2)
    OUT.write_text("// Generated by scripts/import_style_csvs.py. Do not edit by hand.\n"
                   "export const styleSeedData = " + payload + ";\n", encoding="utf-8")
    from collections import Counter
    print(f"\nwrote {OUT} with {len(styles)} styles: {dict(Counter(s['category'] for s in styles))}")
