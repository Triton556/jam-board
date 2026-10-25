import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Dialog, IconButton, Tooltip } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type {
  AgentSessionView,
  AttachmentSource,
  AttachmentView,
  ConfigOption,
} from "../../lib/agent-dock-api";
import { api } from "../../lib/api";
import { useModelCatalog } from "./BrainSessionControls";
import { profilesQuery } from "./brain-profiles";
import { optionCategory } from "./brain-settings";
import { type DraftAttachment, draftKey, useBrainState } from "./brain-store";

const MB = 1024 * 1024;
export function attachmentLimit(
  size: number,
  existing: { size: number; status: string }[],
) {
  const accepted = existing.filter((a) => a.status !== "refused");
  if (size > 20 * MB) return "File is larger than 20 MB";
  if (accepted.length >= 10) return "Up to 10 files per message";
  if (accepted.reduce((sum, a) => sum + a.size, 0) + size > 50 * MB)
    return "Up to 50 MB per message";
  return "";
}
export function attachmentRefusal(
  view: AttachmentView,
  kind: string,
  vision: boolean,
) {
  if (kind !== "api") return "";
  if (view.isImage)
    return vision ? "" : "This model can't see images — pick a vision model";
  if (
    view.size <= 256 * 1024 &&
    (/^(text\/|application\/(json|xml|javascript))/.test(view.mimeType) ||
      /\.(md|txt|csv|json|xml|log|js|ts|tsx|py|rs|html|css|yaml|yml)$/i.test(
        view.name,
      ))
  )
    return "";
  return "Not supported in API chat — use an agent connection";
}
export function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}
export function quotedPaths(paths: string[]) {
  return paths.map((path) => `"${path.replaceAll('"', '\\"')}"`).join(" ");
}

/** Attach the drop listeners to the dock so header/transcript drops work as well. */
export function useDockFileDrop(
  host: React.RefObject<HTMLElement | null>,
  files: (files: File[]) => void,
  paths: (paths: string[]) => void,
) {
  const [over, setOver] = useState(false);
  const handlers = useRef({ files, paths });
  handlers.current = { files, paths };
  const [dock, setDock] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const element =
      host.current?.closest<HTMLElement>(".brain-dock") ?? host.current;
    if (!element) return;
    setDock(element);
    const drag = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !element.contains(event.relatedTarget)
      )
        setOver(false);
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      handlers.current.files(Array.from(event.dataTransfer.files));
    };
    element.addEventListener("dragover", drag);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    let disposed = false;
    let off: (() => void) | undefined;
    if (import.meta.env.VITE_MOCK_BRIDGE !== "1")
      void import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) =>
          getCurrentWebview().onDragDropEvent((event) => {
            if (disposed) return;
            const payload = event.payload;
            if (payload.type === "leave") {
              setOver(false);
              return;
            }
            const rect = element.getBoundingClientRect();
            const x = payload.position.x / devicePixelRatio,
              y = payload.position.y / devicePixelRatio;
            const inside =
              x >= rect.left &&
              x <= rect.right &&
              y >= rect.top &&
              y <= rect.bottom;
            setOver(inside && payload.type !== "drop");
            if (inside && payload.type === "drop")
              handlers.current.paths(payload.paths);
          }),
        )
        .then((stop) => {
          if (disposed) stop();
          else off = stop;
        })
        .catch(() => {
          /* A command reports native bridge failures. */
        });
    return () => {
      disposed = true;
      off?.();
      element.removeEventListener("dragover", drag);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
    };
  }, [host]);
  return over && dock
    ? createPortal(
        <div className="brain-drop-overlay">Drop to attach</div>,
        dock,
      )
    : null;
}

export function AttachmentComposer({
  session,
  options,
  host,
  disabled,
}: {
  session: AgentSessionView;
  options: ConfigOption[];
  host: React.RefObject<HTMLElement | null>;
  disabled: boolean;
}) {
  const key = draftKey();
  const entries = useBrainState((s) => s.drafts[key]?.attachments);
  const profiles = useQuery(profilesQuery);
  const profile = profiles.data?.find((p) => p.id === session.profileId);
  const catalog = useModelCatalog(profile);
  const model = options.find((o) => optionCategory(o) === "model")?.value;
  const vision =
    catalog.data?.models.find((m) => m.id === model)?.inputImage ?? false;
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const update = useCallback(
    (fn: (items: DraftAttachment[]) => DraftAttachment[]) => {
      useBrainState.setState((s) => ({
        drafts: {
          ...s.drafts,
          [key]: {
            text: "",
            context: [],
            ...s.drafts[key],
            attachments: fn(s.drafts[key]?.attachments ?? []),
          },
        },
      }));
    },
    [key],
  );
  const add = useCallback(
    async (source: AttachmentSource | File, size = 0) => {
      if (disabled) return;
      const id = crypto.randomUUID();
      const name =
        "kind" in source && source.kind === "path"
          ? (source.path.split(/[\\/]/).at(-1) ?? source.path)
          : source.name;
      if (!("kind" in source)) size = source.size;
      const refusal = attachmentLimit(
        size,
        useBrainState.getState().drafts[key]?.attachments ?? [],
      );
      update((items) => [
        ...items,
        {
          id,
          name,
          size,
          status: refusal ? "refused" : "copying",
          error: refusal,
        },
      ]);
      if (refusal) return;
      try {
        const prepared =
          "kind" in source
            ? source
            : {
                kind: "bytes" as const,
                name: source.name,
                mimeType: source.type || "application/octet-stream",
                data: await fileBase64(source),
              };
        if (
          !useBrainState
            .getState()
            .drafts[key]?.attachments?.some((a) => a.id === id)
        )
          return;
        const view = await agentDockApi.addAttachment({
          sessionId: session.id,
          source: prepared,
        });
        const current = useBrainState.getState().drafts[key]?.attachments ?? [];
        if (!current.some((a) => a.id === id)) return;
        const limit = attachmentLimit(
          view.size,
          current.filter((a) => a.id !== id),
        );
        useBrainState.setState((s) => ({
          attachments: { ...s.attachments, [view.id]: view },
        }));
        update((items) =>
          items.map((a) =>
            a.id === id
              ? {
                  ...a,
                  size: view.size,
                  view,
                  status: limit ? "refused" : "ready",
                  error: limit,
                }
              : a,
          ),
        );
      } catch (e) {
        update((items) =>
          items.map((a) =>
            a.id === id ? { ...a, status: "refused", error: String(e) } : a,
          ),
        );
      }
    },
    [disabled, key, session.id, update],
  );
  const addFiles = useCallback(
    (files: File[]) => {
      // Reserve each slot before reading so concurrent paste/drop cannot exceed the message limits.
      for (const file of files) void add(file);
    },
    [add],
  );
  useEffect(() => {
    const element = host.current;
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      addFiles(files);
    };
    element?.addEventListener("paste", paste);
    return () => element?.removeEventListener("paste", paste);
  }, [host, addFiles]);
  const overlay = useDockFileDrop(host, addFiles, (paths) => {
    for (const path of paths) void add({ kind: "path", path });
  });
  return (
    <>
      <IconButton
        label="Attach files"
        disabled={disabled}
        onClick={() => {
          if (import.meta.env.VITE_MOCK_BRIDGE === "1") input.current?.click();
          else
            void api
              .pickFiles()
              .then((paths) => {
                for (const path of paths) void add({ kind: "path", path });
              })
              .catch((e) => setError(String(e)));
        }}
      >
        <Paperclip size={16} />
      </IconButton>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        aria-label="Choose attachments"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {host.current &&
        createPortal(
          <div className="brain-attachment-row">
            {entries?.map((a) => {
              const refusal =
                a.error ||
                (a.view && attachmentRefusal(a.view, session.kind, vision));
              return (
                <div
                  key={a.id}
                  className={`brain-attachment ${refusal ? "refused" : ""}`}
                >
                  {a.view?.isImage && a.view.thumbnail && (
                    <img src={a.view.thumbnail} alt={a.name} />
                  )}
                  <span
                    title={`${a.name} · ${formatSize(a.size)}${refusal ? ` · ${refusal}` : ""}`}
                  >
                    {a.name} · {formatSize(a.size)}
                    {a.status === "copying" && (
                      <small role="status">Copying…</small>
                    )}
                    {refusal && <small role="alert">{refusal}</small>}
                  </span>
                  <IconButton
                    label={`Remove ${a.name}`}
                    onClick={() =>
                      update((items) =>
                        items.filter((item) => item.id !== a.id),
                      )
                    }
                  >
                    <X size={12} />
                  </IconButton>
                </div>
              );
            })}
            {error && <p role="alert">{error}</p>}
          </div>,
          host.current,
        )}
      {overlay}
    </>
  );
}
export function formatSize(size: number) {
  return size >= MB
    ? `${(size / MB).toFixed(1)} MB`
    : `${Math.ceil(size / 1024)} KB`;
}
export function attachmentUrl(view: AttachmentView) {
  return (
    view.previewUrl ||
    (/^(data:|blob:)/.test(view.path) ? view.path : convertFileSrc(view.path))
  );
}

export function TranscriptAttachment({
  id,
  projectId,
}: {
  id: string;
  projectId: string;
}) {
  const view = useBrainState((s) => s.attachments[id]);
  const client = useQueryClient();
  const [lightbox, setLightbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  if (!view)
    return <span className="brain-attachment">Attachment unavailable</span>;
  const addToCanvas = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (useBrainState.getState().projectId !== projectId)
        throw Error(
          "Project changed. Open the original project to add this image.",
        );
      if (!/^(data:|blob:)/.test(view.path)) {
        await api.addReference({
          kind: "asset",
          filePath: view.path,
          copy: true,
          title: view.name,
          x: 80,
          y: 80,
        });
        setAdded(true);
        if (useBrainState.getState().projectId === projectId)
          await client.invalidateQueries({ queryKey: ["references"] });
        return;
      }
      const response = await fetch(attachmentUrl(view));
      if (!response.ok) throw Error("Could not read the original image");
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        throw Error("Could not copy image");
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(Error("Could not encode image")),
          "image/png",
        ),
      );
      const bytes = Array.from(new Uint8Array(await png.arrayBuffer()));
      if (useBrainState.getState().projectId !== projectId)
        throw Error(
          "Project changed. Open the original project to add this image.",
        );
      await api.clipboardReference(bytes, 80, 80);
      setAdded(true);
      if (useBrainState.getState().projectId === projectId)
        await client.invalidateQueries({ queryKey: ["references"] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="brain-transcript-attachment">
      {view.isImage ? (
        <>
          <Tooltip text={`Open ${view.name}`}>
            <button
              type="button"
              className="brain-image-preview"
              aria-label={`Open ${view.name}`}
              onClick={() => setLightbox(true)}
            >
              <img
                src={view.thumbnail ?? attachmentUrl(view)}
                alt={view.name}
              />
            </button>
          </Tooltip>
          <Button
            className="brain-add-to-canvas"
            disabled={busy || added}
            onClick={() => void addToCanvas()}
          >
            {busy ? "Adding…" : added ? "Added to canvas" : "Add to canvas"}
          </Button>
        </>
      ) : (
        <span className="brain-attachment">
          {view.name} · {formatSize(view.size)}
        </span>
      )}
      {error && <small role="alert">{error}</small>}
      {lightbox && (
        <Dialog title={view.name} onClose={() => setLightbox(false)}>
          <img
            className="brain-lightbox-image"
            src={attachmentUrl(view)}
            alt={view.name}
          />
        </Dialog>
      )}
    </div>
  );
}
