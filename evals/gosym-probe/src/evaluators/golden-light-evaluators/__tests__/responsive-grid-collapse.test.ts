import { describe, expect, it } from 'vitest';

import { responsiveGridCollapseSpec as spec } from '../specs/responsive-grid-collapse.js';

describe('responsiveGridCollapseSpec', function tests() {
  describe('no grids', function noGrids() {
    it('canScore is false when the page has no multi-column grids', function none() {
      const result = spec.score('<html><body><div class="flex gap-4"><p>hi</p></div></body></html>');
      expect(result.canScore).toBe(false);
    });

    it('canScore is false for a single-column inline grid', function singleCol() {
      const result = spec.score('<div style="display: grid; grid-template-columns: 1fr">x</div>');
      expect(result.canScore).toBe(false);
    });
  });

  describe('tailwind grids', function tailwind() {
    it('flags a base grid-cols-3 with no responsive prefix', function baseThree() {
      const result = spec.score('<div class="grid grid-cols-3 gap-6">cards</div>');
      expect(result.canScore).toBe(true);
      expect(result.score).toBe(0);
      expect(result.details.offendingGrids).toBe(1);
    });

    it('passes a mobile-first grid-cols-1 md:grid-cols-3', function mobileFirst() {
      const result = spec.score('<div class="grid grid-cols-1 md:grid-cols-3 gap-6">cards</div>');
      expect(result.score).toBe(1);
      expect(result.details.offendingGrids).toBe(0);
    });

    it('does not flag a compact 2-up base grid (below threshold)', function twoUp() {
      const result = spec.score('<div class="grid grid-cols-2 gap-2">logos</div>');
      expect(result.canScore).toBe(true);
      expect(result.score).toBe(1);
    });

    it('passes an intrinsically-responsive arbitrary track', function autoFit() {
      const result = spec.score(
        '<div class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">cards</div>',
      );
      expect(result.score).toBe(1);
    });

    it('flags an arbitrary fixed track at base', function arbitraryFixed() {
      const result = spec.score('<div class="grid grid-cols-[1fr_1fr_1fr]">cards</div>');
      expect(result.score).toBe(0);
    });
  });

  describe('inline style grids', function inline() {
    it('flags inline repeat(3, 1fr)', function repeatThree() {
      const result = spec.score(
        '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px">cards</div>',
      );
      expect(result.score).toBe(0);
      expect(result.details.offendingGrids).toBe(1);
    });

    it('flags an explicit three-track value', function explicitTracks() {
      const result = spec.score('<div style="display:grid;grid-template-columns:1fr 1fr 1fr">x</div>');
      expect(result.score).toBe(0);
    });

    it('passes inline auto-fit minmax', function inlineAutoFit() {
      const result = spec.score(
        '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr))">x</div>',
      );
      expect(result.canScore).toBe(false);
    });

    it('does not flag a compact 2-up inline grid', function inlineTwoUp() {
      const result = spec.score('<div style="display:grid;grid-template-columns:1fr 1fr">tiles</div>');
      expect(result.score).toBe(1);
    });

    it('passes an inline grid that a stylesheet @media overrides', function inlineOverride() {
      const html = [
        '<style>@media (max-width: 640px){ .features-grid { grid-template-columns: 1fr !important; } }</style>',
        '<div class="features-grid" style="display:grid;grid-template-columns:repeat(3,1fr)">cards</div>',
      ].join('');
      const result = spec.score(html);
      expect(result.score).toBe(1);
      expect(result.details.offendingGrids).toBe(0);
    });
  });

  describe('stylesheet grids', function stylesheet() {
    it('flags a fixed stylesheet grid with no @media collapse', function noCollapse() {
      const html = '<style>.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); }</style>';
      const result = spec.score(html);
      expect(result.score).toBe(0);
      expect(result.details.offendingGrids).toBe(1);
    });

    it('passes a stylesheet grid that collapses in a @media block', function withCollapse() {
      const html = [
        '<style>',
        '.gp-features-grid { display: grid; grid-template-columns: repeat(3, 1fr); }',
        '@media (max-width: 640px){ .gp-features-grid { grid-template-columns: 1fr; } }',
        '</style>',
      ].join('');
      const result = spec.score(html);
      expect(result.score).toBe(1);
      expect(result.details.offendingGrids).toBe(0);
    });

    it('handles multiple rules inside a single @media block', function multiRuleMedia() {
      const html = [
        '<style>',
        '.grid-a { display: grid; grid-template-columns: repeat(3, 1fr); }',
        '@media (max-width: 640px) {',
        '  .grid-a { grid-template-columns: 1fr; }',
        '  .grid-b { grid-template-columns: repeat(2, 1fr); }',
        '}',
        '</style>',
      ].join('');
      const result = spec.score(html);
      // .grid-a is a base 3-col grid whose columns collapse in the @media block,
      // and .grid-b lives entirely inside the @media block (not a base rule), so
      // neither is flagged.
      expect(result.score).toBe(1);
      expect(result.details.offendingGrids).toBe(0);
    });
  });

  describe('mixed pages', function mixed() {
    it('scores the share of responsive grids', function ratio() {
      const html = [
        '<div class="grid grid-cols-1 md:grid-cols-3">good</div>',
        '<div class="grid grid-cols-4">bad</div>',
      ].join('');
      const result = spec.score(html);
      expect(result.details.totalGrids).toBe(2);
      expect(result.score).toBe(0.5);
    });

    it('passes a Gridpulse-style page: 2-up tiles, auto-fit, and @media features', function gridpulse() {
      const html = [
        '<style>',
        '.gp-features-grid { display: grid; grid-template-columns: repeat(3, 1fr); }',
        '@media (max-width: 640px){ .gp-features-grid { grid-template-columns: 1fr !important; } }',
        '</style>',
        '<div style="display:grid;grid-template-columns:1fr 1fr">4 metric tiles</div>',
        '<div class="gp-features-grid">6 feature cards</div>',
        '<div class="grid grid-cols-1 md:grid-cols-4">stats band</div>',
      ].join('');
      const result = spec.score(html);
      expect(result.canScore).toBe(true);
      expect(result.score).toBe(1);
      expect(result.details.offendingGrids).toBe(0);
    });
  });
});
