import { useEffect, useRef, useState } from "react";

const HUES = ["#C4573A", "#7F9B77", "#D9A03A", "#5F7FA3", "#A86B8C", "#4E7C76"];

/** Square illustration with a typographic plate as an intentional fallback. */
export function Illustration({
  src,
  word,
  topic = 0,
  className = "",
  eager = false,
  alt,
}: {
  src: string | null;
  word: string;
  topic?: number;
  className?: string;
  eager?: boolean;
  alt?: string;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const imgRef = useRef<HTMLImageElement | null>(null);
  // 缓存命中的图片可能在 onLoad 挂上之前就已经加载完成，load 事件不会再来：
  // 不补这一步，图会永远停在 opacity:0（图鉴虚拟网格 + 本地缓存秒回时必现，
  // 桌面端走网络反而没事——2026-11-02 iPad 实测教训）。
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      setState(img.naturalWidth > 0 ? "ok" : "error");
    }
  }, [src]);
  const showImg = src && state !== "error";
  return (
    <figure className={`illo ${showImg && state === "ok" ? "is-loaded" : ""} ${className}`}>
      {showImg ? (
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ""}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      ) : (
        <div className="plate" style={{ "--hue": HUES[topic % HUES.length], "--len": Math.max(4, word.length) } as React.CSSProperties} aria-hidden="true">
          <span className="plate-initial">{word.slice(0, 1)}</span>
          <span className="plate-word">{word}</span>
          <i className="plate-rule" />
        </div>
      )}
    </figure>
  );
}
