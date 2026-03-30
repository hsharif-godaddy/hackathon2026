# Design Extractor

PDF design document extraction tool for RAG pipeline. Extracts design trends page-by-page using AI.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment:

```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Place your PDF at `/tmp/design.pdf` or set `PDF_PATH` in `.env`

## Usage

### Extract design trends from PDF:

```bash
pnpm extract
```

Output files:

- `./output/design-trends.json` - Full extraction with page data
- `./output/design-trends-rag.json` - RAG-ready format

### Generate style guides for classic design styles:

```bash
pnpm generate-styles
```

This uses the extracted trend data to generate comprehensive style guides for classic design styles like Swiss/International Style, Brutalism, Bauhaus, Art Deco, Memphis Design, Flat Design, Skeuomorphism, Neumorphism, and Glassmorphism.

Output file:

- `./output/classic-styles.json` - Generated style guides with modern applications

## Configuration

Environment variables:

- `PDF_PATH` - Path to PDF file (default: `/tmp/design.pdf`)
- `OUTPUT_DIR` - Output directory (default: `./output`)
- `RAG_FILE` - Path to RAG data file for style generation (default: `./output/design-trends-rag.json`)
- `TEST_TREND` - Process only a single trend (e.g., `TEST_TREND="Diffused Worlds"` to test one trend)
- `STYLE_NAME` - Process only a single style (e.g., `STYLE_NAME="Swiss/International Style"` to test one style)
- `OPENAI_API_KEY` - OpenAI credentials

### Test Mode

To test extraction on a single trend before processing the entire document:

```bash
TEST_TREND="Diffused Worlds" pnpm extract
```

This processes only one trend (2 pages), reducing costs while you optimize the extraction.

To test style generation on a single style:

```bash
STYLE_NAME="Swiss/International Style" pnpm generate-styles
```

Available trends:

- Diffused Worlds (pages 4-5)
- Newstalgia (pages 6-7)
- Neo-Nostalgic Patterns (pages 8-9)
- Scroll Stopping Scrapbook (pages 10-11)
- Ethereal Reverie (pages 12-13)
- Power of Gaia (pages 14-15)
- Retro Luxe Rebellion (pages 16-17)
- The Pixel Effect (pages 18-19)
- Playful Classicism (pages 20-21)
- Socie(tea) (pages 22-23)
- Butter Yellow (pages 24-25)
- Bento Blocks (pages 27-28)
- Outlined Play (pages 29-30)
- Type Minimalism (pages 31-32)
- Retro Scrapbook (pages 33-34)
- Floating Minimalism (pages 35-36)

## Output Format

### design-trends.json

```json
[
  {
    "trendName": "Diffused Worlds",
    "pageRange": [4, 5],
    "overviewImagePath": "temp-images/page-4.jpg",
    "assetsImagePath": "temp-images/page-5.jpg",
    "extractedText": "...",
    "trend": {...},
    "extractedAt": "2025-10-01T..."
  }
]
```

### design-trends-rag.json

```json
[
  {
    "trendName": "Diffused Worlds",
    "pages": [4, 5],
    "overviewImage": "temp-images/page-4.jpg",
    "assetsImage": "temp-images/page-5.jpg",
    "extractedText": "...",
    "trend": {
      "name": "Diffused Worlds",
      "description": "...",
      "visualStyle": "...",
      "keyCharacteristics": [...],
      "colorSchemes": [...],
      "typographyStyles": [...],
      "useCases": [...],
      "industries": [...],
      "fonts": [...],
      "graphicElements": [...]
    }
  }
]
```
