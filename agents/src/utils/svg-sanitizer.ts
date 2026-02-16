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

import * as DOMPurify from 'isomorphic-dompurify'

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

  // Configure DOMPurify for SVG sanitization
  const cleanSVG = purify.sanitize(svgContent, {
    // Use SVG profile - allows SVG elements and filters
    USE_PROFILES: { svg: true, svgFilters: true },

    // Explicitly allow safe SVG elements
    ALLOWED_TAGS: [
      // Core SVG elements
      'svg', 'g', 'defs', 'symbol', 'use', 'marker',
      // Shapes
      'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
      // Text
      'text', 'tspan', 'textPath',
      // Gradients and filters
      'linearGradient', 'radialGradient', 'stop',
      'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix',
      'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
      'feDiffuseLighting', 'feDisplacementMap', 'feFlood', 'feFunc',
      'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feImage', 'feMerge',
      'feMergeNode', 'feMorphology', 'feSpecularLighting', 'feTile',
      'feTurbulence', 'feDistantLight', 'fePointLight', 'feSpotLight',
      // Clipping and masking
      'clipPath', 'mask', 'pattern',
      // Images (with href validation)
      'image',
      // Metadata
      'title', 'desc', 'metadata',
      // Animation (SMIL - not script-based)
      'animate', 'animateTransform', 'animateMotion', 'set'
    ],

    // Explicitly allow safe SVG attributes
    ALLOWED_ATTR: [
      // Core attributes
      'id', 'class', 'style', 'xmlns', 'xmlns:xlink', 'xml:space',
      // Position and sizing
      'x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio',
      // Shapes
      'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points',
      // Styling
      'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
      'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
      'stroke-dashoffset', 'opacity',
      // Transforms
      'transform', 'transform-origin',
      // Gradients
      'offset', 'stop-color', 'stop-opacity', 'gradientUnits',
      'gradientTransform', 'spreadMethod',
      // Filters
      'filterUnits', 'primitiveUnits', 'in', 'in2', 'result', 'type',
      'values', 'mode', 'operator', 'k1', 'k2', 'k3', 'k4', 'stdDeviation',
      'dx', 'dy', 'radius', 'bias', 'scale', 'xChannelSelector',
      'yChannelSelector', 'edgeMode', 'kernelMatrix', 'divisor',
      // Clipping and masking
      'clip-path', 'clip-rule', 'mask', 'maskUnits', 'maskContentUnits',
      // Links (will be validated by ALLOWED_URI_REGEXP)
      'href', 'xlink:href',
      // Text
      'text-anchor', 'font-family', 'font-size', 'font-weight', 'font-style',
      'letter-spacing', 'word-spacing',
      // Animation
      'attributeName', 'attributeType', 'begin', 'dur', 'end', 'min', 'max',
      'restart', 'repeatCount', 'repeatDur', 'fill', 'calcMode', 'keyTimes',
      'keySplines', 'from', 'to', 'by', 'path'
    ],

    // Explicitly forbid dangerous elements
    FORBID_TAGS: [
      // Scripts and styles
      'script', 'style',
      // HTML injection vectors
      'foreignObject', 'iframe', 'object', 'embed', 'link', 'base',
      // Media that can load external content
      'audio', 'video', 'source',
      // Forms
      'form', 'input', 'button', 'textarea', 'select', 'option'
    ],

    // Explicitly forbid event handlers and dangerous attributes
    FORBID_ATTR: [
      // Event handlers
      'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onmousedown',
      'onmouseup', 'onmousemove', 'onmouseenter', 'onmouseleave', 'onfocus',
      'onblur', 'onchange', 'onsubmit', 'onreset', 'onselect', 'onabort',
      'onanimationend', 'onanimationstart', 'onanimationiteration',
      'ontransitionend', 'ontouchstart', 'ontouchend', 'ontouchmove',
      'onwheel', 'onscroll', 'ondrag', 'ondrop', 'onkeydown', 'onkeyup',
      'onkeypress', 'oncontextmenu', 'oncopy', 'oncut', 'onpaste',
      // XLink event handlers
      'xlink:actuate', 'xlink:arcrole', 'xlink:role', 'xlink:show', 'xlink:title'
    ],

    // Validate URIs to block javascript: and dangerous data: URIs
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|data:image\/(?:png|jpg|jpeg|gif|webp|svg\+xml);|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,

    // Don't add any custom tags or attributes
    ADD_TAGS: [],
    ADD_ATTR: [],

    // Remove content of forbidden tags entirely
    KEEP_CONTENT: false,

    // Don't modify the input in place
    IN_PLACE: false,

    // Return as string
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false
  })

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
