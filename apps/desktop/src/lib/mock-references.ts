import type {
  CanvasArchive,
  CanvasGeometry,
  FramePatch_Serialize,
  ReferenceCanvas,
  ReferencePatch_Serialize,
  RefFrame,
} from "../bindings";
import type { Epic } from "./planning-api";
import type {
  ReferenceContentExpectation,
  ReferenceInput,
} from "./references-api";
import type { Asset, Member } from "./types";
import { JamError } from "./types";

type Context = {
  data(): ReferenceCanvas;
  epics(): Epic[];
  targets(): { id: string; key: string; kind: string }[];
  assets(): Asset[];
  human(): Member;
  jam(): string;
  changed(
    action: string,
    actor: Member,
    payload: Record<string, string>,
    epic?: string,
  ): void;
  call(command: string, input?: unknown): Promise<void>;
  save(): void;
};
const clone = <T>(v: T): T => structuredClone(v);
export const emptyCanvas = (): ReferenceCanvas => ({
  items: [],
  frames: [],
  edges: [],
  links: [],
});
export class MockReferences {
  viewport: string | null = null;
  constructor(private c: Context) {}
  item(id: string) {
    const item = this.c.data().items.find((i) => i.id === id);
    if (!item) throw new JamError("not_found", "Reference not found");
    return item;
  }
  async snapshot() {
    await this.c.call("reference_canvas");
    const d = this.c.data();
    return clone({
      ...d,
      items: d.items.filter((i) => !i.archivedAt),
      edges: d.edges.filter(
        (e) =>
          !e.archivedAt &&
          d.items.some((i) => i.id === e.fromItem && !i.archivedAt) &&
          d.items.some((i) => i.id === e.toItem && !i.archivedAt),
      ),
    });
  }
  change(action: string, id: string, actor = this.c.human(), epic?: string) {
    this.c.changed(
      action,
      actor,
      {
        itemId: id,
        title:
          this.c.data().items.find((i) => i.id === id)?.title ?? "Reference",
      },
      epic,
    );
    this.c.save();
  }
  async add(input: ReferenceInput, actor = this.c.human(), untitled = false) {
    await this.c.call("add_reference", input);
    if (untitled && (input.kind !== "note" || !!input.title))
      throw new JamError(
        "validation",
        "Untitled mode requires a note without a heading",
      );
    const d = this.c.data(),
      now = new Date().toISOString();
    if (!["asset", "note", "link"].includes(input.kind))
      throw new JamError("validation", "Choose asset, link or note");
    if (input.kind === "link" && !/^https?:\/\/\S+$/.test(input.url ?? ""))
      throw new JamError("validation", "Use an HTTP or HTTPS URL");
    if (input.kind === "note" && !input.text?.trim() && !input.title?.trim())
      throw new JamError("validation", "A note needs text or a heading");
    if (
      input.kind === "note" &&
      !untitled &&
      input.title != null &&
      (!input.title.trim() || [...input.title].length > 140)
    )
      throw new JamError(
        "validation",
        "Choose a nonblank heading up to 140 characters",
      );
    let assetId: string | null = null;
    if (input.kind === "asset") {
      if (!input.filePath)
        throw new JamError("validation", "A file path is required");
      assetId = crypto.randomUUID();
      this.c.assets().push({
        id: assetId,
        jamId: this.c.jam(),
        kind: "other",
        name: input.title ?? input.filePath.split(/[\\/]/).pop() ?? "File",
        location: input.filePath,
        notes: input.caption ?? null,
        role: "reference",
        createdBy: actor.id,
        createdAt: now,
      });
    }
    const epic = this.c.epics().find((e) => e.key === input.frameEpicKey);
    let frame = input.frameId
      ? d.frames.find((f) => f.id === input.frameId && !f.archivedAt)
      : epic
        ? d.frames.find((f) => !f.archivedAt && f.epicId === epic.id)
        : actor.kind === "agent"
          ? d.frames.find((f) => f.title === "Agent inbox" && !f.archivedAt)
          : undefined;
    if (!frame && (epic || actor.kind === "agent")) {
      frame = await this.frame({
        title: epic ? `${epic.title} references` : "Agent inbox",
        epicId: epic?.id ?? null,
        color: epic?.color ?? "m4",
        x: Math.max(-80, ...d.frames.map((f) => (f.x ?? 0) + (f.w ?? 0))) + 80,
        y: 0,
      });
    }
    const index = d.items.filter((i) => i.frameId === frame?.id).length;
    const item = {
      verdict: null,
      archivedBy: null,
      id: crypto.randomUUID(),
      jamId: this.c.jam(),
      position: d.items.length * 1024,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      kind: input.kind,
      assetId,
      url: input.url ?? null,
      title: untitled
        ? ""
        : (input.title ??
          (input.kind === "note"
            ? "Note"
            : (input.filePath?.split(/[\\/]/).pop() ??
              input.url ??
              "Reference"))),
      captionMd: [input.text, input.caption].filter(Boolean).join("\n\n"),
      tags: input.tags ?? [],
      x: input.x ?? (frame ? 24 + (index % 3) * 280 : 0),
      y: input.y ?? (frame ? 60 + Math.floor(index / 3) * 240 : 0),
      w: input.kind === "note" ? 240 : 260,
      h: input.kind === "note" ? 180 : 200,
      z: 0,
      frameId: frame?.id ?? null,
      linkPreview: null,
      metadata: null,
    };
    d.items.push(item);
    if (input.linkTo) await this.link(item.id, input.linkTo, false);
    this.change("reference.added", item.id, actor, epic?.id);
    return clone(item);
  }
  async update(
    id: string,
    p: ReferencePatch_Serialize,
    expected?: ReferenceContentExpectation,
  ) {
    await this.c.call("update_reference", {
      ...p,
      ...(expected ? { itemId: id, expected } : {}),
    });
    const i = this.item(id);
    if (expected && i.archivedAt)
      throw new JamError("validation", "Archived notes cannot be edited");
    if (
      expected &&
      (expected.title !== i.title || expected.caption !== i.captionMd)
    )
      throw new JamError(
        "conflict",
        "This note changed. Read the latest content before deciding what to keep.",
      );
    if (p.title === "" && (!expected || i.kind !== "note"))
      throw new JamError("validation", "Title must not be empty");
    if (typeof p.title === "string") i.title = p.title;
    if (typeof p.caption === "string") i.captionMd = p.caption;
    if (Array.isArray(p.tags)) i.tags = p.tags;
    i.updatedAt = new Date().toISOString();
    this.change("reference.updated", id);
    return clone(i);
  }
  async link(id: string, key: string, event = true) {
    await this.c.call("link_reference", { id, key });
    const t = this.c.targets().find((t) => t.key === key);
    if (!t) throw new JamError("not_found", "Target not found");
    const links = this.c.data().links;
    if (!links.some((l) => l.itemId === id && l.targetId === t.id))
      links.push({
        itemId: id,
        targetType: t.kind,
        targetId: t.id,
        archivedAt: null,
      });
    if (event) this.change("reference.linked", id);
    return clone(this.item(id));
  }
  async geometry(input: CanvasGeometry) {
    await this.c.call("canvas_geometry", input);
    const i = this.item(input.id);
    Object.assign(i, input);
    this.change("reference.updated", i.id);
    return clone(i);
  }
  async archive(input: CanvasArchive) {
    await this.c.call("canvas_archive", input);
    const rows =
      input.kind === "item"
        ? this.c.data().items
        : input.kind === "frame"
          ? this.c.data().frames
          : this.c.data().edges;
    const row = rows.find((r) => r.id === input.id);
    if (!row) throw new JamError("not_found", "Canvas record not found");
    row.archivedAt = input.archived ? new Date().toISOString() : null;
    if (input.kind === "item")
      this.item(input.id).archivedBy = input.archived ? "human" : null;
    this.change("reference.updated", input.id);
  }
  async frame(input: Partial<RefFrame> & Pick<RefFrame, "title" | "x" | "y">) {
    await this.c.call("create_ref_frame", input);
    const f = {
      links: [],
      id: crypto.randomUUID(),
      jamId: this.c.jam(),
      epicId: null,
      w: 850,
      h: 620,
      color: "m4",
      archivedAt: null,
      collapsed: false,
      ...input,
    };
    this.c.data().frames.push(f);
    this.c.save();
    return clone(f);
  }
  async updateFrame(id: string, patch: FramePatch_Serialize) {
    await this.c.call("update_ref_frame", patch);
    const f = this.c.data().frames.find((f) => f.id === id);
    if (!f) throw new JamError("not_found", "Frame not found");
    Object.assign(f, patch);
    this.change("reference.updated", id);
    return clone(f);
  }
  async edge(fromItem: string, toItem: string, label: string) {
    await this.c.call("create_ref_edge");
    const e = {
      id: crypto.randomUUID(),
      jamId: this.c.jam(),
      fromItem,
      toItem,
      label,
      archivedAt: null,
    };
    this.c.data().edges.push(e);
    this.change("reference.linked", e.id);
    return clone(e);
  }
  async updateEdge(id: string, label: string) {
    await this.c.call("update_ref_edge");
    const e = this.c.data().edges.find((e) => e.id === id);
    if (!e) throw new JamError("not_found", "Edge not found");
    e.label = label;
    this.change("reference.updated", id);
    return clone(e);
  }
  async metadata(id: string, metadata: string) {
    await this.c.call("reference_metadata");
    const i = this.item(id);
    i.metadata = metadata;
    this.c.save();
    return clone(i);
  }
  async preview(id: string, clear = false) {
    await this.c.call(
      clear ? "clear_reference_preview" : "fetch_reference_preview",
    );
    const i = this.item(id);
    i.linkPreview = clear
      ? null
      : JSON.stringify({ title: "Explicitly fetched page title", image: null });
    this.change("reference.updated", id);
    return clone(i);
  }
}
