import { Plus } from "lucide-react";
import { Button, Kbd } from "./index";

export function NewTaskButton({
  onClick,
  disabled,
}: {
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="primary"
      className="new-task-button"
      onClick={onClick}
      disabled={disabled}
    >
      <Plus size={16} />
      New task<Kbd>N</Kbd>
    </Button>
  );
}
