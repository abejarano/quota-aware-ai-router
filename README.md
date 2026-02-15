# Quota-Aware AI Router

Router de proveedores LLM con control de cuota, rate-limit, concurrencia y fallback inteligente usando Redis.

## Motivación

En entornos reales, depender de un solo proveedor de IA suele generar fallas por cuota, latencia variable y límites de facturación inesperados. Este proyecto nace para evitar interrupciones en producción y controlar costos sin sacrificar disponibilidad.

La idea central es tratar a los proveedores como un pool dinámico: priorizar los más saludables y económicos, distribuir carga con reglas claras, y mantener rutas de contingencia cuando un proveedor falla o se queda sin presupuesto.

## Estado actual del proyecto

- Es una librería TypeScript orientada a backend (no incluye servidor HTTP).
- El entrypoint útil del router está en `src/index.ts` y exporta `AIProviderRouterService`.
- Soporta proveedores: `groq`, `gemini`, `cerebras`, `openrouter`, `cloudflare`.
- Requiere Redis para operar (presupuestos, ventanas y métricas viven en Redis).

## Qué resuelve

- Evita quemar un solo proveedor cuando tienes varios.
- Distribuye tráfico por prioridad + salud + presupuesto restante.
- Aplica límites por día (`dailyBudgetRequests`, `dailyBudgetTokens`), minuto (`maxRequestsPerMinute`), franja temporal (`AI_SLICE_MINUTES`) y concurrencia (`maxConcurrency`).
- Enfría o bloquea proveedores según tipo de error (429/402/auth/config/invalid response).
- Puede reservar OpenRouter como contingencia y liberarlo cerca del reset diario.

## Arquitectura

- `src/provider/AIProviderRouter.provider.ts`: motor de ruteo, scoring, fallback, presupuestos y métricas.
- `src/provider/*.provider.ts`: integración concreta con cada proveedor.
- `src/helpers/AIProviderConfig.helper.ts`: parse/validación de `AI_PROVIDER_CONFIG`.
- `src/helpers/BuildAIProviderError.helper.ts`: normalización de errores a códigos internos.
- `src/errors/AIProviderError.ts`: contrato de errores tipados.
- `src/ai.interface.ts`: interfaces compartidas (`IProxyAIProvider`, `AIExecutionMeta`, etc.).

## Estrategia de selección (resumen)

Para cada proveedor el router:

1. Valida elegibilidad (no bloqueado, no cooldown, presupuesto disponible, RPM, concurrencia).
2. Calcula score con prioridad, salud histórica y capacidad disponible.
3. Penaliza si los headers externos reportan `remaining` bajo.
4. Ordena por score descendente y ejecuta fallback en cadena.

Si un proveedor responde JSON inválido y el servicio implementa `repairInvalidResponse`, aplica un segundo intento de reparación.

## Requisitos

- Bun (recomendado por el proyecto)
- Redis accesible desde la app
- `AI_PROVIDER_CONFIG` válido en formato JSON

## Instalación

```bash
bun install
```

## Configuración

1. Copia el ejemplo:

```bash
cp .env.example .env
```

2. Completa credenciales y presupuestos.

Variables obligatorias:

- `REDIS_HOST`
- `REDIS_PORT`
- `AI_PROVIDER_CONFIG`
- `AI_SLICE_MINUTES`
- `AI_SLICE_BURST_FACTOR`
- `AI_EXTERNAL_REMAINING_LOW_THRESHOLD`
- `AI_RESERVE_OPENROUTER`
- `AI_OPENROUTER_RELEASE_HOURS_TO_RESET`
- `AI_OPENROUTER_RELEASE_PRIMARY_REMAINING_THRESHOLD`
- `AI_COOLDOWN_RATE_LIMIT_SECONDS`
- `AI_COOLDOWN_PROVIDER_ERROR_SECONDS`
- `AI_BLOCK_PAYMENT_REQUIRED_SECONDS`

### Formato de `AI_PROVIDER_CONFIG`

`AI_PROVIDER_CONFIG` debe ser un JSON array; cada entrada requiere:

- `provider`: `groq | gemini | cerebras | openrouter | cloudflare`
- `apiKey`: string
- `model`: string
- `priority`: number
- `dailyBudgetRequests`: number
- `dailyBudgetTokens`: number
- `maxConcurrency`: number
- `maxRequestsPerMinute`: number
- `enabled`: boolean (opcional, default `true`)

Compatibilidad: el campo legacy `serviceName` sigue siendo aceptado como alias de `provider`.

## Sección de ejemplo

Ejemplo de un **agente financiero** que usa el router para generar una recomendación estructurada:

```ts
import "dotenv/config";
import type { Schema } from "@google/generative-ai";
import { AIProviderRouterService } from "./src";

type FinancialAgentResponse = {
  asset: string;
  action: "buy" | "hold" | "sell";
  confidence: number;
  rationale: string;
  riskLevel: "low" | "medium" | "high";
  timeHorizon: "short" | "medium" | "long";
  disclaimer: string;
};

const schema: Schema = {
  type: "object",
  properties: {
    asset: { type: "string" },
    action: { type: "string", enum: ["buy", "hold", "sell"] },
    confidence: { type: "number" },
    rationale: { type: "string" },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] },
    timeHorizon: { type: "string", enum: ["short", "medium", "long"] },
    disclaimer: { type: "string" },
  },
  required: [
    "asset",
    "action",
    "confidence",
    "rationale",
    "riskLevel",
    "timeHorizon",
    "disclaimer",
  ],
};

const router = AIProviderRouterService.getInstance();

const result = await router.execute<FinancialAgentResponse>({
  systemPrompt:
    "Eres un agente financiero conservador. Responde solo con JSON válido.",
  userPrompt:
    "Analiza TSLA para un inversionista minorista con horizonte de 6 meses y perfil de riesgo medio.",
  schema,
  validate: (provider, payload) => {
    const data = payload as Partial<FinancialAgentResponse>;
    if (
      !data.asset ||
      !data.action ||
      typeof data.confidence !== "number" ||
      !data.rationale ||
      !data.riskLevel ||
      !data.timeHorizon ||
      !data.disclaimer
    ) {
      throw new Error(`Respuesta inválida desde ${provider}`);
    }
    if (data.confidence < 0 || data.confidence > 1) {
      throw new Error(`confidence fuera de rango desde ${provider}`);
    }
    return data as FinancialAgentResponse;
  },
});

console.log("Respuesta del agente financiero:", result);

const summary = await router.getDailySummary();
console.log("Métricas diarias del router:", summary);
```

## Errores y comportamiento esperado

- Los errores se encapsulan como `AIProviderError` con códigos: `LIMIT_EXCEEDED`, `AUTH_ERROR`, `INVALID_RESPONSE`, `CONFIG_ERROR`, `PROVIDER_ERROR`.
- En errores 429/427 aplica cooldown temporal.
- En 402 (billing/payment required) bloquea proveedor por ventana más larga.
- Si no hay candidatos elegibles, lanza `LIMIT_EXCEEDED`.

## Verificación local

```bash
bunx tsc --noEmit
```

Compila correctamente en el estado actual del repositorio.
