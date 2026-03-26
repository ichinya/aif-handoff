import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
}

const baseMarkdownClassName =
  "min-h-[2em] leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p]:my-2 [&_h1]:my-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-secondary/70 [&_code]:px-1 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-secondary/45 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_th]:border [&_th]:border-border [&_th]:bg-secondary/45 [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_hr]:my-3 [&_hr]:border-border [&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-0 [&_li.task-list-item]:ml-0 [&_li.task-list-item]:list-none [&_li.task-list-item]:pl-0 [&_li.task-list-item]:flex [&_li.task-list-item]:items-start [&_li.task-list-item>input]:mr-2 [&_li.task-list-item>input]:mt-1";

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn(baseMarkdownClassName, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
