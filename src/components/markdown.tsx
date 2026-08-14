"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/**
 * Renders GitHub-flavored markdown with syntax-highlighted code blocks.
 * rel/noopener is added to all links; relative links are left to the browser.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body text-[15px] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ ...props }) => (
            <a
              {...props}
              target={props.href && props.href.startsWith("http") ? "_blank" : undefined}
              rel={props.href && props.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
            >
              {props.children}
            </a>
          ),
          img: ({ alt, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              {...props}
              alt={alt ?? ""}
              loading="lazy"
              className="my-4 rounded-lg border border-border max-h-[480px] w-auto"
            />
          ),
          h1: ({ ...props }) => (
            <h1 {...props} className="mt-8 mb-3 text-2xl font-bold tracking-tight border-b border-border pb-2" />
          ),
          h2: ({ ...props }) => (
            <h2 {...props} className="mt-7 mb-3 text-xl font-bold tracking-tight border-b border-border pb-1.5" />
          ),
          h3: ({ ...props }) => (
            <h3 {...props} className="mt-6 mb-2 text-lg font-semibold tracking-tight" />
          ),
          h4: ({ ...props }) => (
            <h4 {...props} className="mt-5 mb-2 text-base font-semibold" />
          ),
          h5: ({ ...props }) => (
            <h5 {...props} className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground" />
          ),
          h6: ({ ...props }) => (
            <h6 {...props} className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground" />
          ),
          p: ({ ...props }) => <p {...props} className="my-4" />,
          ul: ({ ...props }) => <ul {...props} className="my-4 list-disc pl-6 space-y-1.5" />,
          ol: ({ ...props }) => <ol {...props} className="my-4 list-decimal pl-6 space-y-1.5" />,
          li: ({ ...props }) => <li {...props} className="pl-1" />,
          blockquote: ({ ...props }) => (
            <blockquote {...props} className="my-4 border-l-4 border-primary/40 bg-muted/40 py-2 pl-4 italic text-muted-foreground" />
          ),
          pre: ({ ...props }) => (
            <pre {...props} className="my-4 overflow-x-auto rounded-xl border border-border bg-[#0d1117] p-4 text-sm" />
          ),
          code: ({ className, children, ...props }) => {
            // Inline code (no language class) renders inline, not in a block.
            const isBlock = className?.startsWith("language-");
            return isBlock ? (
              <code className={className} {...props}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono text-foreground" {...props}>
                {children}
              </code>
            );
          },
          table: ({ ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table {...props} className="w-full border-collapse text-sm" />
            </div>
          ),
          th: ({ ...props }) => (
            <th {...props} className="border border-border bg-muted px-3 py-2 text-left font-semibold" />
          ),
          td: ({ ...props }) => <td {...props} className="border border-border px-3 py-2" />,
          hr: ({ ...props }) => <hr {...props} className="my-6 border-border" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
