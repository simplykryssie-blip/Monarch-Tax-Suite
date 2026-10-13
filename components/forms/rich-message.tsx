import { Fragment } from "react";
import { formatMessage } from "@/lib/forms/message.ts";

/** A form's confirmation message with its **bold** and line breaks. */
export function RichMessage({ text }: { text: string }) {
  return (
    <>
      {formatMessage(text).map((lines, p) => (
        <p key={p}>
          {lines.map((segments, l) => (
            <Fragment key={l}>
              {l > 0 && <br />}
              {segments.map((s, i) => (s.bold ? <b key={i}>{s.text}</b> : <Fragment key={i}>{s.text}</Fragment>))}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  );
}
