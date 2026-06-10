"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant chat text as Markdown. The model writes **bold**, bullet
 * lists, and `code` — without this they showed as raw asterisks in one run-on
 * paragraph. Styling is tuned for the dark chat bubble (compact, readable).
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_a]:text-stellar [&_a]:underline">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="ml-1 list-none space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="relative pl-4 before:absolute before:left-0 before:text-stellar before:content-['•']">
              {children}
            </li>
          ),
          h1: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
          h2: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
          h3: ({ children }) => <p className="font-semibold text-foreground">{children}</p>,
          code: ({ children }) => (
            <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-stellar">
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
