export type PreviewFixContext = {
  source: 'server' | 'iframe'
  status?: 'failed' | 'error'
  failureKind?: 'crash-loop'
}
