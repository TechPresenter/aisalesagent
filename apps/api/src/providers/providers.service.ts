import { Injectable, Logger } from "@nestjs/common";
import type { AiProviderKind } from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { decryptCredentials, encryptionAvailable } from "./crypto.util";
import {
  SandboxLlmProvider,
  SandboxSpeechToTextProvider,
  SandboxTelephonyProvider,
  SandboxTextToSpeechProvider,
  isSandboxProvider,
} from "./sandbox/sandbox.adapters";
import type {
  LlmProvider,
  ProviderCredentials,
  ProviderHealth,
  SpeechToTextProvider,
  TelephonyProvider,
  TextToSpeechProvider,
} from "./provider.types";

/**
 * Resolves which provider implementation a workspace should use, for each kind.
 *
 * The rule: **a workspace gets the provider it configured, or the sandbox.** There is no
 * third option and no silent failure. If a tenant has configured OpenAI but the adapter
 * is not built yet, this returns the sandbox and says so in health — it does not return
 * a half-working object that throws at the moment of use, deep inside a call.
 *
 * Credentials are decrypted here and passed to an adapter constructor. They do not leave
 * this file in any other direction: nothing returns them, and the controller exposes only
 * `configured: true|false`.
 */
@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  private readonly sandboxTelephony = new SandboxTelephonyProvider();
  private readonly sandboxLlm = new SandboxLlmProvider();
  private readonly sandboxStt = new SandboxSpeechToTextProvider();
  private readonly sandboxTts = new SandboxTextToSpeechProvider();

  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async telephony(): Promise<TelephonyProvider> {
    const config = await this.primaryConfig("TELEPHONY");
    if (!config) return this.sandboxTelephony;

    // Real adapters land per vendor. Until one exists for the configured provider, the
    // sandbox is returned *and named in the log* — a workspace that thinks it configured
    // Twilio should be able to find out from health why nothing is being dialled, rather
    // than watching calls silently not happen.
    this.logger.warn(
      `No adapter is implemented for telephony provider "${config.provider}" yet; ` +
        `using the sandbox. Calls will not be placed.`,
    );
    return this.sandboxTelephony;
  }

  async llm(): Promise<LlmProvider> {
    const config = await this.primaryConfig("LLM");
    if (!config) return this.sandboxLlm;
    this.logger.warn(
      `No adapter is implemented for LLM provider "${config.provider}" yet; using the sandbox.`,
    );
    return this.sandboxLlm;
  }

  async speechToText(): Promise<SpeechToTextProvider> {
    const config = await this.primaryConfig("SPEECH_TO_TEXT");
    if (!config) return this.sandboxStt;
    this.logger.warn(
      `No adapter is implemented for STT provider "${config.provider}" yet; using the sandbox.`,
    );
    return this.sandboxStt;
  }

  async textToSpeech(): Promise<TextToSpeechProvider> {
    const config = await this.primaryConfig("TEXT_TO_SPEECH");
    if (!config) return this.sandboxTts;
    this.logger.warn(
      `No adapter is implemented for TTS provider "${config.provider}" yet; using the sandbox.`,
    );
    return this.sandboxTts;
  }

  /**
   * Health for every kind, for Settings → AI and the admin dashboard.
   *
   * `usingSandbox` is the field that matters. A workspace must be able to see at a glance
   * that its calls are not real, and the answer must come from what the code will
   * actually do — not from whether a settings row exists.
   */
  async healthAll(): Promise<
    (ProviderHealth & { usingSandbox: boolean; configuredProvider: string | null })[]
  > {
    const kinds: AiProviderKind[] = ["LLM", "SPEECH_TO_TEXT", "TEXT_TO_SPEECH", "TELEPHONY"];
    const results = [];

    for (const kind of kinds) {
      const config = await this.primaryConfig(kind);
      const resolved = await this.resolve(kind);
      const health = await resolved.health();

      results.push({
        ...health,
        configuredProvider: config?.provider ?? null,
        usingSandbox: isSandboxProvider(resolved.name),
      });
    }

    return results;
  }

  /** True when credentials can be stored at all — surfaced in setup before a write fails. */
  encryptionReady(): boolean {
    return encryptionAvailable();
  }

  private async resolve(kind: AiProviderKind) {
    switch (kind) {
      case "TELEPHONY":
        return this.telephony();
      case "LLM":
        return this.llm();
      case "SPEECH_TO_TEXT":
        return this.speechToText();
      case "TEXT_TO_SPEECH":
        return this.textToSpeech();
    }
  }

  private async primaryConfig(kind: AiProviderKind) {
    return this.db.aiProviderConfig.findFirst({
      where: { kind, isActive: true, isPrimary: true },
    });
  }

  /**
   * Decrypts a stored credential set for use by an adapter.
   *
   * Private, and returns rather than logs. A failure here means the ciphertext does not
   * match the current master key — usually a rotated key — and is reported as "not
   * configured" rather than crashing the pipeline, because a workspace with an
   * undecryptable key is in exactly the same practical position as one with no key.
   */
  private credentialsFor(stored: string | null): ProviderCredentials | null {
    if (!stored) return null;
    try {
      return JSON.parse(decryptCredentials(stored)) as ProviderCredentials;
    } catch {
      this.logger.error(
        "Stored provider credentials could not be decrypted — has CREDENTIALS_ENCRYPTION_KEY changed?",
      );
      return null;
    }
  }
}
