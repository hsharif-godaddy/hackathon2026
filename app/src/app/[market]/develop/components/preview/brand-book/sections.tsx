'use client';

import { Check, X } from 'lucide-react';
import Image from 'next/image';
import Box from '@ux/box';
import Tag from '@ux/tag';
import text from '@ux/text';

import type { BrandData } from '@/hooks/useBrandData';
import styles from './brand-book.module.css';
import { Quote, SectionHeader,SectionPlaceholder, SectionWrapper } from './shared-components';
import type { BrandStyle, SectionThemeProps,SuggestPromptFn } from './types';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  HERO                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function HeroSection({
  brandName,
  tagline,
  brand,
}: {
  brandName: string;
  tagline: string;
  brand: BrandStyle;
}) {
  const hasBrand = !!brand.primary;

  const heroStyle: React.CSSProperties = hasBrand
    ? { backgroundColor: brand.primary }
    : {};

  const textColor = hasBrand ? brand.primaryFg : undefined;

  return (
    <Box
      className={styles.hero}
      style={heroStyle}
    >
      <div className={styles.heroInner}>
        <span
          className={styles.sectionLabel}
          style={{ color: textColor }}
        >
          Brand Identity
        </span>
        <div className={styles.heroSeparator}></div>
        <text.h1
          className={styles.heroTitle}
          as="heading"
          size={4}
          style={{ color: textColor }}
        >
          {brandName}
        </text.h1>
        {tagline && (
          <text.p
            className={styles.heroTagline}
            as="paragraph"
            size={1}
            style={{ color: textColor }}
          >
            {tagline}
          </text.p>
        )}
      </div>
    </Box>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  LOGO                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function LogoSection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
  logoUrls,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
  logoUrls?: {
    primarySrc?: string;
    verticalSrc?: string;
    horizontalSrc?: string;
  } | null;
} & SectionThemeProps) {
  const pal = data?.palette;
  const isDark = pal?.theme === 'dark';
  const logoPanelBg = isDark ? pal?.foreground : pal?.background || '#f5f5f5';

  const primarySrc = logoUrls?.primarySrc;
  const verticalSrc = logoUrls?.verticalSrc;
  const horizontalSrc = logoUrls?.horizontalSrc;

  // null = manifest still loading (don't flash placeholder)
  // undefined = no logo in manifest (show placeholder CTA)
  const showPlaceholder = logoUrls === undefined;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="01"
        label="Primary Mark"
        title="Logo"
        brand={brand}
      />

      {showPlaceholder ? (
        <SectionPlaceholder
          description="Upload or describe your logo to see it displayed here."
          prompt="Help me create a logo for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : primarySrc ? (
        <Box gap="lg">
          <div className={styles.logoGrid}>
            {/* Square: primary logo on light background */}
            <div className={styles.logoGridItem} style={{ gridArea: 'light' }}>
              <div className={styles.logoPanelSquare} style={{ backgroundColor: logoPanelBg }}>
                <Image
                  src={primarySrc}
                  alt="Logo"
                  fill
                  unoptimized
                  className={styles.logoImage}
                />
              </div>
              <text.span as="caption">Primary</text.span>
            </div>

            {/* Vertical variant */}
            {verticalSrc && (
              <div className={styles.logoGridItem} style={{ gridArea: 'vert' }}>
                <div className={styles.logoPanelWide} style={{ backgroundColor: logoPanelBg }}>
                  <Image
                    src={verticalSrc}
                    alt="Vertical variant"
                    fill
                    unoptimized
                    className={styles.logoImage}
                  />
                </div>
                <text.span as="caption">Vertical</text.span>
              </div>
            )}

            {/* Horizontal variant */}
            {horizontalSrc && (
              <div className={styles.logoGridItem} style={{ gridArea: 'horiz' }}>
                <div className={styles.logoPanelWide} style={{ backgroundColor: logoPanelBg }}>
                  <Image
                    src={horizontalSrc}
                    alt="Horizontal variant"
                    fill
                    unoptimized
                    className={styles.logoImage}
                  />
                </div>
                <text.span as="caption">Horizontal</text.span>
              </div>
            )}
          </div>
        </Box>
      ) : null}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COLOR PALETTE                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function ColorSection({
  data,
  brand,
  onSuggestPrompt,
  palette: sectionPalette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const palette = data?.palette;

  return (
    <SectionWrapper palette={sectionPalette} inverted={inverted}>
      <SectionHeader
        num="02"
        label="Brand Colors"
        title="Color Palette"
        brand={brand}
      />

      {!palette ? (
        <SectionPlaceholder
          description="Define your brand colors — primary, accent, and semantic tones."
          prompt="Create a color palette for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
            {palette.name && (
              <text.span as="paragraph" size={0}>
                {palette.name}
              </text.span>
            )}
            {palette.theme && <Tag emphasis="info">{`${palette.theme} theme`}</Tag>}
          </Box>

          {/* Core colors */}
          <div className={styles.swatchGrid}>
            {[
              { name: 'Primary', value: palette.primary },
              { name: 'Secondary', value: palette.secondary },
              { name: 'Accent', value: palette.accent },
              { name: 'Background', value: palette.background },
              { name: 'Foreground', value: palette.foreground },
            ]
              .filter((c) => c.value)
              .map((c) => (
                <div key={c.name} className={styles.swatchCard}>
                  <div
                    className={styles.swatchSquare}
                    style={{ backgroundColor: c.value }}
                  />
                  <div className={styles.swatchInfo}>
                    <span className={styles.swatchName}>{c.name}</span>
                    <span className={styles.swatchValue}>
                      {c.value.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
          </div>

          {/* Semantic colors */}
          <div className={styles.swatchGrid}>
            {[
              { name: 'Destructive', value: palette.destructive },
              { name: 'Success', value: palette.success },
              { name: 'Warning', value: palette.warning },
            ]
              .filter((c) => c.value)
              .map((c) => (
                <div key={c.name} className={styles.swatchCard}>
                  <div
                    className={styles.swatchSquare}
                    style={{ backgroundColor: c.value }}
                  />
                  <div className={styles.swatchInfo}>
                    <span className={styles.swatchName}>{c.name}</span>
                    <span className={styles.swatchValue}>
                      {c.value.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TYPOGRAPHY                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function TypographySection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const typo = data?.typography;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="03"
        label="Typography"
        title="Font Pairing"
        brand={brand}
      />

      {!typo ? (
        <SectionPlaceholder
          description="Choose heading and body fonts to establish your typographic identity."
          prompt="Choose fonts and typography for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          <Box orientation="horizontal" gap="xl">
            {/* Heading font */}
            <Box gap="md" className={`${styles.softCard} ${styles.fontShowcase} ${styles.flexOne}`} style={{ '--showcase-font': brand.headingFont } as React.CSSProperties}>
              <text.h3 as="title" size={0}>Heading Font</text.h3>
              <text.h4
                as="heading"
                size={1}
                >
                {typo.heading?.family || 'System UI'}
              </text.h4>
              <text.p
                as="paragraph"
                size={0}
                style={{ opacity: 0.7 }}
              >
                The quick brown fox jumps over the lazy dog.
              </text.p>
              <hr className={styles.softDivider} />
              <text.span as="caption">
                Use for: Page titles, section headers, brand name
              </text.span>
            </Box>

            {/* Body font */}
            <Box gap="md" className={`${styles.softCard} ${styles.fontShowcase} ${styles.flexOne}`} style={{ '--showcase-font': brand.bodyFont } as React.CSSProperties}>
              <text.h3 as="title" size={0}>Body Font</text.h3>
              <text.h4
                as="heading"
                size={1}
                >
                {typo.body?.family || 'System UI'}
              </text.h4>
              <text.p
                as="paragraph"
                size={0}
                style={{ opacity: 0.7 }}
              >
                The quick brown fox jumps over the lazy dog.
              </text.p>
              <hr className={styles.softDivider} />
              <text.span as="caption">
                Use for: Body copy, navigation, captions, UI labels
              </text.span>
            </Box>
          </Box>

          {/* Type scale */}
          <Box gap="sm" className={styles.softCardSpaced}>
            <text.h3 as="title" size={0}>
              Type Scale
            </text.h3>
            {[
              { hint: 'Page titles, hero headings', sample: 'The quick brown fox jumps over the lazy dog.', size: '2.25rem', font: 'heading' },
              { hint: 'Section headings', sample: 'The quick brown fox jumps over the lazy dog.', size: '1.5rem', font: 'heading' },
              { hint: 'Card titles, sub-headings', sample: 'The quick brown fox jumps over the lazy dog.', size: '1.125rem', font: 'heading' },
              { hint: 'Body copy, paragraphs', sample: 'The quick brown fox jumps over the lazy dog.', size: '1rem', font: 'body' },
              { hint: 'Captions, labels, helper text', sample: 'The quick brown fox jumps over the lazy dog.', size: '0.875rem', font: 'body' },
            ].map((row) => (
              <Box
                key={row.hint}
                orientation="vertical"
                gap="sm"
                className={styles.typeScaleRow}
              >
                <text.span as="caption">{row.hint}</text.span>
                <span
                  style={{
                    fontFamily:
                      row.font === 'body'
                        ? brand.bodyFont
                        : brand.headingFont,
                    fontSize: row.size,
                    lineHeight: 1.3,
                    paddingTop: '12px',
                  }}
                >
                  {row.sample}
                </span>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PERSONALITY                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function PersonalitySection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const personality = data?.personality;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="04"
        label="Brand Personality"
        title="Who We Are"
        brand={brand}
      />

      {!personality ? (
        <SectionPlaceholder
          description="Describe your brand's personality traits and character."
          prompt="Define the personality traits for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          {personality.description && (
            <text.p
              as="paragraph"
              size={0}
              >
              {personality.description}
            </text.p>
          )}

          {personality.traits && personality.traits.length > 0 && (
            <Box gap="md">
              {personality.traits.map((trait) => (
                <div
                  key={trait.name}
                  className={styles.softCard}
                >
                  <Box orientation="horizontal" gap="lg" inlineAlignChildren="center">
                    <span
                      className={styles.traitName}
                      style={{ color: brand.primary }}
                    >
                      {trait.name}
                    </span>
                    <text.p
                      as="paragraph"
                      >
                      {trait.description}
                    </text.p>
                  </Box>
                </div>
              ))}
            </Box>
          )}
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  VOICE & TONE                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function VoiceSection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const voice = data?.voice;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="05"
        label="Voice & Tone"
        title="How We Communicate"
        brand={brand}
      />

      {!voice ? (
        <SectionPlaceholder
          description="Establish how your brand communicates — tone, style, and sample copy."
          prompt="Define the voice and tone for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          {(voice.weAre || voice.weAreNot) && (
            <Box orientation="horizontal" gap="xl">
              {voice.weAre && voice.weAre.length > 0 && (
                <Box gap="md" className={styles.flexOne}>
                  <text.h3
                    as="title"
                    size={0}
                    >
                    We Are
                  </text.h3>
                  {voice.weAre.map((line, i) => (
                    <Box
                      key={`${i}-${line}`}
                      orientation="horizontal"
                      gap="sm"
                      inlineAlignChildren="center"
                    >
                      <Check size={16} className={styles.voiceCheckIcon} />
                      <text.p
                        as="paragraph"
                        >
                        {line}
                      </text.p>
                    </Box>
                  ))}
                </Box>
              )}

              {voice.weAreNot && voice.weAreNot.length > 0 && (
                <Box gap="md" className={styles.flexOne}>
                  <text.h3
                    as="title"
                    size={0}
                    >
                    We Are Not
                  </text.h3>
                  {voice.weAreNot.map((line, i) => (
                    <Box
                      key={`${i}-${line}`}
                      orientation="horizontal"
                      gap="sm"
                      inlineAlignChildren="center"
                    >
                      <X size={16} className={styles.voiceCrossIcon} />
                      <text.p
                        as="paragraph"
                        >
                        {line}
                      </text.p>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {voice.sampleCopy && (
            <Box gap="md" className={styles.softCardSpaced}>
              <text.span as="caption">Sample Copy</text.span>
              <Quote brand={brand} text={voice.sampleCopy.headline} size="lg" />
              <text.p
                as="paragraph"
                >
                {voice.sampleCopy.body}
              </text.p>
            </Box>
          )}
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ICONOGRAPHY                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function IconographySection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const iconography = data?.iconography;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="06"
        label="Iconography"
        title="Icon Style"
        brand={brand}
      />

      {!iconography ? (
        <SectionPlaceholder
          description="Describe your icon style and visual language."
          prompt="Describe the iconography style for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          {iconography.style && (
            <text.p as="paragraph" size={1}>
              {iconography.style}
            </text.p>
          )}

          {iconography.tags && iconography.tags.length > 0 && (
            <Box orientation="horizontal" gap="sm" wrap>
              {iconography.tags.map((tag) => (
                <Tag key={tag} emphasis="info">{tag}</Tag>
              ))}
            </Box>
          )}
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TONE MATRIX                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function ToneMatrixSection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const toneMatrix = data?.toneMatrix;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="07"
        label="Communication"
        title="Tone Matrix"
        brand={brand}
      />

      {!toneMatrix || toneMatrix.contexts.length === 0 ? (
        <SectionPlaceholder
          description="Define how your brand's tone adapts across different contexts."
          prompt="Define a tone matrix for my brand book showing how voice adapts across contexts like error messages, onboarding, and marketing"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="xl">
          {toneMatrix.contexts.map((row) => (
            <Box key={row.context} gap='lg' className={styles.toneRow}>
              <Box orientation='horizontal' gap="sm" inlineAlignChildren='center'>
                <text.h4 as="label" size={3} style={{ fontWeight: 700 }}>{row.context}</text.h4>
                {row.description && (<>
                  <span className={styles.dot}></span>
                  <text.span as="caption" style={{ opacity: 0.6 }}>{row.description}</text.span>
                </>)}
              </Box>

              <Box orientation="horizontal" gap="lg" blockAlignChildren="start">
                <Box gap="sm" className={styles.flexOne}>
                  <text.span as="caption" className={styles.sectionLabel} style={{ color: brand.primary, fontSize: '0.6rem' }}>Tone</text.span>
                  <text.span as="caption">{row.tone}</text.span>
                </Box>
                {row.language && (
                  <Box gap="sm" className={styles.flexOne}>
                    <text.span as="caption" className={styles.sectionLabel} style={{ color: brand.primary, fontSize: '0.6rem' }}>Language</text.span>
                    <text.span as="caption">{row.language}</text.span>
                  </Box>
                )}
                {row.purpose && (
                  <Box gap="sm" className={styles.flexOne}>
                    <text.span as="caption" className={styles.sectionLabel} style={{ color: brand.primary, fontSize: '0.6rem' }}>Purpose</text.span>
                    <text.span as="caption">{row.purpose}</text.span>
                  </Box>
                )}
              </Box>

              {row.examples && row.examples.length > 0 && (
                <>
                <div className={styles.softDivider}></div>
                <Box gap='sm'>
                  {row.examples.map((ex) => (
                    <Quote key={ex} brand={brand} text={ex} size="sm" />
                  ))}
                </Box>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PHOTOGRAPHY STYLE                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function PhotographySection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const photography = data?.photography;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="08"
        label="Visual Direction"
        title="Photography Style"
        brand={brand}
      />

      {!photography ? (
        <SectionPlaceholder
          description="Describe the photography style and visual direction for your brand."
          prompt="Define the photography style for my brand book including preferred subjects, treatments, and what to avoid"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          {photography.style && (
            <text.p as="paragraph" size={0}>{photography.style}</text.p>
          )}

          <Box orientation="horizontal" gap="md">
            {photography.subjects && photography.subjects.length > 0 && (
              <div className={`${styles.softCard} ${styles.flexOne}`}>
                <Box gap="sm">
                  <text.h4 as="title" size={0}>Preferred Subjects</text.h4>
                  <ul className={styles.bulletList}>
                    {photography.subjects.map((s) => (
                      <li key={s}><text.span as="paragraph">{s}</text.span></li>
                    ))}
                  </ul>
                </Box>
              </div>
            )}

            {photography.avoid && photography.avoid.length > 0 && (
              <div className={`${styles.softCard} ${styles.flexOne}`}>
                <Box gap="sm">
                  <text.h4 as="title" size={0}>Avoid</text.h4>
                  <ul className={styles.bulletList}>
                    {photography.avoid.map((a) => (
                      <li key={a}><text.span as="paragraph">{a}</text.span></li>
                    ))}
                  </ul>
                </Box>
              </div>
            )}
          </Box>

          {photography.treatments && photography.treatments.length > 0 && (
            <Box orientation="horizontal" gap="sm" wrap>
              {photography.treatments.map((t) => (
                <Tag key={t} emphasis="info">{t}</Tag>
              ))}
            </Box>
          )}
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TARGET AUDIENCE                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function AudienceSection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const audience = data?.audience;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="09"
        label="Target Audience"
        title="Who We Serve"
        brand={brand}
      />

      {!audience ? (
        <SectionPlaceholder
          description="Identify who your brand serves and your key audience segments."
          prompt="Define the target audience for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="md">
          {audience.description && (
            <text.p
              as="paragraph"
              size={0}
              >
              {audience.description}
            </text.p>
          )}

          {audience.segments && audience.segments.length > 0 && (
            <ul className={styles.bulletList}>
              {audience.segments.map((segment) => (
                <li key={segment}><text.span as="paragraph">{segment}</text.span></li>
              ))}
            </ul>
          )}
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MISSION                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function MissionSection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const mission = data?.mission;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="10"
        label="Purpose"
        title="Our Mission"
        brand={brand}
      />

      {!mission ? (
        <SectionPlaceholder
          description="Define your brand's mission, story, and core values."
          prompt="Define the mission statement, brand story, and core values for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          {mission.statement && (
            <Quote brand={brand} text={mission.statement} size="lg" />
          )}

          {mission.story && (
            <text.p as="paragraph" size={0} style={{ opacity: 0.85 }}>
              {mission.story}
            </text.p>
          )}

          {mission.values && mission.values.length > 0 && (
            <div className={styles.softCard}>
              <Box gap="sm">
                <text.h4 as="title" size={0}>Core Values</text.h4>
                <ul className={styles.bulletList}>
                  {mission.values.map((v) => (
                    <li key={v}><text.span as="paragraph">{v}</text.span></li>
                  ))}
                </ul>
              </Box>
            </div>
          )}
        </Box>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  LAYOUT & SPACING                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function LayoutSection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
} & SectionThemeProps) {
  const layout = data?.layout;

  const items = layout
    ? [
        { label: 'Grid System', value: layout.grid },
        { label: 'Spacing', value: layout.spacing },
        { label: 'Components', value: layout.components },
      ].filter((item) => item.value)
    : [];

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="11"
        label="Layout & Spacing"
        title="Structure"
        brand={brand}
      />

      {!layout || items.length === 0 ? (
        <SectionPlaceholder
          description="Set up your grid system, spacing, and component patterns."
          prompt="Define the layout and spacing guidelines for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box orientation="horizontal" gap="md">
          {items.map((item) => (
            <div
              key={item.label}
              className={`${styles.softCard} ${styles.flexOne}`}
            >
              <Box gap="sm">
                <text.span as="caption">{item.label}</text.span>
                <text.p
                  as="paragraph"
                  >
                  {item.value}
                </text.p>
              </Box>
            </div>
          ))}
        </Box>
      )}
    </SectionWrapper>
  );
}
