import { Fragment, type ReactNode } from "react";

// Minimal markdown renderer for AI answers. Supports:
//   - bullet lists ("- " or "* " at line start)
//   - inline markdown links [label](/path) — rendered as <a target="_blank">
//     so the user keeps the AI thread open while inspecting the linked
//     show or artist
//   - **bold** runs
// Anything else falls through as plain text. Kept dependency-free to avoid
// pulling a full markdown lib for a single render site.

const BASE = import.meta.env.BASE_URL || "/";

function withBase(href: string): string {
  if (!href.startsWith("/")) return href;
  // Vite's BASE_URL always ends with "/"; strip the leading "/" on href
  // so we get exactly one slash between base and path.
  return `${BASE.replace(/\/$/, "")}/${href.replace(/^\//, "")}`;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Tokenize into link / bold / text runs in a single left-to-right pass.
  const linkRx = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  const boldRx = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let idx = 0;

  // Find all link and bold matches, sort by offset, then walk forward.
  type Token = { start: number; end: number; node: ReactNode };
  const tokens: Token[] = [];

  let m: RegExpExecArray | null;
  while ((m = linkRx.exec(text))) {
    const isExternal = !m[2].startsWith("/");
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      node: (
        <a
          key={`${keyPrefix}-l-${m.index}`}
          href={isExternal ? m[2] : withBase(m[2])}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900 hover:decoration-violet-500"
        >
          {m[1]}
        </a>
      ),
    });
  }
  while ((m = boldRx.exec(text))) {
    // Skip if this bold range overlaps a link (avoid double-handling)
    const overlaps = tokens.some(
      (t) => !(m!.index + m![0].length <= t.start || m!.index >= t.end),
    );
    if (overlaps) continue;
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      node: (
        <strong key={`${keyPrefix}-b-${m.index}`} className="font-semibold text-ink-900">
          {m[1]}
        </strong>
      ),
    });
  }
  tokens.sort((a, b) => a.start - b.start);

  for (const t of tokens) {
    if (t.start > cursor) {
      out.push(
        <Fragment key={`${keyPrefix}-t-${idx++}`}>{text.slice(cursor, t.start)}</Fragment>,
      );
    }
    out.push(t.node);
    cursor = t.end;
  }
  if (cursor < text.length) {
    out.push(<Fragment key={`${keyPrefix}-t-${idx++}`}>{text.slice(cursor)}</Fragment>);
  }
  return out;
}

export function AnswerMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let bulletBuf: string[] = [];
  let paragraphBuf: string[] = [];
  let bIdx = 0;

  function flushBullets() {
    if (bulletBuf.length === 0) return;
    const items = bulletBuf.slice();
    bulletBuf = [];
    blocks.push(
      <ul key={`b-${bIdx++}`} className="list-disc pl-5 space-y-1 my-1.5">
        {items.map((line, i) => (
          <li key={i} className="text-[12.5px] text-ink-800 leading-relaxed">
            {renderInline(line, `b${bIdx}-${i}`)}
          </li>
        ))}
      </ul>,
    );
  }

  function flushParagraph() {
    if (paragraphBuf.length === 0) return;
    const joined = paragraphBuf.join(" ").trim();
    paragraphBuf = [];
    if (!joined) return;
    blocks.push(
      <p key={`p-${bIdx++}`} className="text-[12.5px] text-ink-800 leading-relaxed my-1">
        {renderInline(joined, `p${bIdx}`)}
      </p>,
    );
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      bulletBuf.push(bullet[1]);
      continue;
    }
    if (line.trim() === "") {
      flushBullets();
      flushParagraph();
      continue;
    }
    flushBullets();
    paragraphBuf.push(line);
  }
  flushBullets();
  flushParagraph();

  return <div>{blocks}</div>;
}
