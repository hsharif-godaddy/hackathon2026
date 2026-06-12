import type { SecretDefinition, SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'

const GENERIC_TITLES = new Set([
  'add secret',
  'add secrets',
  'new secret',
  'update secret',
])

function normalizeAgentTitle(title: string): string {
  return title
    .replace(/\s+required\.?$/i, '')
    .replace(/\s+keys?\s+required\.?$/i, ' keys')
    .trim()
}

function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.has(title.trim().toLowerCase())
}

function titleCaseWord(word: string): string {
  if (!word) return word
  const lower = word.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function subjectFromSecretNames(secrets: SecretDefinition[]): string {
  if (secrets.length === 0) {
    return ''
  }

  const prefixes = secrets
    .map((secret) => secret.name.split('_')[0])
    .filter((prefix) => prefix.length > 0)

  if (prefixes.length > 0 && prefixes.every((prefix) => prefix === prefixes[0])) {
    return titleCaseWord(prefixes[0])
  }

  return secrets[0].name.replace(/_/g, ' ').toLowerCase()
}

function descriptionLead(payload: SecretsRequestPayload): string {
  const description = payload.description?.trim() ?? ''
  if (!description) {
    return ''
  }
  const clause = description.split(/[.!?]/)[0]?.trim() ?? ''
  return clause.length > 0 && clause.length <= 80 ? clause : description
}

export function secretsPanelTitle(payload: SecretsRequestPayload): string {
  const title = payload.title?.trim() ?? ''
  if (title && !isGenericTitle(title)) {
    return normalizeAgentTitle(title)
  }

  const lead = descriptionLead(payload)
  if (lead) {
    return lead
  }

  if (payload.secrets.length === 1) {
    const onlyDescription = payload.secrets[0].description?.trim()
    if (onlyDescription) {
      return onlyDescription
    }
  }

  const fromNames = subjectFromSecretNames(payload.secrets)
  if (fromNames) {
    return fromNames
  }

  if (title) {
    return title
  }

  return ''
}
