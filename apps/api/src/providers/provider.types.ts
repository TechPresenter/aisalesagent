/**
 * The contracts every external provider is reached through.
 *
 * Nothing in the calling pipeline imports Twilio, OpenAI or ElevenLabs. It imports these
 * interfaces, and a registry hands it whichever implementation the workspace configured.
 * That is what makes "swap the telephony vendor" a settings change rather than a
 * refactor, and it is why the pipeline can be built and tested before anyone has bought
 * a phone number.
 *
 * Every method returns a result rather than throwing for expected outcomes. A busy line
 * and an unreachable API are both ordinary events in telephony; making the caller
 * distinguish them from programming errors via try/catch loses that distinction.
 */

export type ProviderKind = "LLM" | "SPEECH_TO_TEXT" | "TEXT_TO_SPEECH" | "TELEPHONY";

/** Whether a provider is usable right now, and why not if it is not. */
export interface ProviderHealth {
  provider: string;
  kind: ProviderKind;
  configured: boolean;
  reachable: boolean;
  /** Present when `reachable` is false. Safe to show a user — never contains secrets. */
  detail?: string;
  checkedAt: string;
}

export interface ProviderCredentials {
  apiKey?: string;
  accountSid?: string;
  authToken?: string;
  region?: string;
  [key: string]: string | undefined;
}

// ── telephony ───────────────────────────────────────────────────────────────────────

export type TelephonyCallState =
  | "QUEUED"
  | "DIALING"
  | "RINGING"
  | "CONNECTED"
  | "COMPLETED"
  | "FAILED"
  | "BUSY"
  | "NO_ANSWER"
  | "VOICEMAIL"
  | "CANCELLED";

export interface PlaceCallRequest {
  /** E.164. Validated before it reaches a provider. */
  to: string;
  from: string;
  /** Where the provider should post status changes. */
  webhookUrl?: string;
  /** Our call id, echoed back on webhooks so events can be matched to a row. */
  correlationId: string;
  maxSeconds?: number;
  recordingEnabled: boolean;
}

export interface PlaceCallResult {
  ok: boolean;
  /** The provider's own id, needed to fetch media and reconcile webhooks. */
  providerCallId?: string;
  state: TelephonyCallState;
  /** Set when `ok` is false. A reason, not a stack trace. */
  error?: string;
}

export interface CallStatusResult {
  state: TelephonyCallState;
  durationSeconds: number;
  /** Absent until the provider has finished writing the recording. */
  recordingUrl?: string;
  answeredAt?: string;
  endedAt?: string;
}

export interface TelephonyProvider {
  readonly name: string;
  readonly kind: "TELEPHONY";
  /**
   * True when this adapter can actually place a call. A sandbox adapter returns true
   * without credentials; a real one returns false until it has them, which is what lets
   * the UI say "Not connected" honestly rather than failing at dial time.
   */
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  placeCall(request: PlaceCallRequest): Promise<PlaceCallResult>;
  getStatus(providerCallId: string): Promise<CallStatusResult>;
  hangUp(providerCallId: string): Promise<void>;
}

// ── language models ─────────────────────────────────────────────────────────────────

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for JSON. Adapters that cannot enforce it must say so in health. */
  json?: boolean;
}

export interface LlmResult {
  ok: boolean;
  text: string;
  /** Token counts, when the provider reports them — used for cost attribution. */
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly kind: "LLM";
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  complete(request: LlmRequest): Promise<LlmResult>;
}

// ── speech ──────────────────────────────────────────────────────────────────────────

export interface TranscriptTurn {
  speaker: "AI_AGENT" | "LEAD";
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TranscribeRequest {
  /** Where the audio lives. Adapters fetch it themselves; we never buffer it here. */
  audioUrl: string;
  language?: string;
  /** Ask for per-speaker attribution. Not every provider supports it. */
  diarize?: boolean;
}

export interface TranscribeResult {
  ok: boolean;
  turns: TranscriptTurn[];
  language?: string;
  confidence?: number;
  error?: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  readonly kind: "SPEECH_TO_TEXT";
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
}

export interface SynthesizeRequest {
  text: string;
  voiceId?: string;
  language?: string;
}

export interface SynthesizeResult {
  ok: boolean;
  /** A URL rather than bytes: audio belongs in object storage, not in a JSON response. */
  audioUrl?: string;
  durationSeconds?: number;
  error?: string;
}

export interface TextToSpeechProvider {
  readonly name: string;
  readonly kind: "TEXT_TO_SPEECH";
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>;
}

export type AnyProvider =
  | TelephonyProvider
  | LlmProvider
  | SpeechToTextProvider
  | TextToSpeechProvider;
