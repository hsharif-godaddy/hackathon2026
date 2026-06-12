export class FileTooLargeError extends Error {
  constructor(public readonly fileName: string, public readonly limit: number) {
    super(`${fileName} exceeds limit`)
    this.name = 'FileTooLargeError'
  }
}

export class FileReadError extends Error {
  constructor(public readonly fileName: string) {
    super(`Failed to read ${fileName}`)
    this.name = 'FileReadError'
  }
}

export class MaliciousContentError extends Error {
  constructor(public readonly fileName: string) {
    super(`Malicious content detected in ${fileName}`)
    this.name = 'MaliciousContentError'
  }
}
