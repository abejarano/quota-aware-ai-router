type AIProviderConfigEntry = {
  provider: string
  apiKey: string
  model: string
  priority: number
  dailyBudgetRequests: number
  dailyBudgetTokens: number
  maxConcurrency: number
  maxRequestsPerMinute: number
  enabled?: boolean
}

let cacheRaw: string | undefined
let cacheParsed: AIProviderConfigEntry[] | undefined

const toNumber = (value: unknown): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number value: ${String(value)}`)
  }
  return n
}

const validateEntry = (entry: unknown): AIProviderConfigEntry => {
  if (!entry || typeof entry !== "object") {
    throw new Error("Each AI provider config entry must be an object")
  }

  const e = entry as Record<string, unknown>

  // Prefer `provider`; keep backward-compat with `serviceName`.
  const rawProvider = e.provider ?? e.serviceName
  if (typeof rawProvider !== "string" || !rawProvider.trim()) {
    throw new Error("AI provider config requires non-empty 'provider'")
  }
  const provider = rawProvider.trim().toLowerCase()

  if (typeof e.apiKey !== "string") {
    throw new Error(
      `AI provider '${provider}' requires string 'apiKey'`
    )
  }

  if (typeof e.model !== "string" || !e.model.trim()) {
    throw new Error(
      `AI provider '${provider}' requires non-empty 'model'`
    )
  }

  return {
    provider,
    apiKey: e.apiKey,
    model: e.model.trim(),
    priority: toNumber(e.priority),
    dailyBudgetRequests: toNumber(e.dailyBudgetRequests),
    dailyBudgetTokens: toNumber(e.dailyBudgetTokens),
    maxConcurrency: toNumber(e.maxConcurrency),
    maxRequestsPerMinute: toNumber(e.maxRequestsPerMinute),
    enabled:
      typeof e.enabled === "boolean"
        ? e.enabled
        : e.enabled === undefined
          ? true
          : String(e.enabled).toLowerCase() !== "false",
  }
}

export const readAIProviderConfig = (): AIProviderConfigEntry[] => {
  const raw = process.env.AI_PROVIDER_CONFIG

  if (!raw) {
    throw new Error("Missing AI_PROVIDER_CONFIG environment variable")
  }

  if (cacheParsed && cacheRaw === raw) {
    return cacheParsed
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("AI_PROVIDER_CONFIG must be valid JSON")
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI_PROVIDER_CONFIG must be a JSON array")
  }

  const providers = parsed.map(validateEntry)
  const providerNames = new Set<string>()
  for (const p of providers) {
    if (providerNames.has(p.provider)) {
      throw new Error(
        `Duplicated provider in AI_PROVIDER_CONFIG: ${p.provider}`
      )
    }
    providerNames.add(p.provider)
  }

  cacheRaw = raw
  cacheParsed = providers
  return providers
}

export const findAIProviderByProvider = (
  provider: string
): AIProviderConfigEntry | undefined => {
  return readAIProviderConfig().find(
    (p) => p.provider === provider.toLowerCase() && p.enabled !== false
  )
}

// Backward-compat export (serviceName -> provider)
export const findAIProviderByService = findAIProviderByProvider
