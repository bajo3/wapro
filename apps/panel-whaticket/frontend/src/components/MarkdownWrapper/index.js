import React from "react";

/**
 * Ultra-lightweight WhatsApp-style message renderer.
 *
 * Replaces the previous markdown-to-jsx implementation which could silently
 * render empty/invisible elements under certain conditions (forceInline + span
 * override stripping, version-dependent behaviour, etc.).
 *
 * Supports:
 *  - *bold*        → <strong>
 *  - ~strikethrough~ → <del>
 *  - _italic_      → <em>
 *  - `code`        → <code>
 *  - Clickable URLs (http/https)
 *  - Newline preservation
 *
 * Does NOT rely on any external library. Text is always visible.
 */

const URL_REGEX = /(https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\))?[^\s<>().,;:!?"']*)/g;

// WhatsApp formatting patterns — non-greedy, require non-space after/before delimiters
const BOLD_RE    = /\*([^\s*](?:.*?[^\s*])?)\*/g;
const STRIKE_RE  = /~([^\s~](?:.*?[^\s~])?)~/g;
const ITALIC_RE  = /_([^\s_](?:.*?[^\s_])?)_/g;
const CODE_RE    = /`([^`]+)`/g;

function formatSegment(text, idx) {
  // Apply formatting in order: code first (most specific), then bold, strike, italic
  const parts = [];
  let remaining = text;
  let key = 0;

  // Split by code segments first
  const codeParts = remaining.split(CODE_RE);
  for (let i = 0; i < codeParts.length; i++) {
    if (i % 2 === 1) {
      // Code segment
      parts.push(
        <code key={`${idx}-c-${key++}`} style={{
          backgroundColor: "rgba(255,255,255,0.08)",
          borderRadius: 4,
          padding: "1px 5px",
          fontSize: 13,
          fontFamily: "monospace",
        }}>
          {codeParts[i]}
        </code>
      );
    } else if (codeParts[i]) {
      // Apply bold, strike, italic to non-code segments
      let segment = codeParts[i];

      // Process bold
      segment = segment.replace(BOLD_RE, "%%BOLD_START%%$1%%BOLD_END%%");
      // Process strikethrough
      segment = segment.replace(STRIKE_RE, "%%STRIKE_START%%$1%%STRIKE_END%%");
      // Process italic
      segment = segment.replace(ITALIC_RE, "%%ITALIC_START%%$1%%ITALIC_END%%");

      // Now split and create React elements
      const tokens = segment.split(/(%%(?:BOLD|STRIKE|ITALIC)_(?:START|END)%%)/);
      let bold = false, strike = false, italic = false;

      for (const token of tokens) {
        if (token === "%%BOLD_START%%") { bold = true; continue; }
        if (token === "%%BOLD_END%%") { bold = false; continue; }
        if (token === "%%STRIKE_START%%") { strike = true; continue; }
        if (token === "%%STRIKE_END%%") { strike = false; continue; }
        if (token === "%%ITALIC_START%%") { italic = true; continue; }
        if (token === "%%ITALIC_END%%") { italic = false; continue; }
        if (!token) continue;

        let el = token;
        if (bold) el = <strong key={`${idx}-b-${key++}`}>{el}</strong>;
        if (strike) el = <del key={`${idx}-s-${key++}`}>{el}</del>;
        if (italic) el = <em key={`${idx}-i-${key++}`}>{el}</em>;
        parts.push(el);
      }
    }
  }

  return parts.length > 0 ? parts : text;
}

const MarkdownWrapper = ({ children }) => {
  const text = (children != null) ? String(children) : "";

  if (!text) return null;
  if (text.includes("BEGIN:VCARD")) return null;
  if (text.includes("data:image/")) return null;

  // Split text by URLs to create linkified output
  const urlParts = text.split(URL_REGEX);
  // Reset lastIndex since we reuse the regex
  URL_REGEX.lastIndex = 0;

  const rendered = [];
  for (let i = 0; i < urlParts.length; i++) {
    const part = urlParts[i];
    if (!part) continue;

    // Check if this part is a URL (odd-indexed parts from split with capture group)
    if (i % 2 === 1) {
      rendered.push(
        <a
          key={`url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#93c5fd", textDecoration: "underline" }}
        >
          {part}
        </a>
      );
    } else {
      // Format non-URL text segments with WhatsApp-style markdown
      const formatted = formatSegment(part, i);
      if (Array.isArray(formatted)) {
        rendered.push(...formatted);
      } else {
        rendered.push(formatted);
      }
    }
  }

  // Guaranteed visible: wraps in a span with explicit pre-wrap
  return (
    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {rendered}
    </span>
  );
};

export default MarkdownWrapper;
