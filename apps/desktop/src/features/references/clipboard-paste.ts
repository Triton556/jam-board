import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../lib/api";
import { useFileDropSession } from "../../lib/file-drop-batch";
import { appQuery } from "../../lib/queries";
import { useUiStore } from "../../lib/ui-store";

type AppState = Awaited<ReturnType<typeof api.appState>>;
type Item = Awaited<ReturnType<typeof api.clipboardReference>>;

/** Preparation is not a write. Once dispatched, the native request is not cancelled. */
export function useClipboardImagePaste() {
  const client = useQueryClient(),
    app = useQuery(appQuery),
    session = useFileDropSession();
  const origin = useRef(app.data?.jam),
    mounted = useRef(true),
    epoch = useRef(0),
    invalid = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const check = () => {
      const current = client.getQueryData<AppState>(["app"])?.jam;
      if (!origin.current && current) origin.current = current;
      else if (
        origin.current &&
        current?.id !== origin.current.id &&
        !invalid.current
      ) {
        invalid.current = true;
        epoch.current++;
      }
    };
    check();
    const stop = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") check();
    });
    return () => {
      mounted.current = false;
      epoch.current++;
      stop();
    };
  }, [client]);

  return useCallback(
    async (
      file: File,
      point: { x: number; y: number },
      confirmedHere: (item: Item) => void,
      refreshHere: () => Promise<void>,
    ) => {
      const current = client.getQueryData<AppState>(["app"])?.jam;
      const project =
        current?.id === origin.current?.id ? current : origin.current;
      const label = project
        ? `${project.name} [${project.keyPrefix}]`
        : "Unknown project";
      const capturedEpoch = epoch.current,
        generation = session?.generation;
      const live = () =>
        session
          ? session.active && session.generation === generation
          : mounted.current;
      const eligible = () =>
        live() &&
        mounted.current &&
        !invalid.current &&
        epoch.current === capturedEpoch &&
        !!project &&
        client.getQueryData<AppState>(["app"])?.jam?.id === project.id;
      let dispatched = false,
        confirmed = false,
        problem = "";
      const stopped = () => {
        problem = "Stopped: you left this page or the project context changed";
      };
      try {
        if (!eligible()) {
          stopped();
          return;
        }
        const bitmap = await createImageBitmap(file);
        let canvas: HTMLCanvasElement;
        try {
          if (!eligible()) {
            stopped();
            return;
          }
          canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw Error("Clipboard image could not be drawn");
          context.drawImage(bitmap, 0, 0);
        } finally {
          // Drawing copies the pixels; release the bitmap even while encoding is pending.
          bitmap.close();
        }
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(Error("Clipboard image could not be encoded")),
            "image/png",
          ),
        );
        if (!eligible()) {
          stopped();
          return;
        }
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        // No await between this final lifetime/project check and the native side effect.
        if (!eligible()) {
          stopped();
          return;
        }
        dispatched = true;
        const item = await api.clipboardReference(bytes, point.x, point.y);
        confirmed = true;
        if (eligible()) confirmedHere(item);
        else stopped();
      } catch (error) {
        problem = String(error);
      } finally {
        // Never select or refill a new view using this old operation's completion.
        if (dispatched && eligible()) {
          try {
            await refreshHere();
          } catch (error) {
            problem += `${problem ? "; " : ""}view refresh not confirmed: ${String(error)}`;
          }
        }
        if (confirmed && !eligible() && !problem) stopped();
        if (live()) {
          const outcome = confirmed
            ? "confirmed"
            : dispatched
              ? "unconfirmed request"
              : "not attempted";
          useUiStore
            .getState()
            .notify(
              `${label} · clipboard image: ${outcome}.${problem ? " Check details." : ""}`,
              {
                persistent: !confirmed || !!problem,
                details: [
                  {
                    label: confirmed
                      ? "Confirmed"
                      : dispatched
                        ? "Unconfirmed request"
                        : "Not attempted",
                    text: "Clipboard image",
                    note: problem || undefined,
                  },
                ],
                hint: `${project ? `Project ID: ${project.id}. ` : ""}${dispatched && !confirmed ? "The request may already have saved the image. " : ""}Open the captured project and use Refresh references before inspecting its results. No automatic retry or rollback was attempted.`,
              },
            );
        }
      }
    },
    [client, session],
  );
}
