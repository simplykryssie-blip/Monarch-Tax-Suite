// The confirmation message's light formatting: **bold** and line breaks (a blank line starts a new paragraph).
// Parsed into plain segments, never HTML, so nothing an administrator types can run in a respondent's browser.

export type MessageSegment = { text: string; bold: boolean };
export type MessageParagraph = MessageSegment[][]; // lines, each a list of segments

export function formatMessage(raw: string): MessageParagraph[] {
  const paragraphs = raw.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/);
  return paragraphs.filter((p) => p.trim()).map((p) =>
    p.split("\n").map((line) => {
      const parts = line.split(/\*\*(.+?)\*\*/g);
      return parts.map((text, i) => ({ text, bold: i % 2 === 1 })).filter((s) => s.text);
    }),
  );
}

/** A redirect address the form may send respondents to: a full https:// web address. Throws a plain message. */
export function cleanRedirectUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new Error("Enter the full web address to send people to, starting with https://");
  }
  if (url.protocol !== "https:") throw new Error("The address to send people to must start with https://");
  if (!url.hostname.includes(".") || url.username || url.password) throw new Error("Enter a normal web address, like https://www.yourfirm.com/thank-you");
  if (url.href.length > 2000) throw new Error("That web address is too long.");
  return url.href;
}
