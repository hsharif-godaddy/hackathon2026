import { describe, it, expect } from 'vitest'

import { introducesNewTags, findStructuralViolation } from '../text-fix-agent.js'

describe('introducesNewTags (text-fix tag-set defense)', () => {
  it('returns false when output uses only tags present in the input', () => {
    expect(
      introducesNewTags(
        'Welcome to <strong>teh</strong> future',
        'Welcome to <strong>the</strong> future'
      )
    ).toBe(false)
  })

  it('returns false for plain-text round-trips (no tags)', () => {
    expect(introducesNewTags('teh quick fox', 'the quick fox')).toBe(false)
  })

  it('returns true when output adds a new tag', () => {
    expect(
      introducesNewTags(
        'safe text',
        'safe text<script>alert(1)</script>'
      )
    ).toBe(true)
  })

  it('returns true even when the new tag is a self-closing void element', () => {
    expect(
      introducesNewTags(
        'Hello world',
        'Hello <img src=x onerror=y> world'
      )
    ).toBe(true)
  })

  it('is case-insensitive on tag names', () => {
    expect(
      introducesNewTags(
        '<strong>x</strong>',
        '<STRONG>x</STRONG>'
      )
    ).toBe(false)
  })

  it('allows the model to drop tags but not add them', () => {
    // Input has both <strong> and <em>; output has only <strong>. That's a
    // legitimate simplification, not a smuggling attempt.
    expect(
      introducesNewTags(
        '<strong>a</strong> <em>b</em>',
        '<strong>a b</strong>'
      )
    ).toBe(false)
  })

  it('detects iframe injection', () => {
    expect(
      introducesNewTags(
        '<p>Hello</p>',
        '<p>Hello</p><iframe src="https://evil"></iframe>'
      )
    ).toBe(true)
  })
})

describe('findStructuralViolation (text-fix attribute-injection defense)', () => {
  it('returns null when output reuses the same tags and attributes', () => {
    expect(
      findStructuralViolation(
        '<a href="/x">teh link</a>',
        '<a href="/x">the link</a>'
      )
    ).toBeNull()
  })

  it('returns null for plain-text round-trips', () => {
    expect(findStructuralViolation('teh quick fox', 'the quick fox')).toBeNull()
  })

  it('does not confuse an attribute name appearing inside a quoted value', () => {
    // The string "onclick" appears inside the href value; it must not be
    // mistaken for a real onclick attribute.
    expect(
      findStructuralViolation(
        '<a href="/onclick-page">click</a>',
        '<a href="/onclick-page">click</a>'
      )
    ).toBeNull()
  })

  it('flags a smuggled <script> tag', () => {
    expect(
      findStructuralViolation(
        'safe text',
        'safe text<script>alert(1)</script>'
      )
    ).toBe('new tag <script>')
  })

  it('flags onclick added to a pre-existing <a>', () => {
    // Tag set is unchanged — only the attribute is new. Tag-name-only
    // defenses pass; this defense must reject.
    expect(
      findStructuralViolation(
        '<a href="/x">click</a>',
        '<a href="/x" onclick="evil()">click</a>'
      )
    ).toBe('new attribute "onclick" on <a>')
  })

  it('flags onclick when the attribute is separated by "/" instead of whitespace', () => {
    // HTML5 treats `/` between attributes as whitespace, so `<a/onclick=...>`
    // parses with `onclick` as a real attribute. A regex that only accepts
    // `\s+` as a separator would fail to match the tag at all and silently
    // pass the smuggled handler. The defense must catch this.
    expect(
      findStructuralViolation(
        '<a href="/x">click</a>',
        '<a/onclick="evil()" href="/x">click</a>'
      )
    ).toBe('new attribute "onclick" on <a>')
  })

  it('flags onerror added to a pre-existing <img>', () => {
    expect(
      findStructuralViolation(
        '<img src="/cat.png" alt="cat">',
        '<img src="/cat.png" alt="cat" onerror="evil()">'
      )
    ).toBe('new attribute "onerror" on <img>')
  })

  it('flags onmouseover added to an existing tag', () => {
    expect(
      findStructuralViolation(
        '<span class="x">hi</span>',
        '<span class="x" onmouseover="evil()">hi</span>'
      )
    ).toBe('new attribute "onmouseover" on <span>')
  })

  it('flags srcdoc added to an existing <iframe>', () => {
    expect(
      findStructuralViolation(
        '<iframe src="/safe.html"></iframe>',
        '<iframe src="/safe.html" srcdoc="<script>evil()</script>"></iframe>'
      )
    ).toBe('new attribute "srcdoc" on <iframe>')
  })

  it('flags formaction added to a pre-existing <button>', () => {
    expect(
      findStructuralViolation(
        '<button type="submit">Save</button>',
        '<button type="submit" formaction="//evil">Save</button>'
      )
    ).toBe('new attribute "formaction" on <button>')
  })

  it('parses tags whose attribute values contain a literal ">"', () => {
    // The `>` inside the title quoted value must not terminate the tag —
    // otherwise the parser would think the tag is `<a href="/x" title="a">`
    // and miss the (legitimate) trailing `data-x` attribute, then flag it
    // as new on the next match.
    expect(
      findStructuralViolation(
        '<a href="/x" title="a > b" data-x="1">teh link</a>',
        '<a href="/x" title="a > b" data-x="1">the link</a>'
      )
    ).toBeNull()
  })

  it('is case-insensitive on attribute names', () => {
    expect(
      findStructuralViolation(
        '<a HREF="/x">link</a>',
        '<a href="/x">link</a>'
      )
    ).toBeNull()
  })

  it('allows boolean attributes (no `=value`)', () => {
    expect(
      findStructuralViolation(
        '<input type="checkbox" disabled>',
        '<input type="checkbox" disabled>'
      )
    ).toBeNull()
  })

  it('unions attribute sets across multiple instances of the same tag', () => {
    // Input has <a href> in one place and <a class> in another — the union
    // is {href, class}. Output uses both on the same <a>, which is allowed.
    expect(
      findStructuralViolation(
        '<a href="/x">one</a> and <a class="y">two</a>',
        '<a href="/x" class="y">merged</a>'
      )
    ).toBeNull()
  })
})
