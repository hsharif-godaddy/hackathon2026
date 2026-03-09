const fs = jest.createMockFromModule<typeof import('fs')>('fs');

// Mock certificate - obviously fake to avoid GitHub secret scanning
const mockCert = `-----BEGIN CERTIFICATE-----
MOCK_CERTIFICATE_FOR_TESTING_NOT_A_REAL_CERT
THIS_IS_A_JEST_MOCK_FILE_FOR_UNIT_TESTS
-----END CERTIFICATE-----`;

// Mock private key - obviously fake to avoid GitHub secret scanning
const mockKey = `-----BEGIN PRIVATE KEY-----
MOCK_PRIVATE_KEY_FOR_TESTING_NOT_A_REAL_KEY
THIS_IS_A_JEST_MOCK_FILE_FOR_UNIT_TESTS
-----END PRIVATE KEY-----`;

fs.existsSync = jest.fn(() => true);

// gd-auth-client@2 pulls in @aws-sdk which reads fs.promises at module load time.
// Provide a minimal promises shim so those modules initialise without crashing.
(fs as unknown as Record<string, unknown>).promises = {
  readFile: jest.fn().mockResolvedValue(Buffer.from('')),
  stat: jest.fn().mockResolvedValue({ size: 0, mtime: new Date() }),
};

(fs.readFileSync as jest.Mock) = jest.fn((path: unknown) => {
  const pathStr = String(path);

  // Return appropriate mock based on file extension/path
  if (pathStr.includes('.crt') || pathStr.includes('.pem') || pathStr.includes('cert')) {
    return Buffer.from(mockCert);
  }

  if (pathStr.includes('.key') || pathStr.includes('key')) {
    return Buffer.from(mockKey);
  }

  // Throw for unexpected paths to catch test configuration issues
  throw new Error(`Unexpected file path in fs mock: ${pathStr}`);
});

module.exports = fs;
