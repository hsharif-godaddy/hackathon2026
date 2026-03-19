import { describe, it, expect } from 'vitest';
import { sanitizeSVG, isSVGFile } from '../svg-sanitizer.js';

describe('sanitizeSVG', () => {
  describe('Script Removal', () => {
    it('should remove <script> tags', () => {
      const input = '<svg><script>alert("xss")</script><circle cx="50" cy="50" r="40"/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('<script>');
      expect(result.sanitized).not.toContain('alert');
      expect(result.sanitized).toContain('<circle');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('script-tag');
    });

    it('should remove javascript: URLs', () => {
      const input = '<svg><a href="javascript:alert(1)"><circle cx="50" cy="50" r="40"/></a></svg>';
      const result = sanitizeSVG(input);

      // eslint-disable-next-line no-script-url
      expect(result.sanitized).not.toContain('javascript:');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('javascript-url');
    });

    it('should handle case-insensitive script detection', () => {
      const input = '<svg><SCRIPT>alert("xss")</SCRIPT></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('SCRIPT');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('script-tag');
    });
  });

  describe('Event Handler Removal', () => {
    it('should remove onclick event handlers', () => {
      const input = '<svg><circle cx="50" cy="50" r="40" onclick="alert(1)"/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('onclick');
      expect(result.sanitized).toContain('<circle');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('event-handler');
    });

    it('should remove onerror event handlers', () => {
      const input = '<svg><image href="x" onerror="alert(1)"/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('onerror');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('event-handler');
    });

    it('should remove onload event handlers', () => {
      const input = '<svg onload="alert(1)"><circle cx="50" cy="50" r="40"/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('onload');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('event-handler');
    });

    it('should remove multiple different event handlers', () => {
      const input = `<svg>
        <circle cx="50" cy="50" r="40" onclick="x()" onmouseover="y()" onfocus="z()"/>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('onclick');
      expect(result.sanitized).not.toContain('onmouseover');
      expect(result.sanitized).not.toContain('onfocus');
      expect(result.hadDangerousContent).toBe(true);
    });
  });

  describe('Dangerous Element Removal', () => {
    it('should remove <foreignObject> elements', () => {
      const input = `<svg>
        <foreignObject width="100" height="100">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <script>alert('xss')</script>
          </div>
        </foreignObject>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('foreignObject');
      expect(result.sanitized).not.toContain('<div');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('foreign-object');
    });

    it('should remove <iframe> elements', () => {
      const input = '<svg><iframe src="https://evil.com"></iframe></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('iframe');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('dangerous-element');
    });

    it('should remove <object> elements', () => {
      const input = '<svg><object data="https://evil.com/malware.swf"></object></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('object');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('dangerous-element');
    });

    it('should remove <embed> elements', () => {
      const input = '<svg><embed src="https://evil.com/malware.swf"/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('embed');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('dangerous-element');
    });
  });

  describe('Data URI Validation', () => {
    it('should block data:text/html URIs', () => {
      const input = '<svg><image href="data:text/html,<script>alert(1)</script>"/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('data:text/html');
      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('data-html-uri');
    });

    it('should allow safe data:image URIs', () => {
      const input = '<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('data:image');
      expect(result.detectedThreats).not.toContain('data-html-uri');
    });
  });

  describe('Legitimate SVG Preservation', () => {
    it('should preserve basic shapes', () => {
      const input = `<svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="red"/>
        <rect x="10" y="10" width="30" height="30" fill="blue"/>
        <path d="M 10 10 L 90 90" stroke="black"/>
        <ellipse cx="50" cy="50" rx="30" ry="20" fill="green"/>
        <line x1="0" y1="0" x2="100" y2="100" stroke="purple"/>
        <polygon points="50,10 90,90 10,90" fill="yellow"/>
        <polyline points="10,10 50,50 90,10" stroke="orange" fill="none"/>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('<circle');
      expect(result.sanitized).toContain('<rect');
      expect(result.sanitized).toContain('<path');
      expect(result.sanitized).toContain('<ellipse');
      expect(result.sanitized).toContain('<line');
      expect(result.sanitized).toContain('<polygon');
      expect(result.sanitized).toContain('<polyline');
      expect(result.hadDangerousContent).toBe(false);
    });

    it('should preserve gradients', () => {
      const input = `<svg>
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:rgb(255,255,0);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
          </linearGradient>
          <radialGradient id="grad2">
            <stop offset="0%" stop-color="white"/>
            <stop offset="100%" stop-color="blue"/>
          </radialGradient>
        </defs>
        <rect fill="url(#grad1)" width="100" height="100"/>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('linearGradient');
      expect(result.sanitized).toContain('radialGradient');
      expect(result.sanitized).toContain('<stop');
      expect(result.hadDangerousContent).toBe(false);
    });

    it('should preserve filters', () => {
      const input = `<svg>
        <defs>
          <filter id="blur">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5"/>
          </filter>
          <filter id="shadow">
            <feOffset result="offOut" in="SourceAlpha" dx="10" dy="10"/>
            <feGaussianBlur result="blurOut" in="offOut" stdDeviation="10"/>
            <feBlend in="SourceGraphic" in2="blurOut" mode="normal"/>
          </filter>
        </defs>
        <circle cx="50" cy="50" r="40" filter="url(#blur)"/>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('<filter');
      expect(result.sanitized).toContain('feGaussianBlur');
      expect(result.sanitized).toContain('feOffset');
      expect(result.sanitized).toContain('feBlend');
      expect(result.hadDangerousContent).toBe(false);
    });

    it('should preserve text elements', () => {
      const input = `<svg>
        <text x="10" y="20" font-family="Verdana" font-size="12" fill="blue">
          Hello <tspan font-weight="bold">World</tspan>
        </text>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('<text');
      expect(result.sanitized).toContain('<tspan');
      expect(result.sanitized).toContain('Hello');
      expect(result.hadDangerousContent).toBe(false);
    });

    it('should preserve groups and use elements', () => {
      const input = `<svg>
        <defs>
          <symbol id="icon" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="15"/>
          </symbol>
        </defs>
        <g transform="translate(10,10)">
          <use href="#icon"/>
        </g>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('<g');
      expect(result.sanitized).toContain('<use');
      expect(result.sanitized).toContain('<symbol');
      expect(result.hadDangerousContent).toBe(false);
    });

    it('should preserve SMIL animations', () => {
      const input = `<svg>
        <circle cx="50" cy="50" r="40">
          <animate attributeName="r" from="40" to="50" dur="1s" repeatCount="indefinite"/>
          <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="5s" repeatCount="indefinite"/>
        </circle>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('<animate');
      expect(result.sanitized).toContain('animateTransform');
      expect(result.hadDangerousContent).toBe(false);
    });

    it('should preserve clipping and masking', () => {
      const input = `<svg>
        <defs>
          <clipPath id="clip">
            <circle cx="50" cy="50" r="40"/>
          </clipPath>
          <mask id="mask">
            <rect width="100" height="100" fill="white"/>
          </mask>
        </defs>
        <rect width="100" height="100" clip-path="url(#clip)" mask="url(#mask)"/>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('clipPath');
      expect(result.sanitized).toContain('<mask');
      expect(result.hadDangerousContent).toBe(false);
    });
  });

  describe('Complex Attack Scenarios', () => {
    it('should handle multiple threats in one SVG', () => {
      const input = `<svg onload="alert(1)">
        <script>alert("xss1")</script>
        <foreignObject>
          <iframe src="https://evil.com"></iframe>
        </foreignObject>
        <a href="javascript:alert(2)">Click</a>
        <image href="data:text/html,<script>alert(3)</script>" onerror="alert(4)"/>
        <circle cx="50" cy="50" r="40" onclick="alert(5)"/>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('alert');
      expect(result.sanitized).not.toContain('script');
      // eslint-disable-next-line no-script-url
      expect(result.sanitized).not.toContain('javascript:');
      expect(result.sanitized).not.toContain('onload');
      expect(result.sanitized).not.toContain('onclick');
      expect(result.sanitized).not.toContain('onerror');
      expect(result.sanitized).not.toContain('foreignObject');
      expect(result.sanitized).not.toContain('iframe');
      expect(result.sanitized).not.toContain('data:text/html');

      expect(result.hadDangerousContent).toBe(true);
      expect(result.detectedThreats).toContain('script-tag');
      expect(result.detectedThreats).toContain('event-handler');
      expect(result.detectedThreats).toContain('foreign-object');
      expect(result.detectedThreats).toContain('dangerous-element');
      expect(result.detectedThreats).toContain('javascript-url');
      expect(result.detectedThreats).toContain('data-html-uri');

      // Safe content should still be present
      expect(result.sanitized).toContain('<circle');
    });

    it('should handle nested dangerous elements', () => {
      const input = `<svg>
        <g>
          <foreignObject>
            <div xmlns="http://www.w3.org/1999/xhtml">
              <script>alert(1)</script>
              <iframe src="data:text/html,<script>alert(2)</script>"></iframe>
            </div>
          </foreignObject>
        </g>
      </svg>`;
      const result = sanitizeSVG(input);

      expect(result.sanitized).not.toContain('foreignObject');
      expect(result.sanitized).not.toContain('<div');
      expect(result.sanitized).not.toContain('script');
      expect(result.sanitized).not.toContain('iframe');
      expect(result.hadDangerousContent).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty SVG', () => {
      const input = '<svg></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).toBe('<svg></svg>');
      expect(result.hadDangerousContent).toBe(false);
      expect(result.detectedThreats).toHaveLength(0);
    });

    it('should handle SVG with only safe content', () => {
      const input = '<svg><circle cx="50" cy="50" r="40" fill="blue"/></svg>';
      const result = sanitizeSVG(input);

      expect(result.sanitized).toContain('<svg>');
      expect(result.sanitized).toContain('<circle');
      expect(result.hadDangerousContent).toBe(false);
      expect(result.detectedThreats).toHaveLength(0);
    });

    it('should handle malformed SVG gracefully', () => {
      const input = '<svg><circle cx="50" cy="50" r="40"</svg>';
      const result = sanitizeSVG(input);

      // DOMPurify should handle parsing errors gracefully
      expect(result.sanitized).toBeDefined();
      expect(typeof result.sanitized).toBe('string');
    });
  });
});

describe('isSVGFile', () => {
  it('should identify .svg extension', () => {
    expect(isSVGFile('image.svg')).toBe(true);
    expect(isSVGFile('path/to/image.svg')).toBe(true);
    expect(isSVGFile('IMAGE.SVG')).toBe(true);
  });

  it('should identify .svgz extension', () => {
    expect(isSVGFile('image.svgz')).toBe(true);
    expect(isSVGFile('path/to/image.svgz')).toBe(true);
  });

  it('should identify image/svg+xml MIME type', () => {
    expect(isSVGFile('anyfile', 'image/svg+xml')).toBe(true);
  });

  it('should reject non-SVG files', () => {
    expect(isSVGFile('image.png')).toBe(false);
    expect(isSVGFile('image.jpg', 'image/jpeg')).toBe(false);
    expect(isSVGFile('document.pdf')).toBe(false);
  });

  it('should handle files without extensions', () => {
    expect(isSVGFile('file')).toBe(false);
    expect(isSVGFile('file', 'image/svg+xml')).toBe(true);
  });
});
