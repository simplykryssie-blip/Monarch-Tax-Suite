import { parseRich, type Block, type Inline } from "@/lib/richtext.ts";

// Renders the safe rich-text subset (see lib/richtext.ts) as React elements. No HTML is ever injected.

function inline(nodes: Inline[]): React.ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text": return n.v.split("\n").flatMap((line, j) => (j ? [<br key={`${i}-${j}`} />, line] : [line]));
      case "token": return null;
      case "b": return <strong key={i}>{inline(n.c)}</strong>;
      case "i": return <em key={i}>{inline(n.c)}</em>;
      case "u": return <u key={i}>{inline(n.c)}</u>;
      case "a": return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{inline(n.c)}</a>;
      // eslint-disable-next-line @next/next/no-img-element
      case "img": return <img key={i} src={n.src} alt={n.alt} style={{ maxWidth: "100%", height: "auto" }} />;
      case "span": return <span key={i} style={{ color: n.color, fontSize: n.size }}>{inline(n.c)}</span>;
    }
  });
}

function block(b: Block, i: number): React.ReactNode {
  switch (b.t) {
    case "h": return b.level === 1 ? <h3 key={i} style={{ margin: "8px 0 0", fontSize: 20 }}>{inline(b.c)}</h3> : <h4 key={i} style={{ margin: "6px 0 0", fontSize: 17 }}>{inline(b.c)}</h4>;
    case "ul": return <ul key={i} style={{ margin: 0, paddingLeft: 22 }}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
    case "ol": return <ol key={i} style={{ margin: 0, paddingLeft: 22 }}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
    case "p": return <p key={i} style={{ margin: 0 }}>{inline(b.c)}</p>;
  }
}

export function RichText({ text }: { text: string }) {
  return <div style={{ display: "grid", gap: 10, color: "#4b4943", lineHeight: 1.6 }}>{parseRich(text).map(block)}</div>;
}
