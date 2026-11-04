import chatgptIcon from "../assets/providers/chatgpt.png";
import claudeIcon from "../assets/providers/claude.png";

export function avatarImage(
  kind: string,
  avatar?: string | null,
  client?: string | null,
) {
  if (kind !== "agent") return null;
  if (avatar?.startsWith("data:image/png;base64,")) return avatar;
  if (avatar && !avatar.includes("/")) return null;
  if (client === "codex") return chatgptIcon;
  if (client === "claude-code") return claudeIcon;
  return null;
}
