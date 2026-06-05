import { describe, expect, it } from 'vitest'

import { parseMediaType } from '@/lib/inbox/mime/core'

describe('parseMediaType', () => {
  it('maps images to type image with the image subtype', () => {
    expect(parseMediaType('image/png')).toEqual({
      type: 'image',
      subType: 'image',
      extension: 'png',
    })
    expect(parseMediaType('image/jpeg')).toEqual({
      type: 'image',
      subType: 'image',
      extension: 'jpg',
    })
  })

  it('maps video to type video with the video subtype', () => {
    expect(parseMediaType('video/mp4')).toEqual({
      type: 'video',
      subType: 'video',
      extension: 'mp4',
    })
  })

  it('maps audio to type audio with the audio subtype', () => {
    expect(parseMediaType('audio/mpeg')).toEqual({
      type: 'audio',
      subType: 'audio',
      extension: 'mp3',
    })
  })

  it('maps PDFs to a document with the pdf subtype', () => {
    expect(parseMediaType('application/pdf')).toEqual({
      type: 'document',
      subType: 'pdf',
      extension: 'pdf',
    })
  })

  it('maps archives to a document with the file subtype', () => {
    expect(parseMediaType('application/zip')).toEqual({
      type: 'document',
      subType: 'file',
      extension: 'zip',
    })
  })

  it('maps CSV to a document with the spreadsheet subtype', () => {
    expect(parseMediaType('text/csv')).toEqual({
      type: 'document',
      subType: 'spreadsheet',
      extension: 'csv',
    })
  })

  it('derives the general type from the prefix for unknown subtypes (video)', () => {
    // unmapped video → general split gives type video, default-case subType video
    expect(parseMediaType('video/x-matroska')).toEqual({
      type: 'video',
      subType: 'video',
    })
  })

  it('derives the general type from the prefix for unknown subtypes (audio)', () => {
    expect(parseMediaType('audio/x-aiff')).toEqual({
      type: 'audio',
      subType: 'audio',
    })
  })

  it('falls back to document with no subtype for unknown non-media types', () => {
    expect(parseMediaType('application/octet-stream')).toEqual({
      type: 'document',
      subType: undefined,
    })
  })

  it('treats an unmapped image as type image with no subtype', () => {
    // general prefix is a media type, but the specific MIME is unmapped
    expect(parseMediaType('image/x-unknown')).toEqual({
      type: 'image',
      subType: undefined,
    })
  })
})
