import { Logger } from "@nestjs/common";
import type {
  CallStatusResult,
  LlmProvider,
  LlmRequest,
  LlmResult,
  PlaceCallRequest,
  PlaceCallResult,
  ProviderHealth,
  SpeechToTextProvider,
  SynthesizeRequest,
  SynthesizeResult,
  TelephonyCallState,
  TelephonyProvider,
  TextToSpeechProvider,
  TranscribeRequest,
  TranscribeResult,
} from "../provider.types";

/**
 * Sandbox implementations of every provider contract.
 *
 * These exist so the calling pipeline can be built, run and tested end-to-end before a
 * single vendor account is opened — and so the demo works without asking anyone to put
 * a credit card down.
 *
 * The one rule they follow, and the reason they are safe: **a sandbox provider never
 * claims to have done the real thing.** No number is dialled, no audio is produced, and
 * every result is stamped `sandbox` so a call record cannot be mistaken for a real one.
 * `SANDBOX_PROVIDER_NAMES` is exported for exactly that check, and the Call row keeps the
 * provider name, so "did we actually ring this person" is answerable from the database.
 */

export const SANDBOX_PROVIDER_NAMES = ["sandbox"] as const;

export function isSandboxProvider(name: string | null | undefined): boolean {
  return (SANDBOX_PROVIDER_NAMES as readonly string[]).includes(name ?? "");
}

/**
 * Deterministic outcomes, chosen by hashing the correlation id.
 *
 * Random outcomes would make the demo different on every run and every test flaky. This
 * gives a stable, varied distribution — the same lead always produces the same result,
 * so a screenshot is reproducible and an assertion is possible.
 */
function outcomeFor(correlationId: string): {
  state: TelephonyCallState;
  durationSeconds: number;
} {
  let hash = 0;
  for (let i = 0; i < correlationId.length; i += 1) {
    hash = (hash * 31 + correlationId.charCodeAt(i)) >>> 0;
  }
  const bucket = hash % 100;

  // Roughly the shape of a real outbound list: about half connect, a third go unanswered,
  // and the rest are busy or voicemail.
  if (bucket < 48) return { state: "COMPLETED", durationSeconds: 40 + (hash % 200) };
  if (bucket < 76) return { state: "NO_ANSWER", durationSeconds: 0 };
  if (bucket < 88) return { state: "VOICEMAIL", durationSeconds: 12 + (hash % 20) };
  if (bucket < 96) return { state: "BUSY", durationSeconds: 0 };
  return { state: "FAILED", durationSeconds: 0 };
}

const now = () => new Date().toISOString();

export class SandboxTelephonyProvider implements TelephonyProvider {
  readonly name = "sandbox";
  readonly kind = "TELEPHONY" as const;
  private readonly logger = new Logger(SandboxTelephonyProvider.name);
  private readonly calls = new Map<string, { correlationId: string; startedAt: number }>();

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: this.kind,
      configured: true,
      reachable: true,
      detail: "Sandbox — no calls are placed and no numbers are dialled.",
      checkedAt: now(),
    };
  }

  async placeCall(request: PlaceCallRequest): Promise<PlaceCallResult> {
    // Logged at warn so a sandbox call in a production log is conspicuous rather than
    // buried — if this ever appears in a real environment, someone should notice.
    this.logger.warn(
      `SANDBOX: pretending to call ${request.to} (correlation ${request.correlationId}). ` +
        `No real call was placed.`,
    );

    const providerCallId = `sandbox-${request.correlationId}`;
    this.calls.set(providerCallId, {
      correlationId: request.correlationId,
      startedAt: Date.now(),
    });

    return { ok: true, providerCallId, state: "DIALING" };
  }

  async getStatus(providerCallId: string): Promise<CallStatusResult> {
    const call = this.calls.get(providerCallId);
    if (!call) {
      return { state: "FAILED", durationSeconds: 0 };
    }

    const { state, durationSeconds } = outcomeFor(call.correlationId);

    // A brief dialing window, so a client polling for status sees the transition rather
    // than a call that was somehow already over.
    const elapsed = Date.now() - call.startedAt;
    if (elapsed < 1500) return { state: "RINGING", durationSeconds: 0 };

    return {
      state,
      durationSeconds,
      recordingUrl:
        state === "COMPLETED" ? `sandbox://recordings/${providerCallId}.mp3` : undefined,
      answeredAt: state === "COMPLETED" ? new Date(call.startedAt + 6000).toISOString() : undefined,
      endedAt: new Date(call.startedAt + durationSeconds * 1000).toISOString(),
    };
  }

  async hangUp(providerCallId: string): Promise<void> {
    this.calls.delete(providerCallId);
  }
}

export class SandboxLlmProvider implements LlmProvider {
  readonly name = "sandbox";
  readonly kind = "LLM" as const;

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: this.kind,
      configured: true,
      reachable: true,
      detail: "Sandbox — responses are canned, not generated.",
      checkedAt: now(),
    };
  }

  /**
   * Returns a fixed, clearly-labelled response.
   *
   * Deliberately not a plausible-looking fake summary: an analysis that reads like real
   * AI output is one someone will eventually quote to a customer. Saying so in the text
   * is the honest option, and it still exercises every code path that consumes a result.
   */
  async complete(request: LlmRequest): Promise<LlmResult> {
    const last = request.messages[request.messages.length - 1]?.content ?? "";

    if (request.json) {
      return {
        ok: true,
        text: JSON.stringify({
          sandbox: true,
          note: "Sandbox AI provider — configure a real LLM in Settings → AI to get analysis.",
          promptChars: last.length,
        }),
        inputTokens: Math.ceil(last.length / 4),
        outputTokens: 24,
      };
    }

    return {
      ok: true,
      text:
        "[Sandbox AI] No language model is configured for this workspace, so this text " +
        "is a placeholder rather than an analysis. Connect a provider in Settings → AI.",
      inputTokens: Math.ceil(last.length / 4),
      outputTokens: 32,
    };
  }
}

export class SandboxSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "sandbox";
  readonly kind = "SPEECH_TO_TEXT" as const;

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: this.kind,
      configured: true,
      reachable: true,
      detail: "Sandbox — transcripts are placeholders, not transcription.",
      checkedAt: now(),
    };
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    return {
      ok: true,
      language: request.language ?? "en",
      confidence: 0,
      turns: [
        {
          speaker: "AI_AGENT",
          text:
            "[Sandbox] No speech-to-text provider is configured, so this call was not " +
            "transcribed. Connect one in Settings → AI.",
          startMs: 0,
          endMs: 4000,
          // Zero confidence on purpose: anything that ranks or filters by confidence
          // should treat a sandbox transcript as worthless, because it is.
          confidence: 0,
        },
      ],
    };
  }
}

export class SandboxTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "sandbox";
  readonly kind = "TEXT_TO_SPEECH" as const;

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      kind: this.kind,
      configured: true,
      reachable: true,
      detail: "Sandbox — no audio is produced.",
      checkedAt: now(),
    };
  }

  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
    return {
      ok: true,
      audioUrl: undefined,
      durationSeconds: Math.max(1, Math.round(request.text.length / 14)),
      error: undefined,
    };
  }
}
