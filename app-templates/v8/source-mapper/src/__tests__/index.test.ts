import { transformSync } from '@babel/core';
import { describe, it, expect } from 'vitest';
import jsxSourceMapper from '../index.js';

function transform(code: string, filename = '/app/src/pages/index.tsx') {
  const result = transformSync(code, {
    filename,
    parserOpts: { plugins: ['jsx'] },
    plugins: [jsxSourceMapper],
    configFile: false,
    babelrc: false,
  });
  if (result === null || result.code == null) {
    throw new Error('transformSync returned null');
  }
  return result.code;
}

describe('jsxSourceMapper — data-dev-dynamic', () => {
  it('should mark elements with variable expressions', () => {
    const output = transform('<p>{product.price}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should mark elements with function call expressions', () => {
    const output = transform('<p>{formatPrice(100)}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should mark elements with conditional expressions', () => {
    const output = transform('<p>{active ? "yes" : "no"}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should NOT mark elements with string literal expressions', () => {
    const output = transform('<p>{"static string"}</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark elements with static template literals', () => {
    const output = transform('<p>{`static template`}</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark elements with empty expressions (comments)', () => {
    const output = transform('<p>{/* comment */}</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark elements with only literal text children', () => {
    const output = transform('<p>Hello World</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should mark elements with dynamic template literals', () => {
    const output = transform('<p>{`$${price}`}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should NOT mark elements in excluded paths', () => {
    const output = transform('<p>{value}</p>', '/app/src/components/ui/button.tsx');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should mark even when data-dev-file already exists', () => {
    const output = transform('<p data-dev-file="/test" data-dev-line={1}>{value}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
    // Should not duplicate data-dev-file
    expect(output.match(/data-dev-file/g)?.length).toBe(1);
  });
});
