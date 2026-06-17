/**
 * sanitize.ts — XSS defence-in-depth for user-supplied content.
 *
 * React JSX already auto-escapes {value} expressions, so direct XSS via JSX
 * renders is not currently possible. This module exists to:
 *   1. Guard any future `dangerouslySetInnerHTML` usage with DOMPurify.
 *   2. Provide a typed, tree-shakeable surface so the call-site reads clearly.
 *
 * Usage:
 *   import { sanitize, sanitizeHtml } from '@/lib/sanitize';
 *
 *   // Plain text — strips all tags, returns a safe string for JSX or text nodes
 *   <p>{sanitize(load.commodityDescription)}</p>
 *
 *   // Trusted HTML (e.g. rendered markdown from internal source) — allow-list tags
 *   <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />
 */
import DOMPurify from 'dompurify';

/** Strip ALL HTML — safe for rendering as plain text. */
export function sanitize(value: string | null | undefined): string {
  if (!value) return '';
  return DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/**
 * Allow a conservative subset of formatting tags — for rendering HTML-rich
 * content (e.g. internal admin notes rendered as markdown HTML).
 * Never use this for user-controlled free-text fields.
 */
export function sanitizeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'br', 'p', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
  });
}
