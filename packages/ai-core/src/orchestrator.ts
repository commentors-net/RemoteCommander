/**
 * Tool Loop Orchestrator
 * Implements the core AI-to-tool vertical loop with policy execution,
 * untrusted data boundaries, cancellation, and safety limits.
 * Authoritative baseline defined in Master Specification §0.11, §0.13, §7 (M4), §19.
 */

import { ToolDefinition } from '@remote-commander/tool-schema';
import { PrivacySettings } from '@remote-commander/shared-types';
import { ChatMessage, ToolCallRequest, wrapUntrustedContent } from './messages.js';
import { AIProvider } from './provider.js';
import { sanitizeToolOutputForAI } from './privacy.js';

export interface FallbackEvent {
  fromProvider: string;
  toProvider: string;
  reason: string;
  iteration: number;
  timestamp: string;
}

export interface LoopLimits {
  maxIterations: number;
  maxExecutionDurationMs: number;
  maxOutputCharsPerTool: number;
  privacySettings?: Partial<PrivacySettings> | undefined;
  fallbackProviders?: AIProvider[] | undefined;
}

export const DEFAULT_LOOP_LIMITS: LoopLimits = {
  maxIterations: 10,
  maxExecutionDurationMs: 300_000, // 5 minutes max total
  maxOutputCharsPerTool: 50_000,
};

export interface OrchestrationStep {
  iteration: number;
  type:
    | 'AI_THINKING'
    | 'TOOL_REQUESTED'
    | 'POLICY_EVALUATED'
    | 'TOOL_EXECUTED'
    | 'FINAL_ANSWER'
    | 'PROVIDER_FALLBACK';
  details: Record<string, unknown>;
  timestamp: string;
}

export interface ToolExecutionResponse {
  success: boolean;
  output: string;
  requiresApproval?: boolean | undefined;
  approvalRequest?: unknown | undefined;
  error?: string | undefined;
}

export type ToolExecutorCallback = (toolCall: ToolCallRequest) => Promise<ToolExecutionResponse>;

export interface OrchestrationCallbacks {
  onToken?: (delta: string) => void;
  onToolRequested?: (toolCall: ToolCallRequest) => void;
  onToolExecuted?: (toolCall: ToolCallRequest, output: string) => void;
  onApprovalRequired?: (approval: unknown) => void;
  onStep?: (step: OrchestrationStep) => void;
  onFallbackTriggered?: (fallback: FallbackEvent) => void;
}

export interface OrchestrationResult {
  finalText: string;
  messages: ChatMessage[];
  steps: OrchestrationStep[];
  iterations: number;
  cancelled: boolean;
  requiresApproval?: unknown | undefined;
  activeProviderId?: string | undefined;
}

export class ToolLoopOrchestrator {
  private provider: AIProvider;
  private tools: ToolDefinition[];
  private limits: LoopLimits;
  private fallbackProviders: AIProvider[];

  constructor(
    provider: AIProvider,
    tools: ToolDefinition[],
    limits: Partial<LoopLimits> = {},
    fallbackProviders: AIProvider[] = [],
  ) {
    this.provider = provider;
    this.tools = tools;
    this.limits = { ...DEFAULT_LOOP_LIMITS, ...limits };
    this.fallbackProviders =
      fallbackProviders.length > 0 ? fallbackProviders : (this.limits.fallbackProviders ?? []);
  }

  public getProviderChain(): AIProvider[] {
    return [this.provider, ...this.fallbackProviders];
  }

  async run(
    initialMessages: ChatMessage[],
    model: string,
    executeTool: ToolExecutorCallback,
    callbacks: OrchestrationCallbacks = {},
    signal?: AbortSignal,
  ): Promise<OrchestrationResult> {
    const workingMessages: ChatMessage[] = [...initialMessages];
    const steps: OrchestrationStep[] = [];
    const startTime = Date.now();
    let iteration = 0;
    let finalText = '';
    const providerChain = [this.provider, ...this.fallbackProviders];
    let activeProviderIndex = 0;

    while (iteration < this.limits.maxIterations) {
      iteration++;

      // Check timeout
      if (Date.now() - startTime > this.limits.maxExecutionDurationMs) {
        throw new Error(
          `Execution exceeded maximum duration of ${this.limits.maxExecutionDurationMs}ms`,
        );
      }

      // Check cancellation signal (Security Gate F)
      if (signal?.aborted) {
        return {
          finalText,
          messages: workingMessages,
          steps,
          iterations: iteration,
          cancelled: true,
          activeProviderId: providerChain[activeProviderIndex]?.providerId,
        };
      }

      // Stream chat chunk from active provider with fallback chain
      const toolCallMap = new Map<
        string,
        { id: string; toolName?: string | undefined; argsDelta: string }
      >();
      let textChunkBuffer = '';
      let streamSuccess = false;

      while (activeProviderIndex < providerChain.length && !streamSuccess) {
        const currentProvider = providerChain[activeProviderIndex]!;
        textChunkBuffer = '';
        toolCallMap.clear();

        const stepThinking: OrchestrationStep = {
          iteration,
          type: 'AI_THINKING',
          details: {
            model,
            provider: currentProvider.providerId,
            messageCount: workingMessages.length,
          },
          timestamp: new Date().toISOString(),
        };
        steps.push(stepThinking);
        callbacks.onStep?.(stepThinking);

        try {
          for await (const chunk of currentProvider.streamChat(
            { model, messages: workingMessages, tools: this.tools },
            signal,
          )) {
            if (signal?.aborted) {
              return {
                finalText: textChunkBuffer,
                messages: workingMessages,
                steps,
                iterations: iteration,
                cancelled: true,
                activeProviderId: currentProvider.providerId,
              };
            }

            if (chunk.type === 'TEXT_DELTA') {
              textChunkBuffer += chunk.delta;
              callbacks.onToken?.(chunk.delta);
            } else if (chunk.type === 'TOOL_CALL_DELTA') {
              const entry: {
                id: string;
                toolName?: string | undefined;
                argsDelta: string;
              } = toolCallMap.get(chunk.callId) ?? {
                id: chunk.callId,
                toolName: chunk.toolName,
                argsDelta: '',
              };
              if (chunk.toolName) {
                entry.toolName = chunk.toolName;
              }
              entry.argsDelta += chunk.argsDelta;
              toolCallMap.set(chunk.callId, entry);
            }
          }
          streamSuccess = true;
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const nextIndex = activeProviderIndex + 1;
          if (nextIndex < providerChain.length) {
            const nextProvider = providerChain[nextIndex]!;
            const fallbackEvent: FallbackEvent = {
              fromProvider: currentProvider.providerId,
              toProvider: nextProvider.providerId,
              reason: errMsg,
              iteration,
              timestamp: new Date().toISOString(),
            };
            const stepFallback: OrchestrationStep = {
              iteration,
              type: 'PROVIDER_FALLBACK',
              details: { ...fallbackEvent },
              timestamp: fallbackEvent.timestamp,
            };
            steps.push(stepFallback);
            callbacks.onStep?.(stepFallback);
            callbacks.onFallbackTriggered?.(fallbackEvent);

            activeProviderIndex = nextIndex;
          } else {
            throw new Error(
              `AI provider '${currentProvider.providerId}' failed and no fallback providers remain: ${errMsg}`,
            );
          }
        }
      }

      // Check if model requested tools
      const requestedCalls: ToolCallRequest[] = Array.from(toolCallMap.values()).map((val) => ({
        id: val.id,
        toolName: val.toolName ?? 'unknown_tool',
        argumentsJson: val.argsDelta.trim() || '{}',
      }));

      if (requestedCalls.length === 0) {
        // No tool calls requested -> model reached final answer
        finalText = textChunkBuffer;
        workingMessages.push({
          role: 'assistant',
          content: finalText,
        });

        const stepFinal: OrchestrationStep = {
          iteration,
          type: 'FINAL_ANSWER',
          details: { textLength: finalText.length },
          timestamp: new Date().toISOString(),
        };
        steps.push(stepFinal);
        callbacks.onStep?.(stepFinal);

        return {
          finalText,
          messages: workingMessages,
          steps,
          iterations: iteration,
          cancelled: false,
          activeProviderId: providerChain[activeProviderIndex]?.providerId,
        };
      }

      // Record assistant message with requested tool calls
      workingMessages.push({
        role: 'assistant',
        content: textChunkBuffer,
        toolCalls: requestedCalls,
      });

      // Execute each tool request through the local policy/executor callback
      for (const call of requestedCalls) {
        const stepRequested: OrchestrationStep = {
          iteration,
          type: 'TOOL_REQUESTED',
          details: { toolName: call.toolName, callId: call.id },
          timestamp: new Date().toISOString(),
        };
        steps.push(stepRequested);
        callbacks.onStep?.(stepRequested);
        callbacks.onToolRequested?.(call);

        const execRes = await executeTool(call);

        if (execRes.requiresApproval) {
          callbacks.onApprovalRequired?.(execRes.approvalRequest);
          return {
            finalText: textChunkBuffer,
            messages: workingMessages,
            steps,
            iterations: iteration,
            cancelled: false,
            requiresApproval: execRes.approvalRequest,
            activeProviderId: providerChain[activeProviderIndex]?.providerId,
          };
        }

        // Sanitize output (M14: secret redaction, restricted-data mode, token-aware truncation)
        const sanitized = sanitizeToolOutputForAI(execRes.output, {
          toolName: call.toolName,
          privacySettings: {
            maxCharsPerToolOutput: this.limits.maxOutputCharsPerTool,
            ...this.limits.privacySettings,
          },
        });

        // Wrap output in untrusted boundary (Security Gate G & M14 prompt injection mitigation)
        const wrappedOutput = wrapUntrustedContent(sanitized.content, call.toolName);

        workingMessages.push({
          role: 'tool',
          toolCallId: call.id,
          content: wrappedOutput,
        });

        const stepExecuted: OrchestrationStep = {
          iteration,
          type: 'TOOL_EXECUTED',
          details: {
            toolName: call.toolName,
            success: execRes.success,
            outputLength: sanitized.sanitizedBytes,
            truncated: sanitized.isTruncated,
            restrictedMode: sanitized.isRestrictedMode,
            redactionsCount: sanitized.redactionResult.totalRedactions,
          },
          timestamp: new Date().toISOString(),
        };
        steps.push(stepExecuted);
        callbacks.onStep?.(stepExecuted);
        callbacks.onToolExecuted?.(call, sanitized.content);
      }
    }

    return {
      finalText,
      messages: workingMessages,
      steps,
      iterations: iteration,
      cancelled: false,
      activeProviderId: providerChain[activeProviderIndex]?.providerId,
    };
  }
}
