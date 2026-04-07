export class BudgetServiceError extends Error {
  readonly statusCode: number
  readonly responseBody: string

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message)
    this.name = 'BudgetServiceError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

export class BudgetServiceUnavailableError extends BudgetServiceError {
  constructor(message: string, cause?: Error) {
    super(message, 0, '')
    this.name = 'BudgetServiceUnavailableError'
    if (cause) this.cause = cause
  }
}

export class BudgetServiceAuthError extends BudgetServiceError {
  constructor(message: string, statusCode: number, responseBody: string) {
    super(message, statusCode, responseBody)
    this.name = 'BudgetServiceAuthError'
  }
}

export class BudgetServiceTimeoutError extends BudgetServiceError {
  constructor(message: string, cause?: Error) {
    super(message, 0, '')
    this.name = 'BudgetServiceTimeoutError'
    if (cause) this.cause = cause
  }
}
