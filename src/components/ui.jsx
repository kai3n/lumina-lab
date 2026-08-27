import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Eye, X } from "lucide-react";
import { useLocale } from "../i18n.jsx";
import { getSettings } from "../lib/store.js";
import { uploadMedia } from "../lib/api.js";
import { track } from "../lib/track.js";

// 신규 화면 공통 빌딩블록. 라벨은 전부 useLocale().p 사전에서 — 4개 언어 지원.
// 샘플 사진은 jewelry-lineup.png 크롭(pos) 또는 단일 이미지(src).

// 가격은 미국 달러($)로만 표기한다 (2026-06-12 사용자 확정)
export function usd(n) {
  return `$${Number(n || 0).toLocaleString("en-US")}`;
}

// Shared by custom listboxes and the intake option grids. Returning null for
// unrelated keys lets callers preserve native button/input keyboard behavior.
export function listboxNavigationIndex(key, currentIndex, itemCount, columns = 1) {
  if (!itemCount) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  const step = key === "ArrowDown" ? columns
    : key === "ArrowUp" ? -columns
      : key === "ArrowRight" ? 1
        : key === "ArrowLeft" ? -1
          : 0;
  if (!step) return null;
  return (Math.max(0, currentIndex) + step + itemCount) % itemCount;
}

// GitHub Pages 등 하위 경로 배포 시 /assets/* 경로에 base를 붙인다 (dataURL은 그대로)
export function withBase(src) {
  const base = import.meta.env.BASE_URL || "/";
  if (!src || !src.startsWith("/") || base === "/") return src;
  return base.replace(/\/$/, "") + src;
}

// eager=true는 히어로/단독 노출처럼 즉시 보여야 할 때만. 그 외(그리드·카드)는 기본 lazy.
// fit="contain": 임의 업로드 콘텐츠(제안·CAD·QC·레퍼런스)처럼 잘리면 안 되는 이미지용.
// 모션 감소 선호 시 그리드 영상 자동재생을 끈다 (WCAG 2.2.2/2.3.3) — 포스터 정지 프레임만 표시
const REDUCED_MOTION = typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const prefersReducedMotion = () => REDUCED_MOTION;

// 기본 cover는 큐레이션된 정사각 제품샷 카드용.
export function MediaThumb({ media, ratio = "1 / 1", alt = "", eager = false, fit = "cover" }) {
  const fitClass = fit === "contain" ? "media-thumb is-contain" : "media-thumb";
  const src = media ? withBase(media.src) : null;
  // 깨진 이미지·만료 URL은 브라우저 기본 깨짐 아이콘 대신 기존 빈 카드로 폴백
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  if (!media || broken) return <div className="media-thumb media-empty" style={{ aspectRatio: ratio }} />;
  if (media.kind === "video") {
    // 그리드 영상 썸네일은 화면 밖에서 버퍼링하지 않도록 preload="none" — 보이면 autoplay
    return <video className={fitClass} style={{ aspectRatio: ratio }} src={src} poster={media.poster ? withBase(media.poster) : undefined} muted loop autoPlay={!REDUCED_MOTION} playsInline preload="none" onError={() => setBroken(true)} />;
  }
  if (media.pos) {
    return (
      <div
        className="media-thumb media-crop" role="img" aria-label={alt}
        style={{ backgroundImage: `url(${src})`, backgroundPosition: media.pos, aspectRatio: ratio }}
      />
    );
  }
  return <img className={fitClass} style={{ aspectRatio: ratio }} src={src} alt={alt} loading={eager ? "eager" : "lazy"} onError={() => setBroken(true)} decoding="async" />;
}

export function MediaZoomModal({ mediaItems, activeIndex = 0, onActiveIndexChange, onClose, alt = "" }) {
  const { p } = useLocale();
  const items = (Array.isArray(mediaItems) ? mediaItems : []).filter((item) => item?.src);
  const copy = p.styleDetail || {};
  const [internalIndex, setInternalIndex] = useState(activeIndex);
  const [inspectPosition, setInspectPosition] = useState({ x: 50, y: 50 });
  const [inspectZoom, setInspectZoom] = useState(3);
  const [isInspecting, setIsInspecting] = useState(false);

  const controlledIndex = onActiveIndexChange && Number.isFinite(activeIndex) ? activeIndex : internalIndex;
  const currentIndex = Math.min(Math.max(controlledIndex, 0), Math.max(items.length - 1, 0));
  const active = items[currentIndex] || items[0];

  useEffect(() => {
    setInternalIndex(activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    track("media_zoom", { path: window.location.pathname });
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  function setIndex(nextIndex) {
    if (!items.length) return;
    const normalized = (nextIndex + items.length) % items.length;
    setInternalIndex(normalized);
    onActiveIndexChange?.(normalized);
    setInspectPosition({ x: 50, y: 50 });
    setIsInspecting(false);
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }
      if (event.key === "ArrowLeft" && items.length > 1) {
        event.preventDefault();
        setIndex(currentIndex - 1);
      }
      if (event.key === "ArrowRight" && items.length > 1) {
        event.preventDefault();
        setIndex(currentIndex + 1);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [currentIndex, items.length, onClose]);

  if (!active) return null;

  const activeSrc = withBase(active.src);
  const isVideo = active.kind === "video";
  const canNavigate = items.length > 1;
  const mediaPosition = active.pos || "center";

  function updateInspectPosition(event) {
    if (isVideo) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setInspectPosition({
      x: Math.min(100, Math.max(0, x)),
      y: Math.min(100, Math.max(0, y)),
    });
    setIsInspecting(true);
  }

  return (
    <div
      className="beloved-inspect-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={alt || copy.closeViewer || "Media viewer"}
      onClick={onClose}
    >
      <div className="beloved-inspect-panel" onClick={(event) => event.stopPropagation()}>
        <header className="beloved-inspect-bar">
          <span className="beloved-inspect-count">{currentIndex + 1} / {items.length}</span>
          <div className="beloved-inspect-tools">
            {!isVideo && (
              <div className="beloved-inspect-zoom-levels" aria-label={copy.zoomIn || "Zoom in"}>
                {[2, 3, 4].map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={Math.round(inspectZoom) === level ? "active" : ""}
                    onClick={() => {
                      setInspectZoom(level);
                      setIsInspecting(true);
                    }}
                  >
                    {level}x
                  </button>
                ))}
              </div>
            )}
            <button className="beloved-inspect-close" type="button" aria-label={copy.closeViewer || "Close media viewer"} onClick={onClose}>
              <X size={26} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="beloved-inspect-stage">
          {canNavigate && (
            <button className="beloved-inspect-arrow is-prev" type="button" aria-label={copy.previousMedia || "Previous media"} onClick={() => setIndex(currentIndex - 1)}>
              <ChevronLeft size={36} strokeWidth={1.55} aria-hidden="true" />
            </button>
          )}

          {isVideo ? (
            <video
              className="beloved-inspect-video"
              src={activeSrc}
              poster={active.poster ? withBase(active.poster) : undefined}
              controls
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : (
            <figure
              className={`containerZoom beloved-inspect-figure active${isInspecting ? " is-inspecting" : ""}`}
              style={{
                backgroundImage: isInspecting ? `url("${activeSrc}")` : "none",
                backgroundPosition: `${inspectPosition.x}% ${inspectPosition.y}%`,
                backgroundSize: `${inspectZoom * 100}%`,
              }}
              onPointerMove={updateInspectPosition}
              onPointerDown={updateInspectPosition}
              onPointerLeave={() => setIsInspecting(false)}
            >
              <img
                id="imageZoom"
                className="beloved-inspect-image"
                src={activeSrc}
                alt={alt}
                style={{ objectPosition: mediaPosition, opacity: isInspecting ? 0 : 1 }}
                draggable="false"
              />
            </figure>
          )}

          {canNavigate && (
            <button className="beloved-inspect-arrow is-next" type="button" aria-label={copy.nextMedia || "Next media"} onClick={() => setIndex(currentIndex + 1)}>
              <ChevronRight size={36} strokeWidth={1.55} aria-hidden="true" />
            </button>
          )}

          {!isVideo && <span className="beloved-inspect-hint">{copy.zoomMove || "Move to inspect"}</span>}
        </div>

        {canNavigate && (
          <div className="beloved-inspect-progress" aria-hidden="true">
            {items.map((item, index) => (
              <button
                key={`${item.src}-${index}`}
                type="button"
                className={index === currentIndex ? "active" : ""}
                onClick={() => setIndex(index)}
                tabIndex={-1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
// 별점 표시 — 0.5 단위(평균 등 임의 소수 포함)를 별 폭 클리핑으로 렌더
export function Stars({ value = 5, className = "" }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <span className={`stars${className ? ` ${className}` : ""}`} role="img" aria-label={`${v} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span className="star" key={n} aria-hidden="true">
          ★<span className="star-fill" style={{ width: `${Math.max(0, Math.min(1, v - n + 1)) * 100}%` }}>★</span>
        </span>
      ))}
    </span>
  );
}

export function StatusBadge({ status }) {
  const { p } = useLocale();
  return <span className={`status-badge st-${status}`}>{p.status[status] || status}</span>;
}

// steps: [{key,label}], currentIndex: 진행 인덱스 (-1이면 미시작)
export function Stepper({ steps, currentIndex }) {
  return (
    <ol className="stepper">
      {steps.map((step, i) => (
        <li key={step.key} className={i < currentIndex ? "done" : i === currentIndex ? "current" : ""}>
          <span className="dot" />
          <span className="step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function EmptyNote({ children }) {
  return <p className="empty-note">{children}</p>;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDateValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateValue(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDisplayDate(value) {
  const date = parseDateValue(value);
  if (!date) return "";
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()}`;
}

function calendarCopy(locale) {
  const copy = {
    en: { clear: "Clear", today: "Today", previous: "Previous month", next: "Next month" },
    ko: { clear: "지우기", today: "오늘", previous: "이전 달", next: "다음 달" },
    zh: { clear: "清除", today: "今天", previous: "上个月", next: "下个月" },
    es: { clear: "Borrar", today: "Hoy", previous: "Mes anterior", next: "Mes siguiente" },
  };
  return copy[locale] || copy.en;
}

function calendarCells(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const firstCell = new Date(year, month, 1 - firstDay);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return {
      date,
      inMonth: date.getMonth() === month,
      value: toDateValue(date),
    };
  });
}

export function LuxurySelect({
  value,
  onChange,
  options,
  placeholder = "",
  ariaLabel,
  onFocus,
  disabled = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = useId();
  const selected = options.find((option) => String(option.value) === String(value));
  const label = selected?.label || placeholder;
  const accessibleName = ariaLabel || placeholder || "Select an option";
  const enabledIndices = options.reduce((indices, option, index) => {
    if (!option.disabled) indices.push(index);
    return indices;
  }, []);

  function focusTrigger() {
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function initialFocusIndex(direction = 1) {
    const selectedIndex = options.findIndex((option) => (
      !option.disabled && String(option.value) === String(value)
    ));
    if (selectedIndex >= 0) return selectedIndex;
    return direction < 0 ? enabledIndices.at(-1) ?? -1 : enabledIndices[0] ?? -1;
  }

  function openListbox(direction = 1) {
    if (disabled || enabledIndices.length === 0) return;
    setFocusedIndex(initialFocusIndex(direction));
    setOpen(true);
  }

  function closeListbox({ returnFocus = false } = {}) {
    setOpen(false);
    if (returnFocus) focusTrigger();
  }

  useEffect(() => {
    if (!open || focusedIndex < 0) return;
    optionRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeListbox({ returnFocus: true });
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(option) {
    if (option.disabled) return;
    onChange(option.value);
    closeListbox({ returnFocus: true });
  }

  function preview(option, event) {
    event.preventDefault();
    event.stopPropagation();
    option.onPreview?.();
    closeListbox({ returnFocus: true });
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onFocus?.();
      openListbox(event.key === "ArrowUp" || event.key === "End" ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onFocus?.();
      if (open) closeListbox();
      else openListbox();
    }
  }

  function handleOptionKeyDown(event, optionIndex) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeListbox({ returnFocus: true });
      return;
    }
    if (event.key === "Tab") {
      closeListbox();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[optionIndex]);
      return;
    }
    const enabledPosition = Math.max(0, enabledIndices.indexOf(optionIndex));
    const nextPosition = listboxNavigationIndex(event.key, enabledPosition, enabledIndices.length);
    if (nextPosition == null) return;
    event.preventDefault();
    setFocusedIndex(enabledIndices[nextPosition]);
  }

  return (
    <div className={`lux-select ${open ? "is-open" : ""} ${className}`} ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className="lux-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={accessibleName}
        disabled={disabled}
        onFocus={onFocus}
        onClick={() => {
          if (disabled) return;
          onFocus?.();
          if (open) closeListbox();
          else openListbox();
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={selected ? "lux-select-value" : "lux-select-value is-placeholder"}>{label}</span>
        <ChevronDown className="lux-select-caret" size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <ul id={listboxId} className="lux-select-list" role="listbox" aria-label={accessibleName} hidden={!open}>
        {options.map((option, optionIndex) => {
          const active = String(option.value) === String(value);
          const hasRichContent = option.media || option.onPreview;
          return (
            <li key={option.value || option.label} role="none">
              <div className={`lux-select-option-row ${hasRichContent ? "has-rich-content" : ""}`}>
                <button
                  type="button"
                  ref={(node) => { optionRefs.current[optionIndex] = node; }}
                  role="option"
                  aria-selected={active}
                  className={`lux-select-option-button ${active ? "is-active" : ""}`}
                  disabled={option.disabled}
                  tabIndex={open && focusedIndex === optionIndex ? 0 : -1}
                  onClick={() => choose(option)}
                  onKeyDown={(event) => handleOptionKeyDown(event, optionIndex)}
                >
                  {option.media && (
                    <span className="lux-select-option-thumb" aria-hidden="true">
                      <MediaThumb media={option.media} alt="" />
                    </span>
                  )}
                  <span className="lux-select-option-text">{option.label}</span>
                </button>
                {option.onPreview && (
                  <button
                    type="button"
                    className="lux-select-preview-button"
                    aria-label={`${option.previewLabel || "Preview"} ${option.label}`}
                    title={`${option.previewLabel || "Preview"} ${option.label}`}
                    tabIndex={open ? 0 : -1}
                    onClick={(event) => preview(option, event)}
                  >
                    <Eye size={16} strokeWidth={2} aria-hidden="true" />
                    <span>{option.previewLabel || "Preview"}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LuxuryDatePicker({
  value,
  onChange,
  placeholder = "mm/dd/yyyy",
  ariaLabel,
}) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [calendarMaxHeight, setCalendarMaxHeight] = useState(null);
  const selectedDate = parseDateValue(value);
  const [viewMonth, setViewMonth] = useState(() => selectedDate || new Date());
  const ref = useRef(null);
  const copy = calendarCopy(locale);
  const today = new Date();
  const todayValue = toDateValue(today);
  const selectedValue = selectedDate ? toDateValue(selectedDate) : "";
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(viewMonth);
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => (
    new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 5, 21 + index))
  ));

  useEffect(() => {
    if (selectedDate) setViewMonth(selectedDate);
  }, [value]);

  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const calendarHeight = 408;
    const viewportGap = 16;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldDropUp = spaceBelow < calendarHeight && spaceAbove > spaceBelow;
    const available = (shouldDropUp ? spaceAbove : spaceBelow) - viewportGap;
    setDropUp(shouldDropUp);
    setCalendarMaxHeight(Math.max(300, Math.min(calendarHeight, available)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function shiftMonth(delta) {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function selectDate(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className={`lux-date ${open ? "is-open" : ""} ${dropUp ? "drops-up" : ""}`} ref={ref}>
      <button
        type="button"
        className="lux-date-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel || placeholder}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value ? "lux-date-value" : "lux-date-value is-placeholder"}>{formatDisplayDate(value) || placeholder}</span>
        <CalendarDays className="lux-date-icon" size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      <div
        className="lux-calendar"
        role="dialog"
        aria-label={ariaLabel || placeholder}
        style={calendarMaxHeight ? { "--lux-calendar-max-height": `${calendarMaxHeight}px` } : undefined}
      >
        <div className="lux-calendar-head">
          <strong>{monthLabel}</strong>
          <div className="lux-calendar-nav">
            <button type="button" aria-label={copy.previous} onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={17} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" aria-label={copy.next} onClick={() => shiftMonth(1)}>
              <ChevronRight size={17} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="lux-calendar-grid lux-calendar-weekdays">
          {weekdayLabels.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
        </div>
        <div className="lux-calendar-grid">
          {calendarCells(viewMonth).map((cell) => (
            <button
              type="button"
              key={cell.value}
              className={`lux-calendar-day ${cell.inMonth ? "" : "is-muted"} ${cell.value === todayValue ? "is-today" : ""} ${cell.value === selectedValue ? "is-selected" : ""}`}
              onClick={() => selectDate(cell.value)}
            >
              {cell.date.getDate()}
            </button>
          ))}
        </div>
        <div className="lux-calendar-actions">
          <button type="button" onClick={() => { onChange(""); setOpen(false); }}>{copy.clear}</button>
          <button type="button" onClick={() => selectDate(todayValue)}>{copy.today}</button>
        </div>
      </div>
    </div>
  );
}

// 샘플 라이브러리(영구 저장) + 파일 업로드. 이미지는 브라우저에서 리사이즈/압축한 뒤
// R2로 직행 업로드해 publicUrl을 저장한다. 서버가 없으면(정적 데모) 기존 로컬 경로로
// 폴백: 이미지는 base64, 영상은 localStorage를 터뜨리지 않도록 blob URL preview.
const SAMPLE_LIBRARY = [
  { kind: "image", src: "/assets/lineup-ring.png", labelKey: "sol" },
  { kind: "image", src: "/assets/lineup-band.png", labelKey: "band" },
  { kind: "image", src: "/assets/lineup-pendant.png", labelKey: "pendant" },
  { kind: "image", src: "/assets/lineup-studs.png", labelKey: "studs" },
  { kind: "image", src: "/assets/lineup-bracelet.png", labelKey: "bracelet" },
  { kind: "image", src: "/assets/lab-diamond-tweezers.webp", labelKey: "loose" },
  { kind: "video", src: "/assets/diamond-noir-white.mp4", labelKey: "video" },
];

const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_TARGET_BYTES = 650 * 1024;
const IMAGE_MIN_QUALITY = 0.58;
const IMAGE_START_QUALITY = 0.86;
const MAX_UPLOAD_MB = 30; // 이미지·영상 공통 원본 상한 — 초과 파일은 업로드 자체를 막는다

function mediaKindFromFile(file) {
  const name = file.name || "";
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name)) return "image";
  return null;
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function readBlobAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("fileReadFailed"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function loadImageFromFile(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).then((bitmap) => ({
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height),
      close: () => bitmap.close?.(),
    }));
  }

  return readBlobAsDataURL(file).then((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      draw: (ctx, width, height) => ctx.drawImage(img, 0, 0, width, height),
      close: () => {},
    });
    img.onerror = reject;
    img.src = src;
  }));
}

// Optional/local-demo media may fall back to a local preview. Server-backed
// callers use MediaPicker.remoteRequired, which bypasses this helper so upload
// failures can never masquerade as a persisted attachment.
async function uploadOrNull(blob, scope, contentType) {
  try {
    return await uploadMedia(blob, { scope, contentType });
  } catch {
    return null;
  }
}

function isDurableMediaUrl(src) {
  return /^(https?:\/\/|\/(?!\/))/i.test(String(src || ""));
}

async function optimizeImageFile(file, scope, remoteRequired) {
  const image = await loadImageFromFile(file);
  const originalWidth = image.width;
  const originalHeight = image.height;
  const canvas = document.createElement("canvas");
  let maxDimension = IMAGE_MAX_DIMENSION;
  let width = originalWidth;
  let height = originalHeight;
  let blob = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
    width = Math.max(1, Math.round(originalWidth * scale));
    height = Math.max(1, Math.round(originalHeight * scale));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, width, height);
    image.draw(ctx, width, height);

    let quality = IMAGE_START_QUALITY;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
    while (blob && blob.size > IMAGE_TARGET_BYTES && quality > IMAGE_MIN_QUALITY) {
      quality = Math.max(IMAGE_MIN_QUALITY, quality - 0.08);
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }
    if (!blob || blob.size <= IMAGE_TARGET_BYTES || maxDimension <= 900) break;
    maxDimension = Math.max(900, Math.round(maxDimension * 0.82));
  }
  image.close();
  if (!blob) throw new Error("imageOptimizeFailed");
  let src;
  if (remoteRequired) {
    try {
      src = await uploadMedia(blob, { scope, contentType: "image/jpeg" });
      if (!isDurableMediaUrl(src)) throw new Error("invalidUploadUrl");
    } catch (cause) {
      throw new Error("uploadFailed", { cause });
    }
  } else {
    src = (await uploadOrNull(blob, scope, "image/jpeg")) || (await readBlobAsDataURL(blob));
  }
  return {
    kind: "image",
    src,
    name: file.name || "reference.jpg",
    size: blob.size,
    originalSize: file.size,
    width,
    height,
    optimized: blob.size < file.size || width !== originalWidth || height !== originalHeight,
  };
}

// 영상 첫 프레임(0.1s) 캡처 → JPEG 포스터. 실패해도 업로드는 계속(포스터는 최선노력).
function captureVideoPoster(file) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (blob) => { if (!settled) { settled = true; URL.revokeObjectURL(url); resolve(blob); } };
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    v.onloadedmetadata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { finish(null); } };
    v.onseeked = async () => {
      try {
        const w = Math.min(800, v.videoWidth || 800);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = Math.max(1, Math.round((v.videoHeight || w) * (w / (v.videoWidth || w))));
        canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
        finish(await canvasToBlob(canvas, "image/jpeg", 0.8));
      } catch { finish(null); }
    };
    v.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 4000);
  });
}

// 서버(media.js)가 받는 영상 형식만 업로드 시도 — 브라우저가 type을 비워 보내는
// 파일은 확장자로 보정하고, 매칭이 없으면 업로드 없이 로컬 프리뷰로 남긴다.
const VIDEO_UPLOAD_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const VIDEO_EXT_TYPES = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
function videoContentType(file) {
  const type = (file.type || "").toLowerCase();
  if (VIDEO_UPLOAD_TYPES.has(type)) return type;
  const ext = (file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return VIDEO_EXT_TYPES[ext] || null;
}

async function prepareVideoFile(file, scope, remoteRequired) {
  const base = {
    kind: "video",
    name: file.name || "reference-video",
    size: file.size,
    originalSize: file.size,
    optimized: true,
  };
  const contentType = videoContentType(file);
  let uploaded = null;
  if (contentType && remoteRequired) {
    try {
      uploaded = await uploadMedia(file, { scope, contentType });
      if (!isDurableMediaUrl(uploaded)) throw new Error("invalidUploadUrl");
    } catch (cause) {
      throw new Error("uploadFailed", { cause });
    }
  } else if (contentType) {
    uploaded = await uploadOrNull(file, scope, contentType);
  } else if (remoteRequired) {
    throw new Error("unsupportedType");
  }
  // 포스터 썸네일 — 그리드/목록은 이걸 먼저 그리고, 원본 영상은 재생될 때만 내려받는다
  const posterBlob = await captureVideoPoster(file);
  const poster = posterBlob ? await uploadOrNull(posterBlob, scope, "image/jpeg") : null;
  const withPoster = poster ? { poster } : {};
  if (uploaded) return { ...base, src: uploaded, ...withPoster };
  return { ...base, src: URL.createObjectURL(file), transient: true, ...withPoster };
}

const REQUIRED_UPLOAD_COPY = {
  en: "The upload did not finish. Check your connection and retry the file before continuing.",
  ko: "업로드가 완료되지 않았습니다. 연결 상태를 확인한 뒤 계속하기 전에 파일을 다시 올려주세요.",
  zh: "文件上传未完成。请检查网络并重新上传后再继续。",
  es: "La carga no se completó. Revisa tu conexión y vuelve a subir el archivo antes de continuar.",
};

// Parent contract:
// - remoteRequired: only durable http(s)/same-origin URLs are emitted through onChange.
// - onBusyChange: lets a workflow disable navigation/submission while work runs.
// - onErrorChange: mirrors the visible actionable error; an empty string clears it.
// The defaults preserve intentional static-demo/local-preview behavior.
export function MediaPicker({
  value,
  onChange,
  maxItems = 5,
  showSamples = true,
  previewMode = "thumb",
  scope = "reference",
  remoteRequired = false,
  onBusyChange,
  onErrorChange,
}) {
  const { p, locale } = useLocale();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const busyCallbackRef = useRef(onBusyChange);
  const errorCallbackRef = useRef(onErrorChange);
  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  const requiredFailureRef = useRef(false);
  const items = Array.isArray(value) ? value : [];
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const hasLimit = Number.isFinite(maxItems);
  const remainingSlots = hasLimit ? Math.max(0, maxItems - items.length) : Infinity;
  const isFull = hasLimit && remainingSlots <= 0;

  useEffect(() => {
    busyCallbackRef.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => {
    errorCallbackRef.current = onErrorChange;
  }, [onErrorChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    busyCallbackRef.current?.(busy);
  }, [busy]);

  useEffect(() => {
    errorCallbackRef.current?.(error);
  }, [error]);

  useEffect(() => () => {
    busyCallbackRef.current?.(false);
    errorCallbackRef.current?.("");
  }, []);

  useEffect(() => {
    if (remoteRequired && items.some((item) => (
      item?.transient || !isDurableMediaUrl(item?.src)
    ))) {
      requiredFailureRef.current = true;
      setError(REQUIRED_UPLOAD_COPY[locale] || REQUIRED_UPLOAD_COPY.en);
    }
  }, [items, locale, remoteRequired]);

  function changeItems(nextItems) {
    setError(
      remoteRequired && requiredFailureRef.current
        ? REQUIRED_UPLOAD_COPY[locale] || REQUIRED_UPLOAD_COPY.en
        : "",
    );
    setNotice("");
    onChange(nextItems);
  }

  function toggleSample(item) {
    if (!showSamples) return;
    const exists = items.some((m) => m.src === item.src && m.pos === item.pos);
    const media = { kind: item.kind, src: item.src, ...(item.pos ? { pos: item.pos } : {}) };
    if (!exists && items.length >= maxItems) {
      setError(p.picker.maxError(maxItems));
      return;
    }
    if (!exists && remoteRequired && !isDurableMediaUrl(item.src)) {
      requiredFailureRef.current = true;
      setError(REQUIRED_UPLOAD_COPY[locale] || REQUIRED_UPLOAD_COPY.en);
      return;
    }
    changeItems(exists ? items.filter((m) => !(m.src === item.src && m.pos === item.pos)) : [...items, media]);
  }
  async function prepareFile(file) {
    const kind = mediaKindFromFile(file);
    if (!kind) throw new Error("unsupportedType");
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error("fileTooLarge");
    if (kind === "video") return prepareVideoFile(file, scope, remoteRequired);
    return optimizeImageFile(file, scope, remoteRequired);
  }

  // 이미지·영상 모두 허용. 이미지는 작게 압축해 R2로, 영상은 원본을 R2로 올린다.
  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (busy) return;
    if (remainingSlots <= 0) {
      setError(p.picker.maxError(maxItems));
      return;
    }
    const selected = files.slice(0, remainingSlots);
    const operation = ++operationRef.current;
    setBusy(true);
    setError("");
    setNotice(p.picker.optimizing || "");
    try {
      const results = await Promise.allSettled(selected.map(prepareFile));
      const added = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      if (!mountedRef.current || operation !== operationRef.current) return;
      const failed = results.find((result) => result.status === "rejected")?.reason;
      if (remoteRequired) requiredFailureRef.current = Boolean(failed);
      if (files.length > remainingSlots) setError(p.picker.maxError(maxItems));
      else if (failed?.message === "fileTooLarge") setError(p.picker.fileError(MAX_UPLOAD_MB));
      else if (failed?.message === "unsupportedType") setError(p.picker.typeError);
      else if (failed?.message === "uploadFailed") setError(REQUIRED_UPLOAD_COPY[locale] || REQUIRED_UPLOAD_COPY.en);
      else if (failed) setError(p.picker.optimizeError || p.picker.typeError);
      if (added.length) {
        const currentItems = itemsRef.current;
        const currentSlots = hasLimit ? Math.max(0, maxItems - currentItems.length) : added.length;
        const accepted = added.slice(0, currentSlots);
        if (accepted.length < added.length) setError(p.picker.maxError(maxItems));
        if (accepted.length) onChange([...currentItems, ...accepted]);
        const compressed = accepted.filter((item) => item.kind === "image" && item.optimized).length;
        // videoNotice("가벼운 미리보기로 첨부")는 업로드 실패로 로컬 blob에 남은 영상에만 해당
        const previewVideos = accepted.filter((item) => item.kind === "video" && item.transient).length;
        setNotice(
          compressed > 0
            ? p.picker.optimizedNotice(compressed)
            : previewVideos > 0
              ? p.picker.videoNotice
              : "",
        );
      }
    } finally {
      if (mountedRef.current && operation === operationRef.current) setBusy(false);
    }
  }
  function handleFile(e) { addFiles(e.target.files); e.target.value = ""; }
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    if (isFull) {
      setError(p.picker.maxError(maxItems));
      return;
    }
    addFiles(e.dataTransfer?.files);
  }

  return (
    <div className="form-stack">
      {/* 큰 드래그&드롭 영역 (히어로) — 클릭하면 파일 선택창. 어르신 벤더가 폰 사진/영상을 끌어다 놓기 */}
      <input
        ref={inputRef}
        className="visually-hidden-file-input"
        type="file"
        accept="image/*,video/*"
        multiple
        disabled={busy || isFull}
        onChange={handleFile}
      />
      <button
        type="button"
        className={`drop-zone ${dragOver ? "is-over" : ""} ${isFull ? "is-full" : ""}`}
        aria-busy={busy}
        aria-disabled={busy || isFull}
        disabled={busy}
        onClick={() => {
          if (isFull) {
            setError(p.picker.maxError(maxItems));
            return;
          }
          inputRef.current?.click();
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <svg className="drop-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 16V4M12 4l-5 5M12 4l5 5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 20h14" strokeLinecap="round" />
        </svg>
        <span className="drop-title">{busy ? p.picker.optimizing : isFull ? p.picker.maxError(maxItems) : p.picker.dropHint}</span>
        <span className="form-hint">
          {hasLimit ? p.picker.limitHint(items.length, maxItems) : p.picker.dropSub}
        </span>
      </button>
      {items.length > 0 && previewMode !== "none" && (
        previewMode === "list" ? (
          <div className="picker-list" aria-label={p.picker.attachedLabel || p.picker.hint(items.length)}>
            {items.map((m, i) => {
              const kindLabel = m.kind === "video" ? p.picker.videoLabel || "Video" : p.picker.photoLabel || "Photo";
              const sizeLabel = formatFileSize(m.size);
              return (
                <div key={i} className="picker-list-item">
                  <div className="picker-file-meta">
                    <span className="picker-file-kind">{kindLabel}</span>
                    <strong>{m.name || `${kindLabel} ${i + 1}`}</strong>
                    {(sizeLabel || m.optimized) && (
                      <span className="picker-file-size">
                        {[sizeLabel, m.optimized ? p.picker.optimizedLabel : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  <button type="button" className="picker-remove-button" onClick={() => changeItems(items.filter((_, j) => j !== i))}>
                    {p.picker.removeLabel || "Remove"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="picker-grid picker-previews">
            {items.map((m, i) => (
              <div key={i} className="picker-cell is-selected">
                <MediaThumb media={m} alt="" />
                <button type="button" className="chip remove-media" aria-label={p.picker.removeLabel || "Remove"} onClick={() => changeItems(items.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )
      )}
      {/* 보조: 데모용 샘플 라이브러리 — 실서비스에선 settings.showSampleLibrary=false로 숨김 (드롭존이 기본) */}
      {showSamples && getSettings().showSampleLibrary !== false && (
        <>
          <p className="form-hint">{p.picker.sampleToggle}</p>
          <div className="picker-grid picker-samples-grid">
            {SAMPLE_LIBRARY.map((item, i) => {
              const selected = items.some((m) => m.src === item.src && m.pos === item.pos);
              return (
                <button type="button" key={i} className={`picker-cell ${selected ? "is-selected" : ""}`} onClick={() => toggleSample(item)}>
                  <MediaThumb media={item} alt={p.picker.labels[item.labelKey]} />
                  <span>{p.picker.labels[item.labelKey]}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {notice && !error && <p className="form-hint" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
