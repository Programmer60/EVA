# EVA Chat API Debug and Fallback Implementation Log

Date: 2026-03-18

## Problem Summary

The chat endpoint was failing with 500 and then 502/429 responses.
Frontend showed errors such as:
- Unexpected token '<' when parsing response JSON (earlier stage)
- 429 Too Many Requests
- 502 Bad Gateway
- Model did not return a reply

## Root Causes Found

1. Missing runtime env file
- .env.local did not exist initially, so required runtime values were not loaded.

2. MongoDB connection failure path was not user-friendly
- Connection/env failures could surface as generic failures.

3. Gemini provider quota issue
- Gemini API returned RESOURCE_EXHAUSTED (429).
- This was provider quota exhaustion, not app-level one-message rate limiting.

4. Invalid model settings during migration
- Gemini model gemini-1.5-flash returned NOT_FOUND in this API path.
- OpenRouter model mistralai/mistral-7b-instruct returned no endpoint found.

5. Fallback response parsing mismatch
- OpenRouter response content format can vary (string/object/array).
- Initial extraction path did not cover all shapes, causing empty reply.

## Code Fixes Applied

### 1) Mongo and env reliability
- Updated lib/mongodb.ts:
  - Use MONGODB_URI with DATABASE_URL fallback.
  - Throw clear AppError messages for missing URI and connection failures.
- Updated env examples and local env setup.

### 2) Added provider fallback (Gemini -> OpenRouter)
- Updated app/api/chat/route.ts:
  - Gemini remains primary provider.
  - On Gemini failure, automatically try OpenRouter.
  - Return clear errors if both providers fail.

### 3) Extended env configuration for fallback
- Updated lib/env.ts with:
  - openRouterApiKey
  - openRouterModel

### 4) Improved OpenRouter output extraction
- Updated app/api/chat/route.ts:
  - Parse OpenRouter content when it is string, object, or array.
  - Increased max_tokens for fallback response.

### 5) Runtime model settings corrected
- Updated .env.local values:
  - GEMINI_MODEL=gemini-2.0-flash
  - OPENROUTER_MODEL=openrouter/auto

## Validation Steps and Results

1. Health check
- GET /api/health -> 200 OK

2. History API
- GET /api/history -> 200 OK

3. Chat API before fallback fixes
- POST /api/chat -> 429 or 502 depending on provider/model state

4. Chat API after fallback and model corrections
- POST /api/chat -> 200 with valid JSON reply

## Final Behavior

Current behavior is:
1. Accept request and store user message in MongoDB.
2. Try Gemini.
3. If Gemini fails (quota/model/provider), try OpenRouter.
4. Parse provider output and return assistant reply.
5. Store assistant reply in MongoDB.

## Security Notes

- API keys should not be committed to source control.
- Rotate keys immediately if exposed in screenshots/chat/logs.
- Keep .env.local in gitignore.

## Files Changed During Fix

- app/api/chat/route.ts
- lib/env.ts
- lib/mongodb.ts
- .env.local.example
- .env.local

## Recommended Next Steps

1. Keep OpenRouter fallback enabled for reliability.
2. Add a providerUsed field in API response for easy frontend diagnostics.
3. Add a small provider health endpoint (Gemini/OpenRouter status).
4. Add integration tests for:
   - Gemini success path
   - Gemini fail -> OpenRouter success path
   - Both providers fail path
