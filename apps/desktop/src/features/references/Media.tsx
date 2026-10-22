import { useQuery } from "@tanstack/react-query";
import { useStore } from "@xyflow/react";
import { File, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { RefItem } from "../../lib/references-api";
import {
  decodedImageThumbnail,
  type Thumbnail,
  thumbnailFits,
} from "./image-resolution";
import { referenceKind } from "./model";
import { useCanvas } from "./runtime";

let currentAudio: HTMLAudioElement | null = null;
const audioCache = new Map<
  string,
  Promise<{ peaks: number[]; duration: number }>
>();
export function stopReferenceAudio() {
  currentAudio?.pause();
  currentAudio = null;
}
export async function decodedThumbnail(url: string) {
  return (await decodedImageThumbnail(url)).src;
}
export function ImageMedia(props: { url: string; title: string }) {
  // Remount before paint: never display the previous URL while an effect resets.
  return <ScopedImageMedia key={props.url} {...props} />;
}
function ScopedImageMedia({ url, title }: { url: string; title: string }) {
  const runtime = useCanvas(),
    zoom = useStore((s) => s.transform[2]),
    [thumb, setThumb] = useState<Thumbnail>(),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [dpr, setDpr] = useState(() => window.devicePixelRatio || 1),
    [pixel, setPixel] = useState(false),
    [thumbFailed, setThumbFailed] = useState(false),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void decodedImageThumbnail(url)
      .then((value) => {
        if (live) {
          setThumb(value);
          setPixel(Math.max(value.originalWidth, value.originalHeight) <= 128);
        }
      })
      .catch(() => {
        /* Original remains usable if thumbnail generation fails. */
      });
    return () => {
      live = false;
    };
  }, [url]);
  // Observe the image's own untransformed content box, not its screen rect.
  const measureImage = useCallback((element: HTMLImageElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let query: MediaQueryList;
    const update = () => {
      query?.removeEventListener("change", update);
      const value = window.devicePixelRatio || 1;
      setDpr(value);
      query = window.matchMedia(`(resolution: ${value}dppx)`);
      query.addEventListener("change", update);
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  const useThumb =
    !thumbFailed &&
    thumb &&
    thumbnailFits(thumb, size.width, size.height, zoom, dpr);
  const src = useThumb ? thumb.src : url;
  if (failed)
    return (
      <div className="reference-file nodrag">
        <span role="status">Image unavailable</span>
        <button
          type="button"
          className="button ghost"
          onClick={() => {
            setThumbFailed(true);
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          Retry image
        </button>
      </div>
    );
  return (
    <button
      type="button"
      className="reference-image nodrag"
      aria-label={`Open ${title}`}
      onClick={() => runtime.lightbox(url, title)}
    >
      <img
        ref={measureImage}
        key={`${src}:${attempt}`}
        src={src}
        alt={title}
        loading="lazy"
        style={{ imageRendering: pixel ? "pixelated" : "auto" }}
        onLoad={(e) => {
          if (!useThumb)
            setPixel(
              Math.max(
                e.currentTarget.naturalWidth,
                e.currentTarget.naturalHeight,
              ) <= 128,
            );
        }}
        onError={() => {
          if (useThumb) setThumbFailed(true);
          else setFailed(true);
        }}
      />
    </button>
  );
}
export function AudioMedia({ url, item }: { url: string; item: RefItem }) {
  const ref = useRef<HTMLAudioElement>(null),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [decodeError, setDecodeError] = useState(""),
    [data, setData] = useState<{ peaks: number[]; duration: number } | null>(
      () => {
        try {
          const value = item.metadata ? JSON.parse(item.metadata) : null;
          return Array.isArray(value?.peaks) &&
            typeof value.duration === "number"
            ? value
            : null;
        } catch {
          return null;
        }
      },
    );
  useEffect(() => {
    let live = true;
    if (data) return;
    let promise = audioCache.get(url);
    if (!promise) {
      promise = (async () => {
        const context = new AudioContext();
        try {
          const response = await fetch(url);
          const audio = await context.decodeAudioData(
            await response.arrayBuffer(),
          );
          const channel = audio.getChannelData(0),
            peaks = Array.from({ length: 64 }, (_, n) => {
              let peak = 0;
              for (
                let i = Math.floor((n * channel.length) / 64);
                i < Math.floor(((n + 1) * channel.length) / 64);
                i++
              )
                peak = Math.max(peak, Math.abs(channel[i] ?? 0));
              return Math.round(peak * 1000) / 1000;
            });
          return { peaks, duration: audio.duration };
        } finally {
          await context.close();
        }
      })();
      audioCache.set(url, promise);
    }
    void promise
      .then((value) => {
        if (live) setData(value);
        let metadata = {};
        try {
          metadata = JSON.parse(item.metadata ?? "{}");
        } catch {
          /* Replace malformed metadata with decoded peaks. */
        }
        void api
          .referenceMetadata(item.id, JSON.stringify({ ...metadata, ...value }))
          .catch(() => {});
      })
      .catch(() => {
        if (live) setDecodeError("Waveform unavailable for this audio format.");
      });
    return () => {
      live = false;
    };
  }, [url, item.id, data, item.metadata]);
  useEffect(() => {
    const audio = ref.current;
    return () => {
      if (audio === currentAudio) stopReferenceAudio();
    };
  }, []);
  return (
    <div className="reference-audio nodrag nowheel">
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      >
        <track kind="captions" />
      </audio>
      <button
        type="button"
        aria-label={playing ? "Pause audio" : "Play audio"}
        onClick={() => {
          const audio = ref.current;
          if (!audio) return;
          if (playing) audio.pause();
          else {
            if (currentAudio !== audio) currentAudio?.pause();
            currentAudio = audio;
            void audio.play().catch(() => setPlaying(false));
          }
        }}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <svg viewBox="0 0 256 54" aria-label="Audio waveform" role="img">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          d={(data?.peaks ?? [])
            .map(
              (p, i) =>
                `M ${i * 4} ${27 - p * 24} V ${27 + Math.max(1, p * 24)}`,
            )
            .join(" ")}
        />
      </svg>
      <input
        type="range"
        aria-label="Audio position"
        min={0}
        max={data?.duration ?? 1}
        step={0.01}
        value={time}
        onChange={(e) => {
          if (ref.current) ref.current.currentTime = Number(e.target.value);
        }}
      />
      <span className="mono">
        {data ? `${data.duration.toFixed(1)} s` : "Loading audio…"}
      </span>
      {decodeError && <small className="muted">{decodeError}</small>}
    </div>
  );
}
const posters = new Map<string, string>();
export function VideoMedia({ url, title }: { url: string; title: string }) {
  const [poster, setPoster] = useState(posters.get(url));
  return (
    <video
      className="nodrag nowheel"
      src={url}
      poster={poster}
      muted
      crossOrigin="anonymous"
      controls
      preload="metadata"
      aria-label={title}
      onLoadedData={(e) => {
        if (poster) return;
        try {
          const v = e.currentTarget,
            c = document.createElement("canvas");
          c.width = 320;
          c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
          c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
          const value = c.toDataURL("image/webp", 0.8);
          posters.set(url, value);
          setPoster(value);
        } catch {
          /* A missing decoder keeps the native controls and filename. */
        }
      }}
    >
      <track kind="captions" />
    </video>
  );
}
export function LocalMedia({ item, path }: { item: RefItem; path: string }) {
  const kind = referenceKind(item, path),
    url = useQuery({
      queryKey: ["referenceMedia", item.assetId],
      queryFn: () =>
        item.assetId
          ? kind === "image"
            ? api.assetPreview(item.assetId)
            : api.referenceMedia(item.assetId)
          : Promise.resolve(null),
      staleTime: Infinity,
    }),
    [font, setFont] = useState<string>();
  useEffect(() => {
    if (kind !== "font" || !url.data) return;
    const name = `reference-${item.id}`,
      face = new FontFace(name, `url("${url.data}")`);
    let live = true;
    void face
      .load()
      .then((f) => {
        if (live) {
          document.fonts.add(f);
          setFont(name);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      document.fonts.delete(face);
    };
  }, [kind, url.data, item.id]);
  if (url.data && kind === "image")
    return <ImageMedia key={item.id} url={url.data} title={item.title} />;
  if (url.data && kind === "audio")
    return <AudioMedia url={url.data} item={item} />;
  if (url.data && kind === "video")
    return <VideoMedia url={url.data} title={item.title} />;
  return (
    <div className="reference-file">
      <File size={32} />
      <span
        title={path.split(/[\\/]/).at(-1) || item.title}
        style={font ? { fontFamily: font, fontSize: 24 } : undefined}
      >
        {path.split(/[\\/]/).at(-1) || item.title}
      </span>
      {item.metadata && (
        <small>
          {(() => {
            try {
              const m = JSON.parse(item.metadata);
              return m.size ? `${Math.ceil(m.size / 1024)} KiB` : "";
            } catch {
              return "";
            }
          })()}
        </small>
      )}
      <button
        type="button"
        className="button ghost nodrag"
        onClick={() => void api.showInFolder(path)}
      >
        Show in folder
      </button>
      {!url.data && url.isFetched && (
        <small className="muted">Local preview unavailable</small>
      )}
    </div>
  );
}
