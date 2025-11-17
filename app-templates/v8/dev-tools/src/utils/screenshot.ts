import { toPng } from 'html-to-image';

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
