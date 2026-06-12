export enum ScanResultStatus {
  OKAY = 'okay',
  MALICIOUS = 'malicious',
  UNAVAILABLE = 'unavailable',
}

export type FileScanResult =
  | { pass: true; status: ScanResultStatus.OKAY }
  | { pass: false; status: ScanResultStatus.MALICIOUS; message: string }
  | { pass: false; status: ScanResultStatus.UNAVAILABLE };

type ScanResponse = {
  status: number;
  body: { message?: string };
};

async function fetchScan(base64: string, fileName: string): Promise<ScanResponse | null> {
  try {
    const response = await fetch('/api/files/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64, fileName }),
    });
    const body = await response.json()
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/** Converts a Uint8Array to a base64 string using a loop to avoid call-stack overflow from spread on large buffers. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Sends a file to the BFF `/api/files/scan` endpoint for server-side virus scanning.
 * Returns UNAVAILABLE when the scanner is unreachable or returns an unexpected status; callers decide whether to block or warn.
 */
export async function scanFile(buffer: ArrayBuffer, fileName: string): Promise<FileScanResult> {
  const base64 = uint8ToBase64(new Uint8Array(buffer));
  const scanResponse = await fetchScan(base64, fileName);

  if (!scanResponse) {
    return { pass: false, status: ScanResultStatus.UNAVAILABLE };
  }

  if (scanResponse.status === 422) {
    return { pass: false, status: ScanResultStatus.MALICIOUS, message: scanResponse.body.message ?? 'Malware found in file' };
  }

  if (scanResponse.status < 200 || scanResponse.status >= 300) {
    return { pass: false, status: ScanResultStatus.UNAVAILABLE };
  }

  return { pass: true, status: ScanResultStatus.OKAY };
}
