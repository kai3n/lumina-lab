// 라이브챗 지식베이스 — 서버(자동응답)와 위젯(빠른 질문 칩)이 공유하는 단일 소스.
// 사실은 사이트 실제 콘텐츠(가이드·인포·정책·카탈로그)에서 추출. 각 엔트리:
//   keywords: 다국어 소문자 부분일치 트리거
//   q:        칩/대표 질문 라벨(로케일별)
//   a:        답변(로케일별)
// 매칭은 위에서부터 첫 일치 — 구체적·카테고리별 항목을 위에 둔다.

export const FAQ = [
  {
    id: "engraving",
    keywords: ["engrav", "inscription", "initials inside", "각인", "이니셜 새", "레터링", "刻字", "镌刻", "grabado", "grabar"],
    q: { en: "Can I add an engraving?", ko: "각인을 넣을 수 있나요?", zh: "可以刻字吗？", es: "¿Puedo grabar un mensaje?" },
    a: {
      en: "Yes — up to 30 characters, inside the band for rings and bangles or on the back of a pendant (earrings confirmed at proposal). Note that engraved pieces are made personal to you, so they're non-returnable.",
      ko: "네 — 최대 30자까지, 링·뱅글은 밴드 안쪽, 펜던트는 뒷면에 새겨요(이어링은 제안 단계에서 확인). 각인 제품은 개인 맞춤이라 반품은 어렵습니다.",
      zh: "可以——最多 30 个字符，戒指与手镯刻在内圈，吊坠刻在背面（耳饰在方案阶段确认）。刻字为专属定制，故不可退货。",
      es: "Sí — hasta 30 caracteres, en el interior del aro para anillos y brazaletes o al reverso de un colgante (los aretes se confirman en la propuesta). Las piezas grabadas son personales, por lo que no admiten devolución.",
    },
  },
  {
    id: "necklace_length",
    keywords: ["necklace length", "chain length", "how long necklace", "choker", "matinee", "opera", "목걸이 길이", "체인 길이", "몇 cm", "项链长度", "链长", "largo del collar", "cadena"],
    q: { en: "What necklace length?", ko: "목걸이 길이는 어떻게 고르나요?", zh: "项链多长合适？", es: "¿Qué largo de collar?" },
    a: {
      en: "Common lengths: 16\"/40cm choker (base of the neck), 18\"/45cm princess (on the collarbone), 20\"/50cm matinee (just below), 22\"/55cm opera (upper chest). A pendant hangs about 2–3cm below the chain. 18\" is the most popular.",
      ko: "대표 길이: 16\"/40cm 초커(목 아래), 18\"/45cm 프린세스(쇄골 위), 20\"/50cm 마티네(쇄골 아래), 22\"/55cm 오페라(가슴 위). 펜던트는 체인보다 약 2–3cm 아래로 내려와요. 18\"가 가장 인기예요.",
      zh: "常见长度：16\"/40cm 锁骨链（颈根）、18\"/45cm 公主链（锁骨上）、20\"/50cm 马蒂尼（略下）、22\"/55cm 歌剧链（上胸）。吊坠约在链长下方 2–3cm。18\" 最受欢迎。",
      es: "Largos comunes: 40cm/16\" gargantilla (base del cuello), 45cm/18\" princesa (en la clavícula), 50cm/20\" matinée (justo debajo), 55cm/22\" ópera (pecho alto). Un colgante cae unos 2–3cm bajo la cadena. El de 18\" es el más popular.",
    },
  },
  {
    id: "bracelet_fit",
    keywords: ["bracelet size", "bangle size", "wrist", "how to measure bracelet", "팔찌 사이즈", "손목", "뱅글 사이즈", "手链尺寸", "手镯尺寸", "手腕", "talla de pulsera", "muñeca"],
    q: { en: "How do I size a bracelet?", ko: "팔찌 사이즈는 어떻게 재나요?", zh: "手链尺寸怎么量？", es: "¿Cómo mido una pulsera?" },
    a: {
      en: "Wrap a string around your wrist just below the wrist bone and measure the length, then add for fit: +1.0cm snug, +1.5cm comfort, +2.0cm loose. We stock wrist sizes 5.5\"–8.5\" and confirm the exact inner length with you.",
      ko: "손목뼈 바로 아래를 실로 감아 길이를 잰 뒤 착용감만큼 더해요: +1.0cm 딱 맞게, +1.5cm 편하게, +2.0cm 여유. 손목 5.5\"–8.5\"를 지원하고 정확한 안쪽 길이는 함께 확정해요.",
      zh: "用绳子绕手腕骨下方量出长度，再按松紧加量：+1.0cm 贴合、+1.5cm 舒适、+2.0cm 宽松。手腕 5.5\"–8.5\" 均可，具体内长与您确认。",
      es: "Rodea la muñeca con un hilo justo bajo el hueso y mide el largo; luego suma para el ajuste: +1.0cm ceñido, +1.5cm cómodo, +2.0cm holgado. Cubrimos muñecas de 5.5\"–8.5\" y confirmamos el largo interior contigo.",
    },
  },
  {
    id: "earrings",
    keywords: ["earring", "stud", "hoop", "huggie", "drop earring", "pierced", "clip on", "귀걸이", "이어링", "스터드", "후프", "귀 안 뚫", "耳环", "耳钉", "耳圈", "arete", "pendiente"],
    q: { en: "What earring styles?", ko: "이어링 종류가 어떻게 되나요?", zh: "有哪些耳饰款式？", es: "¿Qué estilos de aretes?" },
    a: {
      en: "We make studs (sit on the lobe), huggies/hoops, and drops/dangles (up to ~15mm and beyond). Pierced or clip-on both work — just tell us, and whether the pair must match. Popular picks: round studs, inside-out hoops, and halo drops.",
      ko: "스터드(귓불에 밀착), 허기·후프, 드롭·댕글(약 15mm 이상까지)을 만들어요. 피어싱·클립온 모두 가능하니 알려주시고, 좌우 매칭 필요 여부도요. 인기: 라운드 스터드, 인사이드아웃 후프, 헤일로 드롭.",
      zh: "我们提供耳钉（贴耳垂）、耳扣/耳圈、耳坠（约 15mm 及以上）。穿孔或夹式皆可，请告知，并说明是否需成对匹配。热门：圆钻耳钉、内外镶耳圈、光环耳坠。",
      es: "Hacemos studs (sobre el lóbulo), huggies/aros y colgantes (hasta ~15mm y más). Con o sin perforación, ambos sirven — dinos cuál y si el par debe coincidir. Populares: studs redondos, aros inside-out y drops con halo.",
    },
  },
  {
    id: "ring_size",
    keywords: ["ring size", "my size", "finger size", "resize", "resizing", "반지 사이즈", "반지 호수", "손가락", "사이즈 조절", "戒指尺寸", "戒指大小", "手寸", "改圈", "talla de anillo", "medida del dedo"],
    q: { en: "How do I find my ring size?", ko: "반지 사이즈는 어떻게 아나요?", zh: "如何知道戒指尺寸？", es: "¿Cómo sé mi talla de anillo?" },
    a: {
      en: "Measure the inner diameter of a ring that already fits, or wrap a string around your finger and match the length to our chart (US 4–11). We'll double-check with you during the order. Resizing later is available on request — we quote before any work begins.",
      ko: "지금 잘 맞는 반지의 안지름을 재거나, 실을 손가락에 감아 길이를 우리 표(US 4–11)에 맞춰보세요. 주문 중 함께 재확인해요. 이후 리사이즈는 요청 시 진행되며, 작업 전에 먼저 견적을 안내드려요.",
      zh: "量一枚合适戒指的内直径，或用绳绕手指对照我们的尺码表（US 4–11）。下单时会再次核对。之后如需改圈可按需申请，动工前先行报价。",
      es: "Mide el diámetro interior de un anillo que te quede bien, o rodea el dedo con un hilo y coteja el largo con nuestra tabla (US 4–11). Lo verificamos contigo durante el pedido. El ajuste posterior está disponible bajo pedido — cotizamos antes de empezar.",
    },
  },
  {
    id: "lab",
    keywords: ["lab grown", "lab-grown", "labgrown", "lab diamond", "lab created", "lab-created", "grown diamond", "real diamond", "synthetic", "natural vs", "mined", "cvd", "hpht", "fake", "랩그로운", "랩다이아", "랩 다이아", "천연", "진짜 다이아", "가짜", "실험실", "培育", "实验室", "人造", "真钻", "cultivado", "laboratorio"],
    q: { en: "Are lab diamonds real?", ko: "랩다이아몬드는 진짜인가요?", zh: "培育钻石是真的吗？", es: "¿Son reales los diamantes de laboratorio?" },
    a: {
      en: "Yes — a lab-grown diamond is a real diamond, physically and chemically identical to a mined one (Mohs 10 hardness, same fire) and it tests as a diamond because it is one. It's grown in weeks by CVD or HPHT instead of over a billion years. Every BeloveD stone is IGI or GIA certified.",
      ko: "네 — 랩그로운 다이아몬드는 진짜 다이아몬드예요. 채굴 다이아와 물리·화학적으로 동일하고(경도 모스 10, 같은 광채), 다이아 테스터에도 다이아로 나와요. 10억 년 대신 몇 주 만에 CVD·HPHT로 길러냅니다. 모든 스톤은 IGI 또는 GIA 인증이에요.",
      zh: "是的——培育钻石是真钻，与开采钻石在物理与化学上完全相同（莫氏 10 度、同样火彩），钻石测试仪也判定为钻石。它以 CVD 或 HPHT 数周培育而成，而非亿万年。BeloveD 每颗钻石均获 IGI 或 GIA 认证。",
      es: "Sí — un diamante de laboratorio es un diamante real, idéntico física y químicamente al extraído (dureza Mohs 10, mismo brillo) y da positivo en el probador porque lo es. Se cultiva en semanas por CVD o HPHT en vez de mil millones de años. Cada piedra de BeloveD está certificada por IGI o GIA.",
    },
  },
  {
    id: "big_stone",
    keywords: ["big stone", "large carat", "over 2 carat", "2ct", "3 carat", "큰 다이아", "큰 스톤", "2캐럿", "대형", "大钻", "两克拉", "piedra grande", "más de 2 quilates"],
    q: { en: "What about larger stones (2ct+)?", ko: "2캐럿 이상 큰 스톤은요?", zh: "2 克拉以上的大钻呢？", es: "¿Y las piedras grandes (2ct+)?" },
    a: {
      en: "For stones above 2ct we recommend CVD with disclosed post-growth color treatment — it's stable for everyday wear with far better availability, so you get a bigger, whiter look for the budget. We always send the certificate so nothing is hidden.",
      ko: "2캐럿을 넘는 스톤은 성장 후 컬러 처리(고지)된 CVD를 추천드려요 — 데일리 착용에 안정적이고 수급이 훨씬 좋아, 같은 예산으로 더 크고 화이트하게 만나실 수 있어요. 감정서를 항상 함께 드려 숨김이 없어요.",
      zh: "2 克拉以上，我们推荐经披露的成长后处理 CVD——日常佩戴稳定、供应更佳，同预算下更大更白。我们始终附上证书，绝不隐瞒。",
      es: "Para piedras de más de 2ct recomendamos CVD con tratamiento de color posterior declarado — estable para el uso diario y con mucha mejor disponibilidad, así logras un look más grande y blanco por tu presupuesto. Siempre enviamos el certificado; nada se oculta.",
    },
  },
  {
    id: "pricing",
    // 주의: 한국어 "얼마"·스페인어 "cuánto"는 "얼마나 걸려"/"cuánto tarda"(기간)와 충돌 →
    // 가격을 묻는 구체 표현만 트리거로 둔다.
    keywords: ["price", "pricing", "cost", "how much is", "how much does", "expensive", "cheap", "budget", "가격", "얼마예요", "얼마인가", "얼마죠", "얼마 정도", "비싸", "가격대", "예산", "价格", "多少钱", "费用", "预算", "precio", "cuesta", "cuánto vale", "presupuesto"],
    q: { en: "How much does it cost?", ko: "가격은 얼마인가요?", zh: "价格是多少？", es: "¿Cuánto cuesta?" },
    a: {
      en: "A comparable lab-grown diamond runs about half the price of a mined one, and because we sell atelier-direct the same spec is often well below Blue Nile or Brilliant Earth — the live comparison on our home page shows current ranges. Every total includes setting, stone, labor, shipping and insurance — no hidden fees. Tell me shape, carat and budget for a tailored quote.",
      ko: "동급 랩다이아는 채굴 대비 약 절반 가격이고, 아틀리에 직거래라 같은 사양이 Blue Nile·Brilliant Earth보다 훨씬 저렴한 경우가 많아요 — 홈 화면의 실시간 가격 비교에서 현재 범위를 보실 수 있어요. 모든 총액에 세팅·스톤·공임·배송·보험이 포함돼 숨은 비용이 없어요. 셰입·캐럿·예산을 알려주시면 맞춤 견적을 드릴게요.",
      zh: "同级培育钻约为开采钻的一半价格，且我们工作室直销，同规格常远低于 Blue Nile 或 Brilliant Earth——首页的实时价格对比可查看当前区间。每笔总价含镶嵌、钻石、工费、运费与保险，绝无隐藏费用。告诉我形状、克拉与预算即可报价。",
      es: "Un diamante de laboratorio comparable cuesta cerca de la mitad que uno extraído, y al vender directo del taller una misma especificación suele quedar muy por debajo de Blue Nile o Brilliant Earth — la comparación en vivo de nuestra página de inicio muestra los rangos actuales. Cada total incluye engaste, piedra, mano de obra, envío y seguro — sin cargos ocultos. Dime forma, quilates y presupuesto para cotizar.",
    },
  },
  {
    id: "discount",
    keywords: ["discount", "coupon", "promo", "code", "welcome", "sale", "할인", "쿠폰", "프로모", "코드", "折扣", "优惠", "优惠码", "descuento", "cupón", "código"],
    q: { en: "Any discounts or codes?", ko: "할인이나 코드가 있나요?", zh: "有折扣或优惠码吗？", es: "¿Hay descuentos o códigos?" },
    a: {
      en: "We keep prices honest year-round rather than run big sales, but a welcome discount (around 5%) is available for first orders. If you have a code, enter it and it'll be honored in your final proposal.",
      ko: "큰 세일 대신 연중 정직한 가격을 유지하지만, 첫 주문에는 웰컴 할인(약 5%)이 있어요. 코드가 있으시면 입력해 주세요, 최종 제안에 반영해 드려요.",
      zh: "我们全年保持诚实价格而非大促，但首单可享欢迎折扣（约 5%）。若有优惠码，请输入，会在最终方案中生效。",
      es: "Mantenemos precios honestos todo el año en vez de grandes rebajas, pero hay un descuento de bienvenida (alrededor del 5%) para el primer pedido. Si tienes un código, ingrésalo y se aplicará en tu propuesta final.",
    },
  },
  {
    id: "certification",
    keywords: ["certif", "igi", "gia", "grading report", "authentic", "인증", "감정서", "감정", "认证", "证书", "鉴定", "certifica", "informe"],
    q: { en: "Is it certified?", ko: "인증서가 있나요?", zh: "有证书吗？", es: "¿Está certificado?" },
    a: {
      en: "Every diamond ships with an independent IGI or GIA report covering the 4Cs, and the report number is laser-inscribed on the girdle. We verify that inscription against the certificate on video before shipping, and send you the number before production.",
      ko: "모든 다이아몬드는 4C를 담은 IGI 또는 GIA 독립 감정서와 함께 제공되고, 감정번호가 거들에 레이저 각인돼요. 배송 전 그 각인과 감정서를 영상으로 대조 확인하고, 제작 전 번호를 먼저 알려드려요.",
      zh: "每颗钻石都附独立 IGI 或 GIA 证书（涵盖 4C），证书编号激光刻于腰围。发货前我们会通过视频将刻号与证书核对，并在制作前先告知编号。",
      es: "Cada diamante se envía con un informe independiente de IGI o GIA con las 4C, y el número va grabado con láser en el cinturón. Verificamos esa inscripción contra el certificado en video antes de enviar, y te damos el número antes de producir.",
    },
  },
  {
    id: "shapes",
    keywords: ["shape", "round", "oval", "cushion", "emerald cut", "pear", "princess", "radiant", "marquise", "asscher", "셰입", "모양", "라운드", "오벌", "쿠션", "형태", "形状", "圆形", "椭圆", "forma", "redondo", "ovalado"],
    q: { en: "Which diamond shapes?", ko: "어떤 셰입이 있나요?", zh: "有哪些钻石形状？", es: "¿Qué formas de diamante hay?" },
    a: {
      en: "Nine shapes: round (most brilliance), oval, princess, emerald, pear, marquise, cushion, radiant and Asscher. Tip — round buys sparkle; oval, pear and marquise buy visual size on the same budget; for step cuts (emerald, Asscher) go one grade up on color and clarity. Round and oval are our most requested.",
      ko: "아홉 가지: 라운드(최고 광채), 오벌, 프린세스, 에메랄드, 페어, 마퀴즈, 쿠션, 래디언트, 아셔. 팁 — 라운드는 반짝임, 오벌·페어·마퀴즈는 같은 예산에 더 커 보이는 크기, 스텝컷(에메랄드·아셔)은 컬러·클래러티를 한 등급 올리세요. 가장 많이 찾는 건 라운드와 오벌이에요.",
      zh: "九种形状：圆形（最闪）、椭圆、公主方、祖母绿、梨形、马眼、垫形、雷迪恩、阿斯切。提示——圆形买闪耀，椭圆/梨形/马眼在同预算买视觉大小，阶梯切（祖母绿、阿斯切）请把颜色净度各升一级。最热门是圆形与椭圆。",
      es: "Nueve formas: redondo (más brillo), ovalado, princesa, esmeralda, pera, marquesa, cojín, radiante y Asscher. Consejo — el redondo compra destello; ovalado, pera y marquesa compran tamaño visual con el mismo presupuesto; para tallas escalonadas (esmeralda, Asscher) sube un grado en color y pureza. Los más pedidos: redondo y ovalado.",
    },
  },
  {
    id: "four_c",
    keywords: ["4c", "4 c", "cut", "color grade", "clarity", "carat", "grade", "vs1", "vvs", "eye clean", "컷", "컬러", "색상", "클래러티", "투명도", "캐럿", "등급", "切工", "颜色", "净度", "克拉", "corte", "claridad", "quilate"],
    q: { en: "How do I choose the 4Cs?", ko: "4C는 어떻게 고르나요?", zh: "如何选择 4C？", es: "¿Cómo elijo las 4C?" },
    a: {
      en: "Cut matters most for sparkle — choose Excellent/Ideal. Color D–F is icy; VS1–VS2 clarity is eye-clean (inclusions invisible without magnification). Our efficient sweet spot is Excellent cut + F–G color + VS1–VS2 clarity, and with lab pricing 1.5–2ct is a lovely size. Tell me if you prioritize size or quality and I'll balance it.",
      ko: "반짝임엔 컷이 가장 중요해요 — Excellent/Ideal 추천. 컬러는 D–F가 아이시하고, VS1–VS2면 육안상 깨끗해요(확대 없이 인클루전 안 보임). 효율 좋은 조합은 Excellent 컷 + F–G 컬러 + VS1–VS2 클래러티, 랩 가격으로 1.5–2캐럿이 예쁜 크기예요. 크기·품질 중 우선순위를 알려주시면 균형을 잡아드릴게요.",
      zh: "闪耀最看切工——选 Excellent/Ideal。颜色 D–F 冰透，净度 VS1–VS2 肉眼无瑕（无需放大即看不到内含物）。高性价比组合是 Excellent 切工 + F–G 颜色 + VS1–VS2 净度；以培育价，1.5–2 克拉是理想大小。告诉我更看重大小还是品质，我来平衡。",
      es: "La talla es lo que más brilla — elige Excellent/Ideal. Color D–F es puro; pureza VS1–VS2 es limpia a simple vista (inclusiones invisibles sin lupa). Nuestro punto óptimo: talla Excellent + color F–G + pureza VS1–VS2, y con precios de laboratorio 1.5–2ct es un tamaño precioso. Dime si priorizas tamaño o calidad y lo equilibro.",
    },
  },
  {
    id: "fluorescence",
    keywords: ["fluoresc", "형광", "블루 형광", "荧光", "fluorescencia"],
    q: { en: "Does fluorescence matter?", ko: "형광성은 중요한가요?", zh: "荧光重要吗？", es: "¿Importa la fluorescencia?" },
    a: {
      en: "For the icy-white look we suggest None to Faint fluorescence — stronger fluorescence can add a faint haze in some stones. We'll flag it on the certificate so your stone stays crisp and bright.",
      ko: "아이시한 화이트를 원하시면 형광성 None–Faint를 추천드려요 — 형광이 강하면 일부 스톤에서 옅은 뿌연 느낌이 생길 수 있어요. 감정서에 표시해 드려 스톤이 맑고 밝게 유지되도록 해요.",
      zh: "想要冰白效果，建议荧光 None–Faint——荧光过强在部分钻石中会带来轻微雾感。我们会在证书上标注，让您的钻石保持清透明亮。",
      es: "Para el look blanco puro sugerimos fluorescencia None a Faint — una fluorescencia fuerte puede dar un ligero velo en algunas piedras. Lo indicamos en el certificado para que tu piedra quede nítida y brillante.",
    },
  },
  {
    id: "metals",
    keywords: ["metal", "gold", "platinum", "18k", "14k", "white gold", "yellow gold", "rose gold", "메탈", "금속", "골드", "화이트골드", "옐로우", "로즈골드", "플래티넘", "백금", "金属", "白金", "黄金", "玫瑰金", "铂金", "oro", "platino", "blanco", "amarillo"],
    q: { en: "What metals can I choose?", ko: "메탈은 뭘 고를 수 있나요?", zh: "有哪些金属可选？", es: "¿Qué metales puedo elegir?" },
    a: {
      en: "18K and 14K gold in white, yellow and rose, plus platinum (PT950). 18K is richer in color, 14K a touch harder for daily wear, and platinum is naturally white, hypoallergenic and the most durable. White gold or platinum flatters an icy-white diamond best. Which tone are you drawn to?",
      ko: "18K·14K 골드를 화이트·옐로우·로즈로, 그리고 플래티넘(PT950)을 드려요. 18K는 색이 풍부하고 14K는 데일리로 조금 더 단단하며, 플래티넘은 자연 화이트에 저자극·최고 내구성이에요. 아이시 화이트 다이아엔 화이트골드나 플래티넘이 가장 잘 어울려요. 어떤 톤이 끌리시나요?",
      zh: "18K 与 14K 金（白/黄/玫瑰）以及铂金（PT950）。18K 色泽更浓，14K 更硬耐日常，铂金天然纯白、低致敏且最耐用。冰白钻石最配白金色或铂金。您偏爱哪种色调？",
      es: "Oro de 18K y 14K en blanco, amarillo y rosa, más platino (PT950). El 18K tiene color más intenso, el 14K es algo más duro para el diario, y el platino es blanco natural, hipoalergénico y el más resistente. El oro blanco o el platino lucen mejor con un diamante blanco. ¿Qué tono prefieres?",
    },
  },
  {
    id: "styles",
    keywords: ["popular", "styles", "designs", "catalog", "solitaire", "halo", "three stone", "tennis", "eternity", "pave", "recommend", "인기", "스타일", "디자인", "카탈로그", "솔리테어", "헤일로", "추천 디자인", "热门", "款式", "设计", "推荐款", "estilos", "diseños", "populares", "solitario"],
    q: { en: "What are your popular styles?", ko: "인기 스타일이 뭐예요?", zh: "有哪些热门款式？", es: "¿Cuáles son los estilos populares?" },
    a: {
      en: "Favorites: engagement rings (four-prong solitaire, hidden halo, three-stone), wedding bands (shared-prong eternity, French pavé, channel-set), studs and inside-out hoops, tennis bracelets and bangles, and solitaire/halo pendants and tennis necklaces. Every design is a starting point — share a reference and we adjust shape, scale, stones, metal and finish.",
      ko: "인기: 인게이지먼트 링(포프롱 솔리테어, 히든 헤일로, 스리스톤), 웨딩 밴드(셰어드프롱 에터니티, 프렌치 파베, 채널 세팅), 스터드·인사이드아웃 후프, 테니스 브레이슬릿·뱅글, 솔리테어·헤일로 펜던트와 테니스 네크리스. 모든 디자인은 출발점일 뿐 — 레퍼런스를 주시면 셰입·크기·스톤·메탈·마감을 조정해요.",
      zh: "热门：订婚戒（四爪单钻、隐藏光环、三石）、婚戒（共爪满钻、法式微镶、槽镶）、耳钉与内外镶耳圈、网球手链与手镯、单钻/光环吊坠与网球项链。每款皆为起点——发来参考图，我们可调整形状、大小、钻石、金属与工艺。",
      es: "Favoritos: anillos de compromiso (solitario de cuatro garras, halo oculto, tres piedras), alianzas (eternity de garra compartida, pavé francés, canal), studs y aros inside-out, pulseras y brazaletes tennis, y colgantes solitario/halo y collares tennis. Cada diseño es un punto de partida — envía una referencia y ajustamos forma, escala, piedras, metal y acabado.",
    },
  },
  {
    id: "process",
    keywords: ["how does it work", "process", "custom ring", "custom design", "customize", "custom order", "custom made", "bespoke", "how do i order", "place an order", "ordering", "make a ring", "get started", "steps", "과정", "어떻게 진행", "주문 제작", "맞춤", "의뢰", "시작", "단계", "流程", "定制", "怎么下单", "如何开始", "步骤", "proceso", "cómo funciona", "personalizado", "empezar"],
    q: { en: "How does a custom order work?", ko: "주문 제작은 어떻게 진행되나요?", zh: "定制流程是怎样的？", es: "¿Cómo funciona un pedido personalizado?" },
    a: {
      en: "1) Tell us the piece, stone and design (attach up to 5 reference photos/videos). 2) We send one proposal — certified stone, setting, all-inclusive price, timeline — usually within 24–48h; nothing is charged until you accept. 3) A 30% deposit locks the stone. 4) You approve the CAD. 5) We craft it, send finished-piece photos + certificate for your OK. 6) Balance, then insured shipping. Start from 'Start a custom request'.",
      ko: "1) 원하는 피스·스톤·디자인을 알려주세요(레퍼런스 사진·영상 최대 5개). 2) 인증 스톤·세팅·올인클루시브 가격·일정을 담은 제안을 보통 24–48시간 내 한 번 보내드려요(수락 전까진 청구 없음). 3) 30% 디파짓으로 스톤 확보. 4) CAD 승인. 5) 제작 후 완성품 사진·감정서로 확인. 6) 잔금 후 보험 배송. '주문제작 시작'에서 시작하세요.",
      zh: "1) 告诉我们款式、钻石与设计（可附最多 5 张参考图/视频）。2) 我们通常 24–48 小时内发送一份方案——认证钻石、镶嵌、全含价格、周期；接受前不收费。3) 30% 订金锁定钻石。4) 您确认 CAD。5) 制作后发送成品照片与证书供确认。6) 付尾款后含保险配送。从「开始定制」下单。",
      es: "1) Cuéntanos la pieza, piedra y diseño (adjunta hasta 5 fotos/videos). 2) Enviamos una propuesta — piedra certificada, engaste, precio todo incluido, plazo — normalmente en 24–48h; no se cobra hasta que aceptes. 3) El depósito del 30% asegura la piedra. 4) Apruebas el CAD. 5) La elaboramos y enviamos fotos + certificado para tu visto bueno. 6) El saldo y envío asegurado. Empieza en 'Iniciar pedido personalizado'.",
    },
  },
  {
    id: "lead_time",
    keywords: ["how long", "lead time", "when will", "delivery time", "timeline", "rush", "by my", "얼마나 걸려", "제작 기간", "언제 받", "소요", "기간", "多久", "多长时间", "交期", "什么时候", "cuánto tarda", "plazo", "tiempo de entrega"],
    q: { en: "How long does it take?", ko: "제작 기간은 얼마나 걸리나요?", zh: "需要多长时间？", es: "¿Cuánto tarda?" },
    a: {
      en: "Loose diamonds typically ship in 2–4 business days; a bespoke piece takes about 3–5 weeks depending on the design and setting. We confirm the exact timeline with your quote. If you have a date like an anniversary or proposal, tell me and we'll do our best to hit it.",
      ko: "루스 다이아몬드는 보통 2–4영업일 내 배송되고, 맞춤 제작은 디자인·세팅에 따라 약 3–5주 걸려요. 정확한 일정은 견적과 함께 확정해 드려요. 기념일이나 프러포즈 날짜가 있으시면 알려주세요, 맞춰드리도록 최선을 다할게요.",
      zh: "裸钻通常 2–4 个工作日发货；定制作品视设计与镶嵌约需 3–5 周。确切周期随报价确认。若有纪念日或求婚日期，请告诉我，我们尽力赶上。",
      es: "Los diamantes sueltos suelen enviarse en 2–4 días hábiles; una pieza a medida tarda unas 3–5 semanas según el diseño y el engaste. Confirmamos el plazo exacto con tu cotización. Si tienes una fecha como un aniversario o pedida, dímela y haremos lo posible por cumplirla.",
    },
  },
  {
    id: "shipping",
    keywords: ["shipping", "delivery", "ship to", "international", "worldwide", "tracking", "customs", "packaging", "배송", "택배", "해외 배송", "운송", "배송비", "포장", "配送", "运送", "国际", "物流", "包装", "envío", "entrega", "internacional"],
    q: { en: "How is shipping?", ko: "배송은 어떻게 되나요?", zh: "如何配送？", es: "¿Cómo es el envío?" },
    a: {
      en: "Free, fully insured, signature-required shipping on every order, worldwide, with tracking shared the moment your piece leaves the atelier. Packaging is discreet and unbranded, with the Beloved presentation box inside. Any duties, where applicable, are shown with your quote.",
      ko: "모든 주문에 무료·전액 보험·수령 서명 배송, 전 세계 배송이며, 아틀리에 출고 즉시 송장번호를 공유해요. 포장은 눈에 띄지 않는 무지 패키지에 Beloved 프레젠테이션 박스가 들어 있어요. 관세가 있는 경우 견적과 함께 안내해 드려요.",
      zh: "每笔订单均免费、全额保险、需签收，全球配送，作品一离开工作室即分享运单号。包装低调无品牌标识，内含 Beloved 礼盒。如涉关税，会随报价告知。",
      es: "Envío gratis, totalmente asegurado y con firma en cada pedido, a todo el mundo, con seguimiento en cuanto tu pieza sale del taller. El empaque es discreto y sin marca, con la caja de presentación Beloved dentro. Los aranceles, si aplican, se muestran con tu cotización.",
    },
  },
  {
    id: "returns",
    keywords: ["return", "refund", "exchange", "money back", "cancel", "반품", "환불", "교환", "취소", "退货", "退款", "换货", "取消", "devolución", "reembolso", "cambio", "cancelar"],
    q: { en: "What's the return policy?", ko: "반품 정책은 어떻게 되나요?", zh: "退货政策如何？", es: "¿Cuál es la política de devolución?" },
    a: {
      en: "Because every piece is made to your specification, custom orders are final sale after delivery, and the 30% deposit is non-refundable at every stage. You can cancel before production begins — the deposit covers the design work already done. Ready-to-ship items and loose diamonds are also final sale. If a piece arrives defective or doesn't match your approved spec, contact us and we'll repair or replace it under warranty.",
      ko: "모든 피스가 고객님 사양대로 제작되기 때문에 주문 제작 피스는 배송 후 최종 판매이며, 디파짓(30%)은 어느 단계에서도 환불되지 않아요. 제작 시작 전에는 취소할 수 있고, 디파짓은 이미 진행된 디자인 작업을 충당해요. 즉시 출고 상품·루스 다이아몬드도 최종 판매예요. 결함이 있거나 승인한 사양과 다르게 도착하면 연락 주세요 — 보증에 따라 수리·교체해 드려요.",
      zh: "每件作品都按你的规格制作，因此定制订单交付后为最终销售，订金（30%）在任何阶段均不退还。投产前可以取消 —— 订金用于抵付已完成的设计工作。现货商品与裸钻同为最终销售。若作品有缺陷或与确认规格不符，请联系我们，我们将按保修修复或更换。",
      es: "Como cada pieza se hace según tu especificación, los pedidos a medida son venta final tras la entrega, y el depósito (30%) no es reembolsable en ninguna etapa. Puedes cancelar antes de que empiece la producción — el depósito cubre el diseño ya realizado. Los artículos en stock y diamantes sueltos también son venta final. Si una pieza llega defectuosa o no coincide con tu especificación aprobada, contáctanos y la repararemos o reemplazaremos bajo garantía.",
    },
  },
  {
    id: "warranty",
    keywords: ["warranty", "guarantee", "lifetime", "repair", "insurance", "appraisal", "보증", "품질보증", "평생", "수리", "보험", "감정가", "保修", "保证", "终身", "维修", "保险", "评估", "garantía", "reparación", "seguro", "tasación"],
    q: { en: "Is there a warranty?", ko: "보증이 있나요?", zh: "有保修吗？", es: "¿Hay garantía?" },
    a: {
      en: "Yes — a lifetime manufacturing warranty covers defects like a loose setting or broken prong at no charge, plus free annual cleaning, polishing and prong checks (resizing is available on request, quoted before work begins). Everyday wear, loss, theft or accidental damage aren't covered, so we recommend insuring the piece — we provide appraisal documentation for that.",
      ko: "네 — 평생 제조 보증으로 세팅 헐거움·프롱 파손 같은 하자를 무상 처리하고, 연간 세척·광택·프롱 점검도 무료예요(리사이즈는 요청 시 견적 후 진행돼요). 일상 마모·분실·도난·사고 파손은 보증 대상이 아니라 보험 가입을 권해드리며, 이를 위한 감정 서류를 제공해요.",
      zh: "有——终身制造保修免费涵盖镶口松动、断爪等缺陷，另含免费年度清洗、抛光与检爪（改圈可按需申请，动工前先报价）。日常磨损、遗失、被盗或意外损坏不在保修内，故建议投保，我们提供评估文件以供投保。",
      es: "Sí — una garantía de fabricación de por vida cubre sin costo defectos como un engaste flojo o una garra rota, además de limpieza, pulido y revisión de garras anuales gratis (el ajuste de talla se cotiza antes de empezar). El desgaste, pérdida, robo o daño accidental no están cubiertos, así que recomendamos asegurar la pieza — entregamos documentación de tasación para ello.",
    },
  },
  {
    id: "payment",
    keywords: ["payment", "pay", "installment", "financ", "affirm", "klarna", "payment plan", "monthly payment", "deposit", "zelle", "venmo", "credit card", "how do i pay", "결제", "지불", "할부", "디파짓", "계약금", "송금", "카드", "分期付款", "付款", "支付", "分期", "定金", "信用卡", "pago", "pagar", "plazos", "depósito", "financiación", "tarjeta"],
    q: { en: "How do I pay?", ko: "결제는 어떻게 하나요?", zh: "如何付款？", es: "¿Cómo pago?" },
    a: {
      en: "A 30% deposit begins the order (non-refundable once paid) and the balance is due before shipping. We currently accept Zelle and Venmo (scan the QR or copy the recipient) — your payment memo must include the order number so we can confirm it — and secure card payment is coming soon. We never collect or store card numbers.",
      ko: "30% 디파짓으로 주문을 시작하고(결제 후 환불 불가) 잔금은 배송 전에 결제해요. 현재 Zelle와 Venmo를 받아요(QR 스캔 또는 수취인 복사) — 결제 메모에 주문번호가 있어야 확인이 돼요 — 안전한 카드 결제도 곧 지원돼요. 카드 번호는 절대 수집·저장하지 않아요.",
      zh: "30% 订金启动订单（支付后不退），尾款于发货前支付。目前接受 Zelle 与 Venmo（扫码或复制收款人）——付款备注须含订单号以便确认——安全银行卡支付即将上线。我们绝不收集或存储卡号。",
      es: "Un depósito del 30% inicia el pedido (no reembolsable una vez pagado) y el saldo se paga antes del envío. Aceptamos Zelle y Venmo (escanea el QR o copia el destinatario) — tu memo de pago debe incluir el número de pedido para confirmarlo — y el pago con tarjeta seguro llegará pronto. Nunca recopilamos ni almacenamos números de tarjeta.",
    },
  },
  {
    id: "care",
    keywords: ["clean", "care", "maintenance", "how to clean", "dull", "관리", "세척", "청소", "손질", "유지", "保养", "清洁", "清洗", "护理", "limpiar", "cuidado", "mantenimiento"],
    q: { en: "How do I care for it?", ko: "관리는 어떻게 하나요?", zh: "如何保养？", es: "¿Cómo la cuido?" },
    a: {
      en: "Soak in warm water with a little mild dish soap, brush gently behind the stone with a soft toothbrush, rinse and pat dry. Take it off for the gym, cleaning and swimming, and bring it in every 6–12 months for a free professional clean and prong check.",
      ko: "미지근한 물에 순한 주방세제를 조금 풀어 담근 뒤 부드러운 칫솔로 스톤 뒤쪽을 살살 닦고 헹궈 물기를 눌러 말려주세요. 운동·청소·수영 땐 빼두시고, 6–12개월마다 무료 전문 세척과 프롱 점검을 받으세요.",
      zh: "用温水加少量温和洗洁精浸泡，用软牙刷轻刷钻石背面，冲洗后按干。健身、打扫、游泳时请取下，每 6–12 个月来做免费专业清洗与检爪。",
      es: "Sumerge en agua tibia con un poco de jabón suave, cepilla con suavidad detrás de la piedra con un cepillo blando, enjuaga y seca con toques. Quítatela para el gimnasio, la limpieza y la piscina, y tráela cada 6–12 meses para una limpieza profesional gratis y revisión de garras.",
    },
  },
  {
    id: "discretion",
    keywords: ["discreet", "privacy", "private", "anonymous", "surprise", "gift secret", "익명", "프라이버시", "비밀", "서프라이즈", "选择隐私", "私密", "匿名", "惊喜", "discreto", "privacidad", "anónimo", "sorpresa"],
    q: { en: "Is it discreet/private?", ko: "비공개로 진행되나요?", zh: "会保密吗？", es: "¿Es discreto/privado?" },
    a: {
      en: "Absolutely. Shipping is unbranded and discreet, and our manufacturing partners receive only specs and reference images — your contact details are masked before anything is shared. If it's a surprise, tell me and we'll be careful with timing and messaging.",
      ko: "물론이에요. 배송은 브랜드 없이 눈에 띄지 않게 진행되고, 제작 파트너에겐 사양과 레퍼런스 이미지만 전달돼요 — 연락처는 공유 전에 마스킹됩니다. 서프라이즈라면 알려주세요, 타이밍과 메시지에 신경 쓸게요.",
      zh: "当然。配送无品牌标识、低调私密，制作伙伴只收到规格与参考图——您的联系方式在共享前会被隐去。若是惊喜，请告诉我，我们会注意时间与信息。",
      es: "Por supuesto. El envío es sin marca y discreto, y nuestros talleres solo reciben especificaciones e imágenes de referencia — tus datos de contacto se ocultan antes de compartir nada. Si es una sorpresa, dímelo y cuidaremos los tiempos y los mensajes.",
    },
  },
  {
    id: "consultation",
    keywords: ["talk to", "human", "agent", "appointment", "consult", "advisor", "call", "speak", "contact", "hours", "email", "상담원", "사람", "상담", "예약", "전화", "직원", "연락", "영업시간", "顾问", "人工", "咨询", "预约", "通话", "联系", "营业时间", "asesor", "persona", "cita", "consulta", "hablar", "horario", "contacto"],
    q: { en: "Can I talk to a person?", ko: "상담원과 얘기할 수 있나요?", zh: "可以和真人聊吗？", es: "¿Puedo hablar con una persona?" },
    a: {
      en: "Of course — real people, not bots. A BeloveD advisor reads every chat and will reply personally, usually within a few minutes during business hours (Mon–Sat, 9:00–18:00 PT). You can also email support@belovediamond.com (reply within 1 business day). Leave your email here and we'll follow up there too.",
      ko: "물론이죠 — 봇이 아니라 실제 사람이에요. BeloveD 어드바이저가 모든 채팅을 읽고 직접 답해드리며, 영업시간(월–토 9:00–18:00 PT)엔 보통 몇 분 안에 회신해요. support@belovediamond.com 으로 이메일도 가능해요(1영업일 내 회신). 이메일을 남겨주시면 그쪽으로도 이어서 연락드려요.",
      zh: "当然——是真人，不是机器人。BeloveD 顾问会阅读每段对话并亲自回复，营业时间（周一至周六 9:00–18:00 PT）通常几分钟内回复。也可邮件 support@belovediamond.com（1 个工作日内回复）。留下邮箱，我们也会通过邮件跟进。",
      es: "Claro — personas reales, no bots. Un asesor de BeloveD lee cada chat y responde en persona, normalmente en minutos durante el horario (lun–sáb, 9:00–18:00 PT). También puedes escribir a support@belovediamond.com (respuesta en 1 día hábil). Deja tu correo aquí y también te seguimos por ahí.",
    },
  },
];

const norm = (s) => String(s || "").toLowerCase().trim();

const HANDOFF_DISABLED_ANSWER = {
  en: "Live handoff is not available in chat right now. Email support@belovediamond.com (reply within 1 business day), or message us on Instagram at @belovediamondjewelry: https://www.instagram.com/belovediamondjewelry/",
  ko: "현재 채팅에서는 상담원 연결을 지원하지 않아요. support@belovediamond.com으로 이메일을 보내시거나(영업일 기준 1일 이내 답변), Instagram @belovediamondjewelry로 메시지를 보내 주세요: https://www.instagram.com/belovediamondjewelry/",
  zh: "目前聊天中暂不提供人工转接。请发送邮件至 support@belovediamond.com（1 个工作日内回复），或通过 Instagram @belovediamondjewelry 联系我们：https://www.instagram.com/belovediamondjewelry/",
  es: "La transferencia a una persona no está disponible en el chat por ahora. Escríbenos a support@belovediamond.com (respuesta en 1 día hábil) o por Instagram en @belovediamondjewelry: https://www.instagram.com/belovediamondjewelry/",
};

// 키워드 매칭 — 라틴 문자로 시작하는 키워드는 '단어 시작' 경계에서만 매칭한다.
// 짧은 키워드의 중간-단어 부분일치 오탐을 막는다: origin→igi, display→pay, Georgia→gia,
// flibbertigibbet→igi 등. 스템 접두(payment←pay, engraving←engrav)는 그대로 매칭.
// CJK and other non-Latin keywords do not have reliable word boundaries, so keep substring matching.
function keywordHit(t, k) {
  if (/^[a-z]/.test(k)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z])${esc}`).test(t);
  }
  return t.includes(k);
}

// 방문자 메시지를 지식베이스와 매칭 — 첫 일치 항목의 답변을 반환(없으면 null → 사람이 응대)
export function matchFaq(text, locale = "en", { humanHandoffEnabled = true } = {}) {
  const t = norm(text);
  if (!t) return null;
  for (const entry of FAQ) {
    if (entry.keywords.some((k) => keywordHit(t, k))) {
      const answer = entry.id === "consultation" && !humanHandoffEnabled
        ? (HANDOFF_DISABLED_ANSWER[locale] || HANDOFF_DISABLED_ANSWER.en)
        : (entry.a[locale] || entry.a.en);
      return { id: entry.id, answer };
    }
  }
  return null;
}

// 위젯 빠른 질문 칩 — 대표 질문 라벨(로케일별)
const CHIP_IDS = ["pricing", "lab", "shapes", "ring_size", "process", "shipping"];
export function faqChips(locale = "en") {
  return CHIP_IDS
    .map((id) => {
      const e = FAQ.find((x) => x.id === id);
      return e ? { id, label: e.q[locale] || e.q.en } : null;
    })
    .filter(Boolean);
}
