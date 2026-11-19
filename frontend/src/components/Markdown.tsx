import { Fragment, type ReactNode } from "react";

// A small, safe Markdown view for the AI's answers: headings, paragraphs, bullet and numbered lists, tables, **bold**,
// *italic*, `code` and links. It builds React elements and never raw HTML, so text that came from a sheet or a file
// cannot inject anything into the page. Links open only for http(s) and the app's own paths.
const SAFE_LINK = /^(https?:\/\/|\/(?!\/))/i;

function inline(text: string, key: string): ReactNode[] {
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|\*([^*\s][^*\n]*?)\*/g;
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}.${n++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], k)}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else if (m[3] !== undefined)
      out.push(
        SAFE_LINK.test(m[4]) ? (
          <a key={k} href={m[4]} target="_blank" rel="noopener noreferrer">
            {m[3]}
          </a>
        ) : (
          `${m[3]} (${m[4]})`
        )
      );
    else if (m[5] !== undefined)
      out.push(
        <a key={k} href={m[5]} target="_blank" rel="noopener noreferrer">
          {m[5]}
        </a>
      );
    else if (m[6] !== undefined) out.push(<em key={k}>{m[6]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING = /^\s*(#{1,4})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,})\s*$/;
const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*(\d+)[.)]\s+/;
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const startsBlock = (i: number) => HEADING.test(lines[i]) || RULE.test(lines[i]) || BULLET.test(lines[i]) || NUMBER.test(lines[i]) || (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]));
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      blocks.push(h[1].length <= 2 ? <h3 key={k}>{inline(h[2], k)}</h3> : <h4 key={k}>{inline(h[2], k)}</h4>);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push(<hr key={k} />);
      i++;
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, `${k}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, j) => (
                    <td key={j}>{inline(r[j] ?? "", `${k}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const numbered = !BULLET.test(line);
      const start = numbered ? Number(line.match(NUMBER)[1]) : 1;
      const items: string[] = [];
      const same = numbered ? NUMBER : BULLET;
      while (i < lines.length && same.test(lines[i])) items.push(lines[i++].replace(same, ""));
      const list = items.map((t, j) => <li key={j}>{inline(t, `${k}.${j}`)}</li>);
      blocks.push(
        numbered ? (
          <ol key={k} start={start}>
            {list}
          </ol>
        ) : (
          <ul key={k}>{list}</ul>
        )
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(i))) para.push(lines[i++]);
    blocks.push(
      <p key={k}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l, `${k}.${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }
  return <div className="md">{blocks}</div>;
}
