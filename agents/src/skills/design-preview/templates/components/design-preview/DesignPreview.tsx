/* === managed by design-preview skill — do not edit === */
import type { ReactNode } from 'react';
import styles from './styles.module.css';

export interface PaletteEntry {
  token: string;
  hex: string;
  name: string;
}

export interface DesignPreviewProps {
  brandName: string;
  tagline: string;
  palette: PaletteEntry[];
  /** Optional custom element showcasing a brand-specific component (hero, signature card, etc.) */
  showcase?: ReactNode;
}

export default function DesignPreview(props: DesignPreviewProps) {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.brandName}>{props.brandName}</h1>
          <p className={styles.tagline}>{props.tagline}</p>
        </header>

        {props.showcase && (
          <section className={styles.section}>
            <p className={styles.eyebrow}>— Showcase —</p>
            <div className={styles.showcaseContainer}>
              {props.showcase}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <p className={styles.eyebrow}>— Palette —</p>
          <div className={styles.paletteGrid}>
            {props.palette.map((entry) => (
              <div key={entry.token} className={styles.swatchCard}>
                <div
                  className={styles.swatch}
                  style={{ background: entry.hex }}
                />
                <div className={styles.swatchName}>{entry.name}</div>
                <div className={styles.swatchHex}>{entry.hex}</div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.eyebrow}>— Typography —</p>
          <div className={styles.typeShowcase}>
            <h3 className={styles.displaySample}>
              The quick brown fox jumps over the lazy dog
            </h3>
            <p className={styles.bodySample}>
              Good typography is invisible. Great typography is felt before it is seen —
              it sets the tone, establishes trust, and guides the reader through the
              experience without drawing attention to itself.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.eyebrow}>— Components —</p>
          <div className={styles.componentRow}>
            <button className={styles.btnPrimary}>Primary action</button>
            <button className={styles.btnSecondary}>Secondary</button>
            <input className={styles.input} placeholder="Input field" />
          </div>
          <div className={styles.cardRow}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Card title</h3>
              <p className={styles.cardBody}>
                Card body copy. Surfaces, borders, and corners all render
                from the design tokens above.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
