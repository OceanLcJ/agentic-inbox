import DOMPurify from "dompurify";
import { useEffect, useState } from "react";

// Read mail in a constrained document vocabulary. Mail cannot supply controls,
// styles, remote images, scripts, IDs, or layout that covers the workspace.
export default function SupportMessageBody({ body }: { body: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    const clean = DOMPurify.sanitize(body, {
      ALLOWED_TAGS: [
        "p",
        "br",
        "div",
        "span",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "s",
        "a",
        "ul",
        "ol",
        "li",
        "blockquote",
        "pre",
        "code",
        "h1",
        "h2",
        "h3",
        "h4",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
        "hr",
      ],
      ALLOWED_ATTR: ["href", "title"],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    const template = document.createElement("template");
    template.innerHTML = clean;
    template.content.querySelectorAll("a").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
    setHtml(template.innerHTML);
  }, [body]);
  return (
    <div
      className="ws-message-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
