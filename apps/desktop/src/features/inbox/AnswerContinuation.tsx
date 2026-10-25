import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AppState, Question } from "../../bindings";
import { Button } from "../../components/ui";
import { appQuery } from "../../lib/queries";
import { useBrainDock } from "../brain/brain-store";
import "./answer-continuation.css";

/** IDs only: the saved board answer remains the source of truth. */
export function answerContinuationPrompt(q: Question) {
  return `Read my saved answer to question ${q.id} in exact project ID ${q.jamId} (${q.scopeType} scope ID ${q.scopeId}${q.epicId ? `; epic ID ${q.epicId}` : ""}). Verify get_session_context.projectId first; on mismatch stop and ask. Freshly read the question, its original answer and relevant scope; preserve the answer and reconcile it with current context. Verify the current appointed epic brain before continuing; do not appoint yourself or transfer a role. For a project-scoped question, clarify the intended brain/scope if not already established. Continue only the previously requested phase within its currently authorized scope. This answer is information, not Start approval, a new execution grant, or permission to launch workers. If paused, finished, reassigned or unclear, report the next step instead of starting work. Use the language of the original human notes or latest human request; if unclear, ask rather than translating or guessing.`;
}

/** Stage the saved-answer prompt in chat, with the existing copy-only fallback. */
export function AnswerContinuation({ question }: { question: Question }) {
  const client = useQueryClient();
  const app = useQuery(appQuery);
  const dock = useBrainDock();
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const epoch = useRef(0);
  const locked = useRef(false);
  const mounted = useRef(false);
  const selected = useRef(app.data?.jam?.id);
  useEffect(() => {
    mounted.current = true;
    const check = () => {
      const id = client.getQueryData<AppState>(["app"])?.jam?.id;
      if (id !== selected.current) {
        selected.current = id;
        epoch.current++;
        setPreview(false);
        setNotice("");
      }
    };
    check();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") check();
    });
    return () => {
      mounted.current = false;
      epoch.current++;
      unsubscribe();
    };
  }, [client]);
  const current = app.data?.jam?.id === question.jamId;
  if (question.status !== "answered" || !current) return null;
  const prompt = answerContinuationPrompt(question);
  const copy = async () => {
    if (locked.current || selected.current !== question.jamId) return;
    const captured = epoch.current;
    locked.current = true;
    setPending(true);
    try {
      await navigator.clipboard.writeText(prompt);
      if (mounted.current && epoch.current === captured)
        setNotice(
          "Copied. Paste into the appointed brain’s chat. Nothing was sent and no work was started.",
        );
    } catch {
      if (mounted.current && epoch.current === captured)
        setNotice("Clipboard unavailable. Select and copy the prompt below.");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <div className="answer-continuation">
      <p className="small muted">
        Answer saved. A brain actively waiting through MCP can read it. A
        finished chat is not automatically awakened. You can find this prompt
        again in Inbox → Answered.
      </p>
      <Button
        variant="primary"
        onClick={() => {
          if (selected.current === question.jamId)
            dock.compose({ text: prompt, context: [] });
        }}
      >
        Continue in brain chat
      </Button>
      <Button
        disabled={pending}
        onClick={() => {
          setPreview(true);
          void copy();
        }}
      >
        {pending ? "Copying…" : "Copy continuation prompt"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => setPreview(!preview)}
        aria-expanded={preview}
      >
        {preview ? "Hide continuation prompt" : "Show continuation prompt"}
      </Button>
      {preview && (
        <div className="answer-continuation-preview">
          <label className="field">
            Continuation prompt
            <textarea
              aria-label="Continuation prompt"
              readOnly
              value={prompt}
              rows={6}
            />
          </label>
          {notice && <p role="status">{notice}</p>}
        </div>
      )}
    </div>
  );
}
