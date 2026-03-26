import { useTaskComments } from "@/hooks/useTasks";

interface TaskCommentsProps {
  taskId: string;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function TaskComments({ taskId }: TaskCommentsProps) {
  const { data: comments, isLoading } = useTaskComments(taskId);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground italic">Loading comments...</div>;
  }

  if (!comments || comments.length === 0) {
    return <div className="text-sm text-muted-foreground italic">No comments yet</div>;
  }

  return (
    <div className="space-y-3">
      {comments.map((comment) => (
        <div key={comment.id} className="border border-border bg-secondary/35 p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{comment.author}</span>
            <span>{formatWhen(comment.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground/90">{comment.message}</p>
          {comment.attachments.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Attachments
              </p>
              <ul className="space-y-1 text-xs text-foreground/80">
                {comment.attachments.map((file, index) => (
                  <li key={`${comment.id}-${file.name}-${index}`}>
                    {file.name} ({file.mimeType || "unknown"}, {file.size} bytes)
                    {file.content == null && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(metadata only)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
