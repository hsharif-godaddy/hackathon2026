/**
 * SVG Sanitization Utility
 *
 * Uses DOMPurify to remove dangerous content from SVG files while preserving
 * visual elements. Protects against XSS attacks via embedded scripts, event
 * handlers, and other executable content.
 *
 * Security features:
 * - Removes <script> tags and javascript: URLs
 * - Strips all event handlers (onclick, onerror, etc.)
 * - Blocks <foreignObject> (can embed HTML/scripts)
 * - Removes dangerous elements (iframe, object, embed)
 * - Validates data: URIs to prevent data:text/html attacks
 */

import DOMPurify from 'isomorphic-dompurify'

export interface SanitizeSVGResult {
  /** The sanitized SVG content */
  sanitized: string
  /** Whether the original SVG contained scripts or dangerous content */
  hadDangerousContent: boolean
  /** List of dangerous patterns that were detected */
  detectedThreats: string[]
}

/**
 * Sanitize SVG content to remove XSS vectors while preserving visual elements
 *
 * @param svgContent - Raw SVG content as string
 * @returns Sanitized SVG with threat detection results
 *
 * @example
 * ```typescript
 * const result = sanitizeSVG('<svg><script>alert("xss")</script></svg>');
 * // result.sanitized: '<svg></svg>'
 * // result.hadDangerousContent: true
 * // result.detectedThreats: ['script-tag']
 * ```
 */
export function sanitizeSVG(svgContent: string): SanitizeSVGResult {
  // isomorphic-dompurify automatically works in Node.js environment with JSDOM
  // No need to create a window - the package handles it internally
  const purify = DOMPurify

  // Track detected threats
  const detectedThreats: string[] = []

  // Check for dangerous patterns before sanitization
  if (/<script/i.test(svgContent)) {
    detectedThreats.push('script-tag')
  }
  if (/javascript:/i.test(svgContent)) {
    detectedThreats.push('javascript-url')
  }
  if (/on\w+\s*=/i.test(svgContent)) {
    detectedThreats.push('event-handler')
  }
  if (/<foreignObject/i.test(svgContent)) {
    detectedThreats.push('foreign-object')
  }
  if (/<iframe|<object|<embed/i.test(svgContent)) {
    detectedThreats.push('dangerous-element')
  }
  if (/data:text\/html/i.test(svgContent)) {
    detectedThreats.push('data-html-uri')
  }

  // Strip data: URIs that aren't images (e.g. data:text/html XSS vectors).
  // We use a hook instead of ALLOWED_URI_REGEXP because the custom regex option
  // gets applied to ALL attribute values (including SVG path `d`), breaking rendering.
  purify.addHook('afterSanitizeAttributes', function strip(node) {
    for (const attr of ['href', 'xlink:href']) {
      const val = node.getAttribute(attr)
      if (val && /^data:(?!image\/)/i.test(val)) {
        node.removeAttribute(attr)
      }
    }
  })

  let cleanSVG: string
  try {
    cleanSVG = purify.sanitize(svgContent, {
      USE_PROFILES: { svg: true, svgFilters: true },

      ADD_TAGS: ['use'],

      FORBID_TAGS: [
        'iframe', 'object', 'embed', 'link', 'base',
        'audio', 'video', 'source',
        'form', 'input', 'button', 'textarea', 'select', 'option'
      ],

      FORBID_ATTR: [
        'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onmousedown',
        'onmouseup', 'onmousemove', 'onmouseenter', 'onmouseleave', 'onfocus',
        'onblur', 'onchange', 'onsubmit', 'onreset', 'onselect', 'onabort',
        'onanimationend', 'onanimationstart', 'onanimationiteration',
        'ontransitionend', 'ontouchstart', 'ontouchend', 'ontouchmove',
        'onwheel', 'onscroll', 'ondrag', 'ondrop', 'onkeydown', 'onkeyup',
        'onkeypress', 'oncontextmenu', 'oncopy', 'oncut', 'onpaste'
      ],

      KEEP_CONTENT: false,
      IN_PLACE: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false
    })
  } finally {
    purify.removeAllHooks()
  }

  return {
    sanitized: typeof cleanSVG === 'string' ? cleanSVG : '',
    hadDangerousContent: detectedThreats.length > 0,
    detectedThreats
  }
}

/**
 * Check if a file appears to be an SVG based on extension or MIME type
 *
 * @param filename - File name or path
 * @param mimeType - Optional MIME type
 * @returns True if file appears to be SVG
 */
export function isSVGFile(filename: string, mimeType?: string): boolean {
  const lowerFilename = filename.toLowerCase()
  return (
    lowerFilename.endsWith('.svg') ||
    lowerFilename.endsWith('.svgz') ||
    mimeType === 'image/svg+xml'
  )
}
