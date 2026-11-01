import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AudioLines,
  Box,
  FileText,
  Image,
  Link,
  MoreHorizontal,
  Video,
} from "lucide-react";
import { useState } from "react";
import type { FileScope } from "../../bindings";
import { Button, IconButton, Stamp } from "../../components/ui";
import {
  fileCatalogQuery,
  fileViewerApi,
  scopeInput,
  useFileContext,
} from "../../lib/file-viewer-api";
import { AssetLinkDialog } from "../assets/AssetLinkDialog";
import { useFileAction, useFileMenu, useOpenFileViewer } from "./file-hooks";
import "./files.css";

export function ScopeDocuments({
  scope,
}: {
  scope: { type: "epic" | "story"; key: string };
}) {
  return <DocumentStrip scope={scope} />;
}
export function DocumentStrip({
  scope,
}: {
  scope:
    | { type: "project"; key?: string }
    | { type: "epic" | "story"; key: string };
}) {
  const context = useFileContext(),
    c = context.data,
    normalized: FileScope = { type: scope.type, key: scope.key ?? null };
  const catalog = useQuery(
      fileCatalogQuery(c, { scope: normalized, includeArchived: true }),
    ),
    openFile = useOpenFileViewer(),
    navigate = useNavigate();
  const write = useFileAction(c, `documents:${scope.type}:${scope.key}`);
  const [link, setLink] = useState(false),
    [menu, setMenu] = useState<string>();
  const project = scope.type === "project";
  const menuDismiss = useFileMenu(!!menu, () => setMenu(undefined));
  return (
    <section
      ref={menuDismiss.root}
      onKeyDown={menuDismiss.onKeyDown}
      className="scope-documents"
      aria-label={project ? "Project documents" : `${scope.type} documents`}
    >
      <h3>{project ? "Project documents" : "Documents"}</h3>
      {(context.isPending || catalog.isPending) && (
        <span role="status">Reading documents…</span>
      )}
      {(context.error || catalog.error) && (
        <>
          <span role="alert">
            {context.error?.message ?? catalog.error?.message}
          </span>
          <Button
            onClick={() => {
              void context.refetch();
              void catalog.refetch();
            }}
          >
            Retry documents
          </Button>
        </>
      )}
      {catalog.data?.slice(0, project ? 6 : undefined).map((a) => {
        const KindIcon =
          a.storageType === "url"
            ? Link
            : ((
                {
                  sprite: Image,
                  audio: AudioLines,
                  video: Video,
                  model: Box,
                } as Record<string, typeof FileText>
              )[a.kind] ?? FileText);
        return (
          <div key={a.id} className="document-chip-wrap">
            <div className="document-chip">
              <Button title={a.name} onClick={() => openFile(a.id)}>
                <KindIcon size={15} aria-hidden="true" />
                {a.name}
                {a.archivedAt && <Stamp>Archived</Stamp>}
              </Button>
              <IconButton
                label={`Actions for ${a.name}`}
                aria-expanded={menu === a.id}
                onClick={(event) => {
                  menuDismiss.trigger.current = event.currentTarget;
                  setMenu(menu === a.id ? undefined : a.id);
                }}
              >
                <MoreHorizontal size={14} />
              </IconButton>
            </div>
            {menu === a.id && (
              <div className="popover-menu">
                <Button
                  disabled={!write.ready}
                  onClick={() => {
                    setMenu(undefined);
                    const input = scopeInput(normalized, a.id);
                    input.requestId = write.requestId([
                      "unlink",
                      normalized,
                      a.id,
                    ]);
                    write.run((ctx) => fileViewerApi.unlink(ctx, input));
                  }}
                >
                  Unlink from {scope.type}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {project && catalog.data?.length === 0 && (
        <span className="muted">
          Keep the plan, decisions and design docs here.
        </span>
      )}
      <Button disabled={!write.ready} onClick={() => setLink(true)}>
        {project ? "+ Add document" : "+ Link document"}
      </Button>
      {project && (
        <Button
          onClick={() =>
            void navigate({
              to: "/assets",
              search: (prev) =>
                ({ ...prev, linkedTo: "project" }) as typeof prev,
            })
          }
        >
          All documents
        </Button>
      )}
      {write.error && <p role="alert">{write.error.message}</p>}
      {write.changed && (
        <p role="alert">The Files target changed. Reopen this view.</p>
      )}
      {link && (
        <AssetLinkDialog
          scope={normalized}
          registerDocument={project}
          close={() => setLink(false)}
        />
      )}
    </section>
  );
}
