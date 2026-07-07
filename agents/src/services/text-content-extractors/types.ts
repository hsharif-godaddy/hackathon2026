import type { Buffer } from 'node:buffer'

export type TextContentExtractor = (buffer: Buffer) => Promise<string>
