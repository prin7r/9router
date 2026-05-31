/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { CLIENT_METADATA, getPlatformUserAgent } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// GitHub API config
const GITHUB_CONFIG = {
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

// GLM quota endpoints (region-aware)
const GLM_QUOTA_URLS = {
  international: "https://api.z.ai/api/monitor/usage/quota/limit",
  china: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
};

// MiniMax usage endpoints (try in order, fallback on transient errors)
const MINIMAX_USAGE_URLS = {
  minimax: [
    "https://www.minimax.io/v1/token_plan/remains",
    "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
  ],
  "minimax-cn": [
    "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
  ],
};

// Antigravity API config (from Quotio)
const ANTIGRAVITY_CONFIG = {
  quotaApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  loadProjectApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  userAgent: getPlatformUserAgent(),
};

// Codex (OpenAI) API config
const CODEX_CONFIG = {
  usageUrl: "https://chatgpt.com/backend-api/wham/usage",
};

// Claude API config
const CLAUDE_CONFIG = {
  oauthUsageUrl: "https://api.anthropic.com/api/oauth/usage",
  usageUrl: "https://api.anthropic.com/v1/organizations/{org_id}/usage",
  settingsUrl: "https://api.anthropic.com/v1/settings",
  apiVersion: "2023-06-01",
};

const OPENROUTER_CONFIG = {
  keyUrl: "https://openrouter.ai/api/v1/key",
  creditsUrl: "https://openrouter.ai/api/v1/credits",
};

const GROQ_CONFIG = {
  chatCompletionsUrl: "https://api.groq.com/openai/v1/chat/completions",
  probeModel: "openai/gpt-oss-20b",
};

const FREEMODEL_CONFIG = {
  apiBaseUrl: "https://api.freemodel.dev",
  dashboardBaseUrl: "https://freemodel.dev",
};

const COMMAND_CODE_CONFIG = {
  apiBaseUrl: "https://api.commandcode.ai",
  cliVersion: "0.25.12",
};

const COMMAND_CODE_MONTHLY_CREDITS = {
  "individual-go": 10,
  "individual-pro": 30,
  "individual-max": 150,
  "individual-ultra": 300,
  "teams-pro": 40,
};

const COMMAND_CODE_PLAN_LABELS = {
  "individual-go": "Command Code Go",
  "individual-pro": "Command Code Pro",
  "individual-max": "Command Code Max",
  "individual-ultra": "Command Code Ultra",
  "teams-pro": "Command Code Teams Pro",
};

const OPENCODE_GO_CONFIG = {
  usageUrl: "https://opencode.ai/workspace/{workspaceId}/go",
  rollingLimitUsd: 12,
  weeklyLimitUsd: 30,
  monthlyLimitUsd: 60,
};

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, providerSpecificData } = connection;

  switch (provider) {
    case "github":
      return await getGitHubUsage(accessToken, providerSpecificData, proxyOptions);
    case "gemini-cli":
      return await getGeminiUsage(accessToken, providerSpecificData, proxyOptions);
    case "antigravity":
      return await getAntigravityUsage(accessToken, providerSpecificData, proxyOptions);
    case "claude":
      return await getClaudeUsage(accessToken, proxyOptions);
    case "codex":
      return await getCodexUsage(accessToken, proxyOptions);
    case "kiro":
      return await getKiroUsage(accessToken, providerSpecificData, proxyOptions);
    case "qwen":
      return await getQwenUsage(accessToken, providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken);
    case "ollama":
      return await getOllamaUsage(accessToken);
    case "openrouter":
      return await getOpenRouterUsage(apiKey || accessToken, proxyOptions);
    case "groq":
      return await getGroqUsage(apiKey || accessToken, proxyOptions);
    case "freemodel":
      return await getFreeModelUsage(apiKey || accessToken, providerSpecificData, proxyOptions);
    case "commandcode":
      return await getCommandCodeUsage(apiKey || accessToken, proxyOptions);
    case "opencode-go":
      return await getOpenCodeGoUsage(providerSpecificData, proxyOptions);
    case "glm":
    case "glm-cn":
      return await getGlmUsage(apiKey, provider, proxyOptions);
    case "minimax":
    case "minimax-cn":
      return await getMiniMaxUsage(apiKey, provider, proxyOptions);
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

/**
 * GitHub Copilot Usage
 * Uses GitHub accessToken (not copilotToken) to call copilot_internal/user API
 */
async function getGitHubUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    if (!accessToken) {
      throw new Error("No GitHub access token available. Please re-authorize the connection.");
    }

    // copilot_internal/user API requires GitHub OAuth token, not copilotToken
    const response = await proxyAwareFetch("https://api.github.com/copilot_internal/user", {
      headers: {
        "Authorization": `token ${accessToken}`,
        "Accept": "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
        "Editor-Version": "vscode/1.100.0",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    }, proxyOptions);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const data = await response.json();

    // Handle different response formats (paid vs free)
    if (data.quota_snapshots) {
      // Paid plan format
      const snapshots = data.quota_snapshots;
      const resetAt = parseResetTime(data.quota_reset_date);

      return {
        plan: data.copilot_plan,
        resetDate: data.quota_reset_date,
        quotas: {
          chat: { ...formatGitHubQuotaSnapshot(snapshots.chat), resetAt },
          completions: { ...formatGitHubQuotaSnapshot(snapshots.completions), resetAt },
          premium_interactions: { ...formatGitHubQuotaSnapshot(snapshots.premium_interactions), resetAt },
        },
      };
    } else if (data.monthly_quotas || data.limited_user_quotas) {
      // Free/limited plan format
      const monthlyQuotas = data.monthly_quotas || {};
      const usedQuotas = data.limited_user_quotas || {};
      const resetAt = parseResetTime(data.limited_user_reset_date);

      return {
        plan: data.copilot_plan || data.access_type_sku,
        resetDate: data.limited_user_reset_date,
        quotas: {
          chat: {
            used: usedQuotas.chat || 0,
            total: monthlyQuotas.chat || 0,
            unlimited: false,
            resetAt,
          },
          completions: {
            used: usedQuotas.completions || 0,
            total: monthlyQuotas.completions || 0,
            unlimited: false,
            resetAt,
          },
        },
      };
    }

    return { message: "GitHub Copilot connected. Unable to parse quota data." };
  } catch (error) {
    throw new Error(`Failed to fetch GitHub usage: ${error.message}`);
  }
}

function formatGitHubQuotaSnapshot(quota) {
  if (!quota) return { used: 0, total: 0, unlimited: true };

  return {
    used: quota.entitlement - quota.remaining,
    total: quota.entitlement,
    remaining: quota.remaining,
    unlimited: quota.unlimited || false,
  };
}

/**
 * Gemini CLI Usage — fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */
async function getGeminiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup
    let projectId = providerSpecificData?.projectId || null;
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = subInfo?.cloudaicompanionProject || null;
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return { plan, message: "Gemini CLI project ID not available." };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await proxyAwareFetch(
        "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ project: projectId }),
          signal: controller.signal,
        },
        proxyOptions
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Gemini CLI error: ${error.message}` };
  }
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await proxyAwareFetch(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
        signal: controller.signal,
      },
      proxyOptions
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */
async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
    const projectId = subscriptionInfo?.cloudaicompanionProject || null;

    // Fetch quota data with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    let response;
    try {
      response = await proxyAwareFetch(ANTIGRAVITY_CONFIG.quotaApiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": "1.107.0",
          "x-request-source": "local", // MITM bypass
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {})
        }),
        signal: controller.signal,
      }, proxyOptions);
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {}
      };
    }

    if (response.status === 401) {
      return {
        message: "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {}
      };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas = {};

    // Parse model quotas (inspired by vscode-antigravity-cockpit)
    if (data.models) {
      // Filter only recommended/important models (must match PROVIDER_MODELS ag ids)
      const importantModels = [
        'claude-opus-4-6-thinking',
        'claude-sonnet-4-6',
        'gemini-3.1-pro-high',
        'gemini-3.1-pro-low',
        'gemini-3-flash',
        'gpt-oss-120b-medium',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        // Skip models without quota info
        if (!info.quotaInfo) {
          continue;
        }

        // Skip internal models and non-important models
        if (info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
        };
      }
    }

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}

/**
 * Get Antigravity project ID from subscription info
 */
async function getAntigravityProjectId(accessToken) {
  try {
    const info = await getAntigravitySubscriptionInfo(accessToken);
    return info?.cloudaicompanionProject || null;
  } catch {
    return null;
  }
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const response = await proxyAwareFetch(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "x-request-source": "local", // MITM bypass
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
      signal: controller.signal,
    }, proxyOptions);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Claude Usage - Primary: OAuth endpoint, Fallback: legacy settings/org endpoint
 */
async function getClaudeUsage(accessToken, proxyOptions = null) {
  try {
    // Primary: OAuth usage endpoint (Claude Code consumer OAuth tokens)
    const oauthResponse = await proxyAwareFetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas = {};

      // utilization = % USED (e.g. 87 means 87% used, 13% remaining)
      const hasUtilization = (window) =>
        window && typeof window === "object" && typeof window.utilization === "number";

      const createQuotaObject = (window) => {
        const used = window.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(window.resets_at),
          unlimited: false,
        };
      };

      if (hasUtilization(data.five_hour)) {
        quotas["session (5h)"] = createQuotaObject(data.five_hour);
      }

      if (hasUtilization(data.seven_day)) {
        quotas["weekly (7d)"] = createQuotaObject(data.seven_day);
      }

      // Parse model-specific weekly windows (e.g. seven_day_sonnet, seven_day_opus)
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day" && hasUtilization(value)) {
          const modelName = key.replace("seven_day_", "");
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject(value);
        }
      }

      return {
        plan: "Claude Code",
        extraUsage: data.extra_usage ?? null,
        quotas,
      };
    }

    // Fallback: legacy settings + org usage endpoint
    const headerUsage = await getClaudeRateLimitHeaderUsage(accessToken, proxyOptions);
    if (headerUsage) return headerUsage;
    console.warn(`[Claude Usage] OAuth endpoint returned ${oauthResponse.status}, falling back to legacy`);
    return await getClaudeUsageLegacy(accessToken, proxyOptions);
  } catch (error) {
    const headerUsage = await getClaudeRateLimitHeaderUsage(accessToken, proxyOptions);
    if (headerUsage) return headerUsage;
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

async function getClaudeRateLimitHeaderUsage(accessToken, proxyOptions = null) {
  try {
    const headers = {
      "anthropic-version": CLAUDE_CONFIG.apiVersion,
      "content-type": "application/json",
    };
    if (isClaudeApiKey(accessToken)) {
      headers["x-api-key"] = accessToken;
    } else {
      headers["Authorization"] = `Bearer ${accessToken}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
      headers["User-Agent"] = "claude-cli/2.1.92 (external, sdk-cli)";
    }
    const response = await proxyAwareFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "x" }],
      }),
    }, proxyOptions);
    const quotas = {};
    const fiveHour = claudeHeaderQuota(response.headers, "5h", "session (5h)");
    const sevenDay = claudeHeaderQuota(response.headers, "7d", "weekly (7d)");
    if (fiveHour) quotas["session (5h)"] = fiveHour;
    if (sevenDay) quotas["weekly (7d)"] = sevenDay;
    if (Object.keys(quotas).length === 0) return null;
    return {
      plan: "Claude Code",
      source: "provider-api",
      message: response.ok ? "" : `Claude headers available; probe HTTP ${response.status}.`,
      quotas,
    };
  } catch {
    return null;
  }
}

function isClaudeApiKey(value) {
  return typeof value === "string" && /^sk-ant-(api|admin)/i.test(value);
}

function claudeHeaderQuota(headers, windowId, name) {
  const utilization = toFiniteNumber(headers.get(`anthropic-ratelimit-unified-${windowId}-utilization`), NaN);
  const resetEpoch = toFiniteNumber(headers.get(`anthropic-ratelimit-unified-${windowId}-reset`), NaN);
  const status = headers.get(`anthropic-ratelimit-unified-${windowId}-status`) || "";
  if (!Number.isFinite(utilization) && !Number.isFinite(resetEpoch)) return null;
  const used = Number.isFinite(utilization) ? Math.max(0, utilization * 100) : 0;
  const remaining = Math.max(0, 100 - used);
  return {
    used,
    total: 100,
    remaining,
    remainingPercentage: remaining,
    resetAt: Number.isFinite(resetEpoch) ? new Date(resetEpoch * 1000).toISOString() : null,
    unlimited: false,
    status,
    window: windowId === "5h" ? "5h" : "7d",
    name,
  };
}

async function getOpenRouterUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { source: "provider-api", message: "OpenRouter API key not available.", quotas: {} };
  }

  try {
    const [keyResponse, creditsResponse] = await Promise.all([
      fetchOpenRouterJson(apiKey, OPENROUTER_CONFIG.keyUrl, proxyOptions),
      fetchOpenRouterJson(apiKey, OPENROUTER_CONFIG.creditsUrl, proxyOptions),
    ]);

    if (!keyResponse.ok && !creditsResponse.ok) {
      return {
        source: "provider-api",
        message: `OpenRouter key and credits APIs unavailable (${keyResponse.status}/${creditsResponse.status}).`,
        quotas: {},
      };
    }

    const keyData = unwrapOpenRouterPayload(keyResponse.data);
    const creditsData = unwrapOpenRouterPayload(creditsResponse.data);
    const quotas = {};

    const usage = toFiniteNumber(keyData?.usage, NaN);
    const limit = toFiniteNumber(keyData?.limit, NaN);
    const limitRemaining = toFiniteNumber(keyData?.limit_remaining, NaN);
    if (Number.isFinite(limit) || Number.isFinite(limitRemaining)) {
      const total = Number.isFinite(limit) ? limit : Math.max(0, usage) + Math.max(0, limitRemaining);
      const remaining = Number.isFinite(limitRemaining) ? limitRemaining : Math.max(0, total - Math.max(0, usage));
      quotas.api_key_limit = {
        used: Number.isFinite(usage) ? usage : Math.max(0, total - remaining),
        total,
        remaining,
        remainingPercentage: total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : null,
        resetAt: parseOpenRouterReset(keyData?.limit_reset),
        unlimited: Boolean(keyData?.limit === null && keyData?.limit_remaining === null),
        status: keyData?.disabled ? "disabled" : "",
        window: "monthly",
      };
    }

    const totalCredits = toFiniteNumber(creditsData?.total_credits, NaN);
    const totalUsage = toFiniteNumber(creditsData?.total_usage, NaN);
    if (Number.isFinite(totalCredits) || Number.isFinite(totalUsage)) {
      const total = Number.isFinite(totalCredits) ? totalCredits : Math.max(0, totalUsage);
      const used = Number.isFinite(totalUsage) ? totalUsage : 0;
      const remaining = Math.max(0, total - used);
      quotas.credit_balance = {
        used,
        total,
        remaining,
        remainingPercentage: total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : null,
        resetAt: null,
        unlimited: false,
        status: "",
        window: "balance",
      };
    }

    return {
      plan: keyData?.is_free_tier ? "OpenRouter free tier" : "OpenRouter",
      source: "provider-api",
      account: {
        label: keyData?.label || "",
        is_free_tier: keyData?.is_free_tier ?? null,
        is_provisioning_key: keyData?.is_provisioning_key ?? null,
        is_management_key: keyData?.is_management_key ?? null,
      },
      billingPeriodEnd: parseResetTime(keyData?.expires_at),
      quotas,
      message: keyResponse.ok || creditsResponse.ok ? "" : "OpenRouter connected. No quota payload returned.",
    };
  } catch (error) {
    return { source: "provider-api", message: `OpenRouter usage API error: ${error.message}`, quotas: {} };
  }
}

async function fetchOpenRouterJson(apiKey, url, proxyOptions = null) {
  let response;
  try {
    response = await proxyAwareFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);
  } catch (error) {
    throw error;
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function unwrapOpenRouterPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload.data && typeof payload.data === "object" ? payload.data : payload;
}

function parseOpenRouterReset(value) {
  if (!value) return null;
  if (typeof value === "string" && value.toLowerCase() === "monthly") return "monthly";
  return parseResetTime(value);
}

async function getGroqUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return {
      status: "missing-secret",
      source: "provider-api",
      plan: "Groq",
      message: "Groq API key not available.",
      quotas: {},
    };
  }

  try {
    const response = await proxyAwareFetch(GROQ_CONFIG.chatCompletionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_CONFIG.probeModel,
        messages: [{ role: "user", content: "quota" }],
        max_completion_tokens: 1,
        temperature: 0,
      }),
    }, proxyOptions);

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    const quotas = {};
    const requestQuota = groqQuotaFromHeaders(
      response.headers,
      "x-ratelimit-limit-requests",
      "x-ratelimit-remaining-requests",
      "x-ratelimit-reset-requests",
      "requests",
      "request rate limit",
    );
    const tokenQuota = groqQuotaFromHeaders(
      response.headers,
      "x-ratelimit-limit-tokens",
      "x-ratelimit-remaining-tokens",
      "x-ratelimit-reset-tokens",
      "tokens",
      "token rate limit",
    );
    if (requestQuota) quotas.requests = requestQuota;
    if (tokenQuota) quotas.tokens = tokenQuota;

    const bodyMessage = groqErrorMessage(data);
    if (response.status === 401 || response.status === 403) {
      return {
        status: "requires-reauth",
        source: "provider-api",
        plan: "Groq",
        message: bodyMessage || `Groq API key rejected with HTTP ${response.status}.`,
        quotas,
      };
    }

    if (!response.ok) {
      return {
        status: response.status === 429 ? "rate-limited" : "unavailable",
        source: "provider-api",
        plan: "Groq",
        message: bodyMessage || `Groq chat completions probe returned HTTP ${response.status}.`,
        quotas,
      };
    }

    return {
      status: Object.keys(quotas).length ? "ok" : "unavailable",
      source: "provider-api",
      plan: "Groq",
      message: Object.keys(quotas).length ? "" : "Groq accepted the API key, but did not return rate limit headers.",
      quotas,
      totalTokens: toFiniteNumber(data?.usage?.total_tokens, null),
      extraUsage: {
        probeModel: data?.model || GROQ_CONFIG.probeModel,
        promptTokens: toFiniteNumber(data?.usage?.prompt_tokens, null),
        completionTokens: toFiniteNumber(data?.usage?.completion_tokens, null),
        totalTokens: toFiniteNumber(data?.usage?.total_tokens, null),
      },
    };
  } catch (error) {
    return {
      status: "error",
      source: "provider-api",
      plan: "Groq",
      message: `Groq usage probe failed: ${error.message}`,
      quotas: {},
    };
  }
}

function groqQuotaFromHeaders(headers, limitHeader, remainingHeader, resetHeader, window, name) {
  const limit = toFiniteNumber(headers.get(limitHeader), NaN);
  const remaining = toFiniteNumber(headers.get(remainingHeader), NaN);
  if (!Number.isFinite(limit) && !Number.isFinite(remaining)) return null;

  const total = Number.isFinite(limit) ? limit : Math.max(0, remaining);
  const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : total;
  const used = Math.max(0, total - safeRemaining);
  return {
    name,
    used,
    total,
    remaining: safeRemaining,
    remainingPercentage: total > 0 ? Math.max(0, Math.min(100, (safeRemaining / total) * 100)) : null,
    resetAt: parseGroqReset(headers.get(resetHeader)),
    unlimited: false,
    status: safeRemaining <= 0 ? "rate-limited" : "",
    window,
    source: "provider-api",
  };
}

function parseGroqReset(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const unitPattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)\b/gi;
  let totalMs = 0;
  let matched = false;
  for (const match of raw.matchAll(unitPattern)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount)) continue;
    if (unit === "ms") totalMs += amount;
    else if (unit === "s") totalMs += amount * 1000;
    else if (unit === "m") totalMs += amount * 60_000;
    else if (unit === "h") totalMs += amount * 3_600_000;
    else if (unit === "d") totalMs += amount * 86_400_000;
  }
  if (matched) return new Date(Date.now() + totalMs).toISOString();

  return parseResetTime(raw);
}

function groqErrorMessage(payload) {
  const error = payload?.error;
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || error.error || error.type || "";
}

async function getFreeModelUsage(apiKey, providerSpecificData = {}, proxyOptions = null) {
  const sessionCookie = normalizeFreeModelSessionCookie(providerSpecificData?.sessionCookie);
  if (sessionCookie) {
    const dashboardUsage = await getFreeModelDashboardUsage(sessionCookie, proxyOptions);
    if (dashboardUsage.status === "ok" || !apiKey) return dashboardUsage;
    const apiStatus = await getFreeModelApiKeyStatus(apiKey, proxyOptions);
    return {
      ...apiStatus,
      message: [dashboardUsage.message, apiStatus.message].filter(Boolean).join(" "),
    };
  }

  if (apiKey) return await getFreeModelApiKeyStatus(apiKey, proxyOptions);

  return {
    status: "missing-secret",
    source: "dashboard-session",
    plan: "FreeModel",
    message: "FreeModel dashboard session and API key are not available.",
    quotas: {},
  };
}

async function getFreeModelDashboardUsage(sessionCookie, proxyOptions = null) {
  try {
    const [meResponse, usageResponse, billingResponse] = await Promise.all([
      fetchFreeModelDashboardJson(sessionCookie, "/api/auth/me", proxyOptions),
      fetchFreeModelDashboardJson(sessionCookie, "/api/usage", proxyOptions),
      fetchFreeModelDashboardJson(sessionCookie, "/api/billing", proxyOptions),
    ]);

    if (usageResponse.status === 401 || usageResponse.status === 403) {
      return {
        status: "unavailable",
        source: "dashboard-session",
        plan: "FreeModel",
        message: "FreeModel dashboard session is expired or unauthorized.",
        quotas: {},
      };
    }

    if (!usageResponse.ok) {
      return {
        status: "unavailable",
        source: "dashboard-session",
        plan: "FreeModel",
        message: `FreeModel usage dashboard returned HTTP ${usageResponse.status}.`,
        quotas: {},
      };
    }

    const usage = usageResponse.data || {};
    const billing = billingResponse.ok ? billingResponse.data || {} : {};
    const user = meResponse.ok ? meResponse.data?.user || {} : {};
    const quotas = {};
    const window5h = formatFreeModelWindow(usage.window5h, "5h spend window", "5h");
    const windowWeek = formatFreeModelWindow(usage.windowWeek, "weekly spend window", "7d");
    if (window5h) quotas.window_5h = window5h;
    if (windowWeek) quotas.window_week = windowWeek;

    const creditCents = toFiniteNumber(billing.creditCents, NaN);
    if (Number.isFinite(creditCents)) {
      quotas.credit_balance = {
        used: 0,
        total: creditCents,
        remaining: creditCents,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: false,
        status: billing.billingEnabled === false ? "billing-disabled" : "",
        window: "balance",
        source: "dashboard-session",
      };
    }

    return {
      status: "ok",
      source: "dashboard-session",
      plan: freeModelPlanLabel(billing),
      account: {
        id: user.id != null ? String(user.id) : "",
        email: user.email || "",
        name: user.name || "",
        billingEnabled: billing.billingEnabled ?? null,
        requireVerification: billing.requireVerification ?? null,
      },
      totalTokens: toFiniteNumber(usage.totalTokens, 0),
      quotas,
      extraUsage: {
        totalRequests: toFiniteNumber(usage.totalRequests, 0),
        todayCacheReadTokens: toFiniteNumber(usage.todayCacheReadTokens, 0),
        todayCacheWriteTokens: toFiniteNumber(usage.todayCacheWriteTokens, 0),
        avgLatency: toFiniteNumber(usage.avgLatency, null),
      },
    };
  } catch (error) {
    return {
      status: "error",
      source: "dashboard-session",
      plan: "FreeModel",
      message: `FreeModel dashboard usage fetch failed: ${error.message}`,
      quotas: {},
    };
  }
}

async function getFreeModelApiKeyStatus(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return {
      status: "missing-secret",
      source: "provider-api",
      plan: "FreeModel API",
      message: "FreeModel API key not available.",
      quotas: {},
    };
  }

  try {
    const response = await proxyAwareFetch(`${FREEMODEL_CONFIG.apiBaseUrl}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      return {
        status: "unavailable",
        source: "provider-api",
        plan: "FreeModel API",
        message: `FreeModel models API returned HTTP ${response.status}.`,
        quotas: {},
      };
    }

    const models = Array.isArray(data?.data) ? data.data : [];
    const modelIds = models.map((model) => model?.id).filter(Boolean);
    const preferredModels = modelIds.filter((id) => /^gpt-5\./.test(String(id)) || String(id).includes("codex"));
    return {
      status: "ok",
      source: "provider-api",
      plan: "FreeModel API",
      message: "FreeModel API key accepted. Dashboard session is required for spend windows.",
      quotas: {},
      extraUsage: {
        modelsCount: modelIds.length,
        preferredModels,
      },
    };
  } catch (error) {
    return {
      status: "error",
      source: "provider-api",
      plan: "FreeModel API",
      message: `FreeModel models API error: ${error.message}`,
      quotas: {},
    };
  }
}

async function fetchFreeModelDashboardJson(sessionCookie, pathname, proxyOptions = null) {
  const response = await proxyAwareFetch(`${FREEMODEL_CONFIG.dashboardBaseUrl}${pathname}`, {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
      Accept: "application/json",
      "User-Agent": getPlatformUserAgent(),
    },
  }, proxyOptions);
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function normalizeFreeModelSessionCookie(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/(?:^|;\s*)bm_session=([^;]+)/);
  return match ? `bm_session=${match[1]}` : `bm_session=${raw}`;
}

function formatFreeModelWindow(windowData, name, windowId) {
  if (!windowData || typeof windowData !== "object") return null;
  const used = toFiniteNumber(windowData.usedCents, NaN);
  const total = toFiniteNumber(windowData.limitCents, NaN);
  if (!Number.isFinite(used) && !Number.isFinite(total)) return null;
  const normalizedTotal = Number.isFinite(total) ? total : Math.max(0, used);
  const normalizedUsed = Number.isFinite(used) ? used : 0;
  const remaining = Math.max(0, normalizedTotal - normalizedUsed);
  return {
    name,
    used: normalizedUsed,
    total: normalizedTotal,
    remaining,
    remainingPercentage: normalizedTotal > 0 ? Math.max(0, Math.min(100, (remaining / normalizedTotal) * 100)) : null,
    resetAt: parseResetTime(windowData.resetsAt),
    unlimited: false,
    status: remaining <= 0 ? "limit-reached" : "",
    window: windowId,
    source: "dashboard-session",
  };
}

function freeModelPlanLabel(billing) {
  const subscription = billing?.subscription;
  const plan = subscription?.planName || subscription?.name || subscription?.plan?.name || "";
  return plan ? `FreeModel ${plan}` : "FreeModel";
}

/**
 * Legacy Claude usage for API key / org admin users
 */
async function getClaudeUsageLegacy(accessToken, proxyOptions = null) {
  try {
    const settingsResponse = await proxyAwareFetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await proxyAwareFetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            quotas: usage,
          };
        }
      }

      return {
        plan: settings.plan || "Unknown",
        organization: settings.organization_name,
        message: "Claude connected. Usage details require admin access.",
      };
    }

    return { message: "Claude connected. Usage API requires admin permissions." };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

async function getCommandCodeUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Command Code API key not available.", quotas: {} };
  }

  try {
    const who = await fetchCommandCodeJson(apiKey, "/alpha/whoami", null, proxyOptions);
    if (!who.ok) {
      return { source: "provider-api", message: `Command Code whoami API error (${who.status}).`, quotas: {} };
    }

    const orgId = commandCodeOrgId(who.data);
    const params = orgId ? { orgId } : null;
    const subscriptionResponse = await fetchCommandCodeJson(apiKey, "/alpha/billing/subscriptions", params, proxyOptions);
    const creditsResponse = await fetchCommandCodeJson(apiKey, "/alpha/billing/credits", params, proxyOptions);
    const usageResponse = await fetchCommandCodeJson(apiKey, "/alpha/usage/summary", params, proxyOptions);

    if (!subscriptionResponse.ok && !creditsResponse.ok && !usageResponse.ok) {
      return {
        source: "provider-api",
        message: `Command Code billing APIs unavailable (${subscriptionResponse.status}/${creditsResponse.status}/${usageResponse.status}).`,
        quotas: {},
      };
    }

    const subscription = commandCodeSubscription(subscriptionResponse.data);
    const credits = commandCodeCredits(creditsResponse.data);
    const usage = commandCodeUsageSummary(usageResponse.data);
    const planId = subscription?.planId || usage?.planId || "";
    const planTotal = COMMAND_CODE_MONTHLY_CREDITS[planId];
    const used = toFiniteNumber(usage?.totalMonthlyCredits ?? usage?.totalCredits ?? usage?.totalCost, 0);
    const monthlyRemaining = toFiniteNumber(credits?.monthlyCredits, NaN);
    const inferredTotal = Number.isFinite(monthlyRemaining) ? used + monthlyRemaining : used;
    const total = Number.isFinite(planTotal) ? planTotal : inferredTotal;
    const remaining = Number.isFinite(monthlyRemaining) ? monthlyRemaining : Math.max(0, total - used);
    const purchasedCredits = toFiniteNumber(credits?.purchasedCredits, 0);
    const freeCredits = toFiniteNumber(credits?.freeCredits, 0);
    const balanceCredits = purchasedCredits + freeCredits;
    const resetAt = parseResetTime(subscription?.currentPeriodEnd || subscription?.current_period_end);
    const quotas = {
      monthly_credits: {
        used,
        total,
        remaining,
        remainingPercentage: total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0,
        resetAt,
        unlimited: false,
        status: subscription?.status || "",
      },
    };

    if (balanceCredits > 0) {
      quotas.credit_balance = {
        used: 0,
        total: balanceCredits,
        remaining: balanceCredits,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: false,
      };
    }

    return {
      plan: COMMAND_CODE_PLAN_LABELS[planId] || planId || "Command Code",
      source: "provider-api",
      account: commandCodeUser(who.data),
      billingPeriodStart: parseResetTime(subscription?.currentPeriodStart || subscription?.current_period_start),
      billingPeriodEnd: resetAt,
      totalTokens: toFiniteNumber(usage?.totalTokens, 0),
      quotas,
    };
  } catch (error) {
    return { source: "provider-api", message: `Command Code usage API error: ${error.message}`, quotas: {} };
  }
}

async function fetchCommandCodeJson(apiKey, pathname, params = null, proxyOptions = null, attempt = 0) {
  const url = new URL(pathname, COMMAND_CODE_CONFIG.apiBaseUrl);
  if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await proxyAwareFetch(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        "x-command-code-version": COMMAND_CODE_CONFIG.cliVersion,
        "x-cli-environment": "cli",
      },
    }, proxyOptions);
  } catch (error) {
    if (attempt < 2) {
      await delay(250 * (attempt + 1));
      return fetchCommandCodeJson(apiKey, pathname, params, proxyOptions, attempt + 1);
    }
    throw error;
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandCodeUser(payload) {
  const user = payload?.user && typeof payload.user === "object" ? payload.user : {};
  return {
    id: user.id || "",
    name: user.name || user.userName || "",
    email: user.email || "",
  };
}

function commandCodeOrgId(payload) {
  return payload?.org?.id || payload?.organization?.id || payload?.organizations?.[0]?.id || null;
}

function commandCodeSubscription(payload) {
  if (payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload?.data)) return payload.data[0] || null;
  if (Array.isArray(payload?.subscriptions)) return payload.subscriptions[0] || null;
  if (payload?.subscription && typeof payload.subscription === "object") return payload.subscription;
  return payload && typeof payload === "object" ? payload : null;
}

function commandCodeCredits(payload) {
  if (payload?.credits && typeof payload.credits === "object") return payload.credits;
  if (payload?.data?.credits && typeof payload.data.credits === "object") return payload.data.credits;
  return payload && typeof payload === "object" ? payload : {};
}

function commandCodeUsageSummary(payload) {
  if (payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) return payload.data;
  return payload && typeof payload === "object" ? payload : {};
}

/**
 * Codex (OpenAI) Usage - Fetch from ChatGPT backend API
 */
function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getCodexRateLimitBody(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot.rate_limit && typeof snapshot.rate_limit === "object"
    ? snapshot.rate_limit
    : snapshot;
}

function formatCodexWindow(window) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(window?.used_percent ?? window?.percent_used, 0)));
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt: parseResetTime(window?.reset_at ?? window?.resets_at ?? window?.resetAt ?? null),
    unlimited: false,
  };
}

function appendCodexQuotaWindows(quotas, prefix, snapshot) {
  const rateLimit = getCodexRateLimitBody(snapshot);
  if (!rateLimit) return false;

  const primary = rateLimit.primary_window || rateLimit.primary || snapshot.primary_window || snapshot.primary;
  const secondary = rateLimit.secondary_window || rateLimit.secondary || snapshot.secondary_window || snapshot.secondary;
  let added = false;

  if (primary) {
    quotas[prefix ? `${prefix}_session` : "session"] = formatCodexWindow(primary);
    added = true;
  }
  if (secondary) {
    quotas[prefix ? `${prefix}_weekly` : "weekly"] = formatCodexWindow(secondary);
    added = true;
  }

  return added;
}

function getCodexReviewRateLimit(data) {
  if (data.code_review_rate_limit || data.review_rate_limit) {
    return data.code_review_rate_limit || data.review_rate_limit;
  }

  const byLimitId = data.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    return byLimitId.code_review || byLimitId.codex_review || byLimitId.review || null;
  }

  const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
  return additional.find((entry) => {
    const id = String(entry?.limit_name || entry?.metered_feature || entry?.id || "").toLowerCase();
    return id === "code_review" || id === "codex_review" || id === "review" || id.includes("review");
  }) || null;
}

async function getCodexUsage(accessToken, proxyOptions = null) {
  try {
    const response = await proxyAwareFetch(CODEX_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let errorPayload = {};
      if (errorText) {
        try {
          errorPayload = JSON.parse(errorText);
        } catch {
          errorPayload = { raw: errorText };
        }
      }
      const code = errorPayload?.error?.code || "";
      const detail = errorPayload?.error?.message || "";
      const message = code === "token_invalidated"
        ? "Codex token was invalidated; re-authentication is required."
        : code === "token_expired"
          ? "Codex token is expired; refresh or re-authentication is required."
          : detail || `Codex usage API unavailable (${response.status}).`;
      return {
        status: response.status === 401 || response.status === 403 ? "requires-reauth" : "unavailable",
        source: "provider-api",
        message,
        quotas: {},
      };
    }

    const data = await response.json();
    const normalRateLimit = data.rate_limit || data.rate_limits || data.rate_limits_by_limit_id?.codex || {};
    const reviewRateLimit = getCodexReviewRateLimit(data);
    const quotas = {};

    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);

    return {
      plan: data.plan_type || data.summary?.plan || "unknown",
      limitReached: getCodexRateLimitBody(normalRateLimit)?.limit_reached || false,
      reviewLimitReached: getCodexRateLimitBody(reviewRateLimit)?.limit_reached || false,
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}

/**
 * Kiro (AWS CodeWhisperer) Usage
 */
function parseKiroQuotaData(data) {
  const usageList = data.usageBreakdownList || [];
  const quotaInfo = {};
  const resetAt = parseResetTime(data.nextDateReset || data.resetDate);

  usageList.forEach((breakdown) => {
    const resourceType = breakdown.resourceType?.toLowerCase() || "unknown";
    const used = breakdown.currentUsageWithPrecision || 0;
    const total = breakdown.usageLimitWithPrecision || 0;

    quotaInfo[resourceType] = {
      used,
      total,
      remaining: total - used,
      resetAt,
      unlimited: false,
    };

    // Add free trial if available
    if (breakdown.freeTrialInfo) {
      const freeUsed = breakdown.freeTrialInfo.currentUsageWithPrecision || 0;
      const freeTotal = breakdown.freeTrialInfo.usageLimitWithPrecision || 0;

      quotaInfo[`${resourceType}_freetrial`] = {
        used: freeUsed,
        total: freeTotal,
        remaining: freeTotal - freeUsed,
        resetAt: parseResetTime(breakdown.freeTrialInfo.freeTrialExpiry || resetAt),
        unlimited: false,
      };
    }
  });

  return {
    plan: data.subscriptionInfo?.subscriptionTitle || "Kiro",
    quotas: quotaInfo,
  };
}

async function getKiroUsage(accessToken, providerSpecificData, proxyOptions = null) {
  // Default profileArn fallback
  const DEFAULT_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
  const profileArn = providerSpecificData?.profileArn || DEFAULT_PROFILE_ARN;
  const authMethod = providerSpecificData?.authMethod || "builder-id";

  const getUsageParams = new URLSearchParams({
    isEmailRequired: "true",
    origin: "AI_EDITOR",
    resourceType: "AGENTIC_REQUEST",
  });

  // For compatibility, try multiple known Kiro usage endpoints
  const attempts = [
    {
      name: "codewhisperer-get",
      run: async () => proxyAwareFetch(
        `https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?${getUsageParams.toString()}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "x-amz-user-agent": "aws-sdk-js/1.0.0 KiroIDE",
            "user-agent": "aws-sdk-js/1.0.0 KiroIDE",
          },
        },
        proxyOptions
      ),
    },
    {
      name: "codewhisperer-post",
      run: async () => proxyAwareFetch("https://codewhisperer.us-east-1.amazonaws.com", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/x-amz-json-1.0",
          "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        }),
      }, proxyOptions),
    },
    {
      name: "q-get",
      run: async () => {
        const params = new URLSearchParams({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        });
        return proxyAwareFetch(`https://q.us-east-1.amazonaws.com/getUsageLimits?${params}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        }, proxyOptions);
      },
    },
  ];

  let sawAuthError = false;
  const errors = [];

  for (const attempt of attempts) {
    try {
      const response = await attempt.run();
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          sawAuthError = true;
        }
        errors.push(`${attempt.name}:${response.status}${errorText ? `:${errorText}` : ""}`);
        continue;
      }

      const data = await response.json();
      return parseKiroQuotaData(data);
    } catch (error) {
      errors.push(`${attempt.name}:${error.message}`);
    }
  }

  if (sawAuthError && authMethod === "idc") {
    return {
      message: "Kiro quota API is unavailable for the current AWS IAM Identity Center session. Chat may still work. If this persists after renewing your session, reconnect Kiro.",
      quotas: {},
    };
  }

  // Social auth (Google/GitHub) - these use a different token format that may not work with AWS CodeWhisperer quota APIs
  if (sawAuthError && (authMethod === "google" || authMethod === "github")) {
    return {
      message: "Kiro quota API authentication expired. Chat may still work.",
      quotas: {},
    };
  }

  if (sawAuthError) {
    return {
      message: "Kiro quota API rejected the current token. Chat may still work.",
      quotas: {},
    };
  }

  const fallbackMessage =
    errors.length > 0
      ? `Unable to fetch Kiro usage right now. (${errors[errors.length - 1]})`
      : "Unable to fetch Kiro usage right now.";

  return {
    message: fallbackMessage,
    quotas: {},
  };
}

/**
 * OpenCode Go usage.
 *
 * Upstream source of truth:
 * packages/console/app/src/routes/workspace/[id]/go/lite-section.tsx
 * queryLiteSubscription() returns rollingUsage, weeklyUsage, monthlyUsage,
 * each already computed through Subscription.analyze*Usage.
 */
async function getOpenCodeGoUsage(providerSpecificData = {}, proxyOptions = null) {
  const workspaceId = String(providerSpecificData?.workspaceId || "").trim();
  const authCookie = normalizeOpenCodeGoAuthCookie(providerSpecificData?.authCookie);

  if (!workspaceId || !authCookie) {
    const missing = !workspaceId && !authCookie
      ? "workspace id and opencode.ai auth cookie"
      : !workspaceId
        ? "workspace id"
        : "opencode.ai auth cookie";
    return {
      status: "unavailable",
      source: "dashboard-session",
      plan: "OpenCode Go",
      message: `OpenCode Go console session is not configured. Need ${missing} to read provider usage.`,
      quotas: {},
    };
  }

  const usageUrl = OPENCODE_GO_CONFIG.usageUrl.replace("{workspaceId}", encodeURIComponent(workspaceId));

  try {
    const response = await proxyAwareFetch(usageUrl, {
      method: "GET",
      headers: {
        Cookie: `${authCookie}; oc_locale=en`,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": getPlatformUserAgent(),
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return {
        status: "unavailable",
        source: "dashboard-session",
        plan: "OpenCode Go",
        message: "OpenCode Go console session expired or lacks access.",
        quotas: {},
      };
    }

    if (response.status === 404) {
      return {
        status: "unavailable",
        source: "dashboard-session",
        plan: "OpenCode Go",
        message: "OpenCode Go workspace was not found.",
        quotas: {},
      };
    }

    if (!response.ok) {
      return {
        status: "unavailable",
        source: "dashboard-session",
        plan: "OpenCode Go",
        message: `OpenCode Go console returned HTTP ${response.status}.`,
        quotas: {},
      };
    }

    const html = await response.text();
    const parsed = parseOpenCodeGoUsageHtml(html);
    if (!parsed.rolling && !parsed.weekly && !parsed.monthly) {
      return {
        status: "unavailable",
        source: "dashboard-session",
        plan: "OpenCode Go",
        message: "OpenCode Go console did not return usage windows for this session.",
        quotas: {},
      };
    }

    const quotas = {};
    if (parsed.rolling) {
      quotas["session (5h)"] = buildOpenCodeGoQuota(parsed.rolling, OPENCODE_GO_CONFIG.rollingLimitUsd, "5h");
    }
    if (parsed.weekly) {
      quotas["weekly (7d)"] = buildOpenCodeGoQuota(parsed.weekly, OPENCODE_GO_CONFIG.weeklyLimitUsd, "7d");
    }
    if (parsed.monthly) {
      quotas["monthly"] = buildOpenCodeGoQuota(parsed.monthly, OPENCODE_GO_CONFIG.monthlyLimitUsd, "monthly");
    }

    const monthlyResetAt = parsed.monthly?.resetAt || null;

    return {
      status: "ok",
      source: "dashboard-session",
      plan: "OpenCode Go",
      account: { workspaceId, mine: parsed.mine ?? null, useBalance: parsed.useBalance ?? null },
      billingPeriodEnd: monthlyResetAt,
      quotas,
    };
  } catch (error) {
    return {
      status: "error",
      source: "dashboard-session",
      plan: "OpenCode Go",
      message: `OpenCode Go usage fetch failed: ${error.message}`,
      quotas: {},
    };
  }
}

function normalizeOpenCodeGoAuthCookie(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const authMatch = raw.match(/(?:^|;\s*)auth=([^;]+)/);
  if (authMatch) return `auth=${authMatch[1]}`;
  return `auth=${raw}`;
}

function parseOpenCodeGoUsageHtml(html) {
  return {
    rolling: parseOpenCodeGoHydratedWindow(html, "rollingUsage") || parseOpenCodeGoTextWindow(html, "Rolling Usage"),
    weekly: parseOpenCodeGoHydratedWindow(html, "weeklyUsage") || parseOpenCodeGoTextWindow(html, "Weekly Usage"),
    monthly: parseOpenCodeGoHydratedWindow(html, "monthlyUsage") || parseOpenCodeGoTextWindow(html, "Monthly Usage"),
    mine: parseOpenCodeGoBoolean(html, "mine"),
    useBalance: parseOpenCodeGoBoolean(html, "useBalance"),
  };
}

function parseOpenCodeGoHydratedWindow(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}:\\$R\\[\\d+\\]=\\{([^}]{0,700})\\}`),
    new RegExp(`${escaped}=\\{([^}]{0,700})\\}`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;
    return parseOpenCodeGoWindowObject(match[1]);
  }

  return null;
}

function parseOpenCodeGoWindowObject(raw) {
  const usagePercent = readOpenCodeGoNumberField(raw, "usagePercent");
  if (!Number.isFinite(usagePercent)) return null;

  const resetInSec = readOpenCodeGoNumberField(raw, "resetInSec");
  const resetDate = readOpenCodeGoStringField(raw, "resetDate");
  const resetTimestamp = readOpenCodeGoNumberField(raw, "resetTimestamp");
  let resetAt = null;
  if (Number.isFinite(resetInSec)) {
    resetAt = new Date(Date.now() + Math.max(0, resetInSec) * 1000).toISOString();
  } else if (resetDate) {
    resetAt = parseResetTime(resetDate);
  } else if (Number.isFinite(resetTimestamp)) {
    resetAt = parseResetTime(resetTimestamp);
  }

  return {
    usagePercent: Math.max(0, Math.min(100, usagePercent)),
    resetInSec: Number.isFinite(resetInSec) ? Math.max(0, resetInSec) : null,
    resetAt,
    status: readOpenCodeGoStringField(raw, "status") || "",
  };
}

function readOpenCodeGoNumberField(raw, key) {
  const match = new RegExp(`${key}:([^,}]+)`).exec(raw);
  if (!match) return NaN;
  return Number(match[1].replace(/^"|"$/g, "").trim());
}

function readOpenCodeGoStringField(raw, key) {
  const match = new RegExp(`${key}:("([^"]*)"|[^,}]+)`).exec(raw);
  if (!match) return "";
  return String(match[2] ?? match[1]).replace(/^"|"$/g, "").trim();
}

function parseOpenCodeGoBoolean(html, key) {
  const match = new RegExp(`${key}:\\$R\\[\\d+\\]=(true|false)|${key}=(true|false)`).exec(html);
  if (!match) return null;
  return (match[1] || match[2]) === "true";
}

function parseOpenCodeGoTextWindow(html, label) {
  const text = htmlToPlainText(html);
  const start = text.indexOf(label);
  if (start < 0) return null;

  const labels = ["Rolling Usage", "Weekly Usage", "Monthly Usage", "Use your available balance"];
  let end = text.length;
  for (const nextLabel of labels) {
    if (nextLabel === label) continue;
    const index = text.indexOf(nextLabel, start + label.length);
    if (index >= 0 && index < end) end = index;
  }

  const section = text.slice(start, end);
  const percentMatch = section.match(/(\d{1,3})\s*%/);
  const resetMatch = section.match(/Resets in\s+(.+)$/i);
  if (!percentMatch || !resetMatch) return null;

  const resetInSec = parseOpenCodeGoDurationSeconds(resetMatch[1]);
  if (!Number.isFinite(resetInSec)) return null;

  return {
    usagePercent: Math.max(0, Math.min(100, Number(percentMatch[1]))),
    resetInSec,
    resetAt: new Date(Date.now() + resetInSec * 1000).toISOString(),
    status: "",
  };
}

function htmlToPlainText(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOpenCodeGoDurationSeconds(text) {
  let total = 0;
  let matched = false;
  const pattern = /(\d+)\s*(weeks?|days?|hours?|minutes?|seconds?|w|d|h|m|s)\b/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = String(match[2] || "").toLowerCase();
    if (!Number.isFinite(amount)) continue;
    matched = true;
    if (unit === "w" || unit.startsWith("week")) total += amount * 604800;
    else if (unit === "d" || unit.startsWith("day")) total += amount * 86400;
    else if (unit === "h" || unit.startsWith("hour")) total += amount * 3600;
    else if (unit === "m" || unit.startsWith("minute")) total += amount * 60;
    else if (unit === "s" || unit.startsWith("second")) total += amount;
  }
  return matched ? total : NaN;
}

function buildOpenCodeGoQuota(window, totalUsd, windowName) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(window.usagePercent, 0)));
  const total = Math.max(0, totalUsd);
  const usedUsd = total * (used / 100);
  const remaining = Math.max(0, total - usedUsd);
  return {
    used: usedUsd,
    total,
    remaining,
    remainingPercentage: Math.max(0, 100 - used),
    resetAt: window.resetAt || null,
    unlimited: false,
    status: window.status || "ok",
    window: windowName,
    source: "dashboard-session",
  };
}

/**
 * Qwen Usage
 */
async function getQwenUsage(accessToken, providerSpecificData) {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }

    // Qwen may have usage endpoint at resource URL
    return { message: "Qwen connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch Qwen usage." };
  }
}

/**
 * iFlow Usage
 */
async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

/**
 * Ollama Cloud Usage
 * Ollama Cloud uses an API key from ollama.com/settings/keys
 * and has no public usage API — free tier has light usage limits (resets every 5h & 7d).
 * This returns an informational message with the plan details.
 */
async function getOllamaUsage(accessToken, providerSpecificData) {
  try {
    // Ollama Cloud does not expose a public quota/usage API.
    // The provider is configured as noAuth with a notice explaining limits.
    // We return a graceful message so the UI shows a friendly state instead of an error.
    const plan = providerSpecificData?.plan || "Free";
    return {
      plan,
      message: "Ollama Cloud uses a free tier with light usage limits (resets every 5h & 7d). For detailed usage tracking, visit ollama.com/settings/keys.",
      quotas: [],
    };
  } catch (error) {
    return { message: "Unable to fetch Ollama Cloud usage." };
  }
}

/**
 * GLM Coding Plan usage (international + China regions)
 */
async function getGlmUsage(apiKey, provider, proxyOptions = null) {
  if (!apiKey) {
    return { message: "GLM API key not available." };
  }

  const region = provider === "glm-cn" ? "china" : "international";
  const quotaUrl = GLM_QUOTA_URLS[region];

  try {
    const response = await proxyAwareFetch(quotaUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "GLM API key invalid or expired." };
      }
      return { message: `GLM quota API error (${response.status}).` };
    }

    const json = await response.json();
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    const limits = Array.isArray(data.limits) ? data.limits : [];
    const quotas = {};

    for (const limit of limits) {
      if (!limit || limit.type !== "TOKENS_LIMIT") continue;
      const usedPercent = Number(limit.percentage) || 0;
      const resetMs = Number(limit.nextResetTime) || 0;
      const remaining = Math.max(0, 100 - usedPercent);

      quotas["session"] = {
        used: usedPercent,
        total: 100,
        remaining,
        remainingPercentage: remaining,
        resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null,
        unlimited: false,
      };
    }

    const levelRaw = typeof data.level === "string" ? data.level : "";
    const plan = levelRaw
      ? levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1).toLowerCase()
      : "Unknown";

    return { plan, quotas };
  } catch (error) {
    return { message: `GLM error: ${error.message}` };
  }
}

// ── MiniMax helpers ──────────────────────────────────────────────────────
function isMiniMaxTextQuotaModel(modelName) {
  const normalized = (modelName || "").trim().toLowerCase();
  return normalized.startsWith("minimax-m") || normalized.startsWith("coding-plan");
}

function getMiniMaxField(model, snakeKey, camelKey) {
  if (!model || typeof model !== "object") return null;
  return model[snakeKey] ?? model[camelKey] ?? null;
}

function getMiniMaxSessionTotal(model) {
  return Math.max(0, Number(getMiniMaxField(model, "current_interval_total_count", "currentIntervalTotalCount")) || 0);
}

function getMiniMaxWeeklyTotal(model) {
  return Math.max(0, Number(getMiniMaxField(model, "current_weekly_total_count", "currentWeeklyTotalCount")) || 0);
}

function pickMiniMaxRepresentativeModel(models, getTotal) {
  const withQuota = models.filter((m) => getTotal(m) > 0);
  const pool = withQuota.length > 0 ? withQuota : models;
  if (pool.length === 0) return null;
  return pool.reduce((best, current) => (getTotal(current) > getTotal(best) ? current : best));
}

function getMiniMaxResetAt(model, capturedAtMs, remainsSnake, remainsCamel, endSnake, endCamel) {
  const remainsMs = Number(getMiniMaxField(model, remainsSnake, remainsCamel)) || 0;
  if (remainsMs > 0) return new Date(capturedAtMs + remainsMs).toISOString();
  return parseResetTime(getMiniMaxField(model, endSnake, endCamel));
}

function buildMiniMaxQuota(total, count, resetAt, countMeansRemaining) {
  const safeTotal = Math.max(0, total);
  const used = countMeansRemaining ? Math.max(safeTotal - count, 0) : Math.min(Math.max(0, count), safeTotal);
  const remaining = Math.max(safeTotal - used, 0);
  return {
    used,
    total: safeTotal,
    remaining,
    remainingPercentage: safeTotal > 0 ? Math.max(0, Math.min(100, (remaining / safeTotal) * 100)) : 0,
    resetAt,
    unlimited: false,
  };
}

/**
 * MiniMax Token Plan / Coding Plan usage
 */
async function getMiniMaxUsage(apiKey, provider, proxyOptions = null) {
  if (!apiKey) {
    return { message: "MiniMax API key not available." };
  }

  const usageUrls = MINIMAX_USAGE_URLS[provider] || [];
  let lastErrorMessage = "";

  for (let index = 0; index < usageUrls.length; index += 1) {
    const usageUrl = usageUrls[index];
    const canFallback = index < usageUrls.length - 1;

    try {
      const response = await proxyAwareFetch(usageUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }, proxyOptions);

      const rawText = await response.text();
      let payload = {};
      if (rawText) {
        try { payload = JSON.parse(rawText); } catch { payload = {}; }
      }

      const baseResp = (payload?.base_resp ?? payload?.baseResp) || {};
      const apiStatusCode = Number(baseResp.status_code ?? baseResp.statusCode) || 0;
      const apiStatusMessage = String(baseResp.status_msg ?? baseResp.statusMsg ?? "").trim();
      const combined = `${apiStatusMessage} ${rawText}`.trim();
      const authLike = /token plan|coding plan|invalid api key|invalid key|unauthorized|inactive/i;

      if (response.status === 401 || response.status === 403 || apiStatusCode === 1004 || authLike.test(combined)) {
        return { message: "MiniMax API key invalid or inactive. Use an active Token/Coding Plan key." };
      }

      if (!response.ok) {
        lastErrorMessage = `MiniMax usage endpoint error (${response.status})`;
        if ((response.status === 404 || response.status === 405 || response.status >= 500) && canFallback) continue;
        return { message: `MiniMax connected. ${lastErrorMessage}` };
      }

      if (apiStatusCode !== 0) {
        return { message: `MiniMax connected. ${apiStatusMessage || "Upstream quota API error"}` };
      }

      const modelRemains = payload?.model_remains ?? payload?.modelRemains;
      const allModels = Array.isArray(modelRemains) ? modelRemains : [];
      const textModels = allModels.filter((m) => isMiniMaxTextQuotaModel(String(getMiniMaxField(m, "model_name", "modelName"))));

      if (textModels.length === 0) {
        return { message: "MiniMax connected. No text quota data was returned." };
      }

      const capturedAtMs = Date.now();
      const countMeansRemaining = usageUrl.includes("/coding_plan/remains");
      const quotas = {};

      const sessionModel = pickMiniMaxRepresentativeModel(textModels, getMiniMaxSessionTotal);
      if (sessionModel) {
        const total = getMiniMaxSessionTotal(sessionModel);
        const count = Math.max(0, Number(getMiniMaxField(sessionModel, "current_interval_usage_count", "currentIntervalUsageCount")) || 0);
        quotas["session (5h)"] = buildMiniMaxQuota(
          total, count,
          getMiniMaxResetAt(sessionModel, capturedAtMs, "remains_time", "remainsTime", "end_time", "endTime"),
          countMeansRemaining
        );
      }

      const weeklyModel = pickMiniMaxRepresentativeModel(textModels, getMiniMaxWeeklyTotal);
      if (weeklyModel && getMiniMaxWeeklyTotal(weeklyModel) > 0) {
        const total = getMiniMaxWeeklyTotal(weeklyModel);
        const count = Math.max(0, Number(getMiniMaxField(weeklyModel, "current_weekly_usage_count", "currentWeeklyUsageCount")) || 0);
        quotas["weekly (7d)"] = buildMiniMaxQuota(
          total, count,
          getMiniMaxResetAt(weeklyModel, capturedAtMs, "weekly_remains_time", "weeklyRemainsTime", "weekly_end_time", "weeklyEndTime"),
          countMeansRemaining
        );
      }

      if (Object.keys(quotas).length === 0) {
        return { message: "MiniMax connected. Unable to extract quota usage." };
      }

      return { quotas };
    } catch (error) {
      lastErrorMessage = error.message;
      if (!canFallback) break;
    }
  }

  return { message: lastErrorMessage ? `MiniMax connected. Unable to fetch usage: ${lastErrorMessage}` : "MiniMax connected. Unable to fetch usage." };
}
