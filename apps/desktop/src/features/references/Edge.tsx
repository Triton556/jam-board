import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  useStore,
} from "@xyflow/react";
import { memo } from "react";
import { roughPaths } from "./rough";
import { useCanvas } from "./runtime";
export const ReferenceEdge = memo(function ReferenceEdge(props: EdgeProps) {
  const [path, x, y] = getBezierPath(props),
    runtime = useCanvas();
  const overview = useStore((s) => s.transform[2] < 0.4);
  const active = useStore((s) => {
    const a = s.nodeLookup.get(props.source),
      b = s.nodeLookup.get(props.target);
    return !!(
      a?.selected ||
      b?.selected ||
      (a?.parentId && s.nodeLookup.get(a.parentId)?.selected) ||
      (b?.parentId && s.nodeLookup.get(b.parentId)?.selected)
    );
  });
  if (overview && !props.selected && !active && !props.data?.connect)
    return null;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{ stroke: "transparent", strokeWidth: 12 }}
        interactionWidth={16}
      />
      {roughPaths(path).map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--line)"
          strokeWidth={1.3}
          markerEnd={i === 0 ? "url(#reference-arrow)" : undefined}
          className="reference-edge"
        />
      ))}
      {(!overview || props.selected) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="reference-edge-label nodrag nopan"
            style={{
              transform: `translate(-50%,-50%) translate(${x}px,${y}px)`,
            }}
            onDoubleClick={() =>
              runtime.edgeLabel(props.id, String(props.label ?? ""))
            }
            onClick={() =>
              runtime.edgeLabel(props.id, String(props.label ?? ""))
            }
          >
            {String(props.label || "+")}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
