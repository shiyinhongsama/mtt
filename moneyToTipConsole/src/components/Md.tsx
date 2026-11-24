import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown 渲染（GFM：表格/任务列表/删除线；默认转义 HTML，无注入风险） */
export default function Md({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
