import { toPng } from 'html-to-image';

const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/**
 * Captures a screenshot of the entire document body and resizes it to 512px wide
 *
 * @returns Promise resolving to a data URL of the screenshot (PNG format, 512px wide)
 */
export async function captureAndResizeScreenshot(): Promise<string | null> {
  try {
    // Capture the entire body as PNG
    const fullCapture = await toPng(document.body, {
      quality: 0.95,
      cacheBust: true,
      skipAutoScale: true,
      pixelRatio: 1,
    });

    // Load the capture into an image
    const img = new Image();
    img.src = fullCapture;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
    });

    // Calculate new dimensions (512px wide, maintain aspect ratio)
    const targetWidth = 512;
    const scale = targetWidth / img.width;
    const targetHeight = Math.round(img.height * scale);

    // Create canvas for resizing
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Draw the resized image
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // Convert to data URL with compression
    return canvas.toDataURL('image/png', 0.8);
  } catch (error) {
    console.error('Failed to capture and resize screenshot:', error);
    return null;
  }
}

/**
 * Captures a region of the full document (in document coordinates) and returns
 * the cropped result as a PNG data URL. Used by annotation mode to capture only
 * the area that contains the user's drawn boxes.
 */
export async function captureCroppedDocumentScreenshot(
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number
): Promise<string | null> {
  try {
    const docWidth = document.documentElement.scrollWidth;
    const docHeight = document.documentElement.scrollHeight;

    const fullPage = await toPng(document.body, {
      quality: 0.95,
      pixelRatio: 1,
      width: docWidth,
      height: docHeight,
      fetchRequestInit: { cache: 'no-cache' },
    });

    const img = new Image();
    img.src = fullPage;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
    });

    const x = Math.max(0, Math.floor(cropX));
    const y = Math.max(0, Math.floor(cropY));
    const w = Math.max(1, Math.min(img.width - x, Math.ceil(cropWidth)));
    const h = Math.max(1, Math.min(img.height - y, Math.ceil(cropHeight)));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

    return canvas.toDataURL('image/png', 0.9);
  } catch (error) {
    console.error('Failed to capture cropped document screenshot:', error);
    return null;
  }
}

/**
 * Captures a screenshot of the current viewport (window.innerWidth × window.innerHeight).
 *
 * Safari workaround: Uses retry mechanism with size checking as recommended in
 * https://github.com/bubkoo/html-to-image/issues/361
 *
 * Safari has a known issue where images don't load on the first toPng() call.
 * Multiple attempts are made until the data URL size stabilizes, indicating images are loaded.
 */
export async function captureViewportScreenshot(): Promise<string | null> {
  try {
    let dataUrl = '';
    const maxAttempts = isSafari ? 5 : 1;
    const sizeHistory: number[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      dataUrl = await toPng(document.body, {
        quality: 0.95,
        pixelRatio: 1,
        width: window.innerWidth,
        height: window.innerHeight,
        fetchRequestInit: {
          cache: 'no-cache',
        },
      });

      sizeHistory[attempt] = dataUrl.length;

      if (isSafari && attempt > 1) {
        const currentSize = sizeHistory[attempt];
        const previousSize = sizeHistory[attempt - 1];
        const percentIncrease = ((currentSize - previousSize) / previousSize) * 100;

        if (percentIncrease > 50 || Math.abs(percentIncrease) < 1) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    return dataUrl;
  } catch (error) {
    console.error('Failed to capture viewport screenshot:', error);
    return null;
  }
}
