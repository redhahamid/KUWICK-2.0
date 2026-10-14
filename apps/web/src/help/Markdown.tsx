import type { ReactNode } from 'react';

/**
 * THE GUIDES' OWN SMALL MARKDOWN (testing, 15 October 2026): headings,
 * numbered steps with the lines under them, bullets, paragraphs and bold.
 * The guides in docs/guides use only this, so no library is needed.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) =>
    part.startsWith('**') ? <b key={index}>{part.slice(2, -2)}</b> : part.startsWith('*') && part.length > 2 ? <i key={index}>{part.slice(1, -1)}</i> : part,
  );
}

export function slugOf(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let list: { kind: 'ol' | 'ul'; items: string[][] } | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((lines, index) => (
      <li key={index}>
        {inline(lines[0])}
        {lines.slice(1).map((line, at) => (
          <div key={at} className="kw-help__after">
            {inline(line)}
          </div>
        ))}
      </li>
    ));
    blocks.push(list.kind === 'ol' ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    const bullet = /^-\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    if (line.startsWith('#')) {
      flushParagraph();
      flushList();
      const level = /^#+/.exec(line)![0].length;
      const text = line.slice(level).trim();
      blocks.push(level === 1 ? <h1 key={blocks.length}>{text}</h1> : <h2 key={blocks.length} id={slugOf(text)}>{text}</h2>);
    } else if (numbered || bullet) {
      flushParagraph();
      const kind = numbered ? 'ol' : 'ul';
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push([(numbered ?? bullet)![1]]);
    } else if (list && /^\s+/.test(raw)) {
      // A line under a step: join it to the step's last line, or start a new line for "You see".
      const item = list.items[list.items.length - 1];
      const text = line.trim();
      if (/^(You see|They see|Anda nampak|Mereka nampak|No shifts|Tiada syif|A request|Permohonan|The original|Masa asal|The latest|Slip terkini|Other claims|Tuntutan lain|When it|Bila diluluskan|The published|Roster yang|Changed your|Ubah fikiran)/.test(text)) item.push(text);
      else item[item.length - 1] += ` ${text}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return <div className="kw-help">{blocks}</div>;
}
