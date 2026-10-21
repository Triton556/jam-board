import { useQuery } from "@tanstack/react-query";
import { useStore } from "@xyflow/react";
import { File, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { RefItem } from "../../lib/references-api";
import { referenceKind } from "./model";
import { useCanvas } from "./runtime";

let currentAudio: HTMLAudioElement | null = null;
const thumbnails = new Map<string, Promise<string>>(),
  audioCache = new Map<
    string,
    Promise<{ peaks: number[]; duration: number }>
  >();
export function stopReferenceAudio() {
  currentAudio?.pause();
  currentAudio = null;
}
export async function decodedThumbnail(url: string) {
  let promise = thumbnails.get(url);
  if (!promise) {
    promise = (async () => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = url;
      await image.decode();
      const scale = Math.min(
          1,
          512 / Math.max(image.naturalWidth, image.naturalHeight),
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas
        .getContext("2d")
        ?.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.82);
    })();
    thumbnails.set(url, promise);
  }
  return promise;
}
export function ImageMedia({ url, title }: { url: string; title: string }) {
  const runtime = useCanvas(),
    small = useStore((s) => s.transform[2] < 1),
    [thumb, setThumb] = useState<string>(),
    [pixel, setPixel] = useState(false);
  useEffect(() => {
    let live = true;
    void decodedThumbnail(url)
      .then((t) => {
        if (live) setThumb(t);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <button
      type="button"
      className="reference-image nodrag"
      aria-label={`Open ${title}`}
      onDoubleClick={() => runtime.lightbox(url, title)}
      onClick={() => runtime.lightbox(url, title)}
    >
      <img
        src={small ? thumb : url}
        alt={title}
        loading="lazy"
        style={{ imageRendering: pixel ? "pixelated" : "auto" }}
        onLoad={(e) => {
          setPixel(
            Math.max(
              e.currentTarget.naturalWidth,
              e.currentTarget.naturalHeight,
            ) <= 128,
          );
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
    return <ImageMedia url={url.data} title={item.title} />;
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
