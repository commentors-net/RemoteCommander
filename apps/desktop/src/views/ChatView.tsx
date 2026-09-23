import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Terminal,
  AlertTriangle,
  Check,
  X,
  Square,
  Bot,
  Sparkles,
  Cpu,
  ShieldCheck,
  History,
  Plus,
  Trash2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  Brain,
} from 'lucide-react';
import {
  ServerProfile,
  PrivacySettings,
  DEFAULT_PRIVACY_SETTINGS,
} from '@remote-commander/shared-types';
import { ToolLoopOrchestrator, ChatMessage, ToolCallRequest } from '@remote-commander/ai-core';
import {
  Bridge,
  ApprovalRequest,
  ToolResult,
  AIProviderConfig,
  PROVIDER_CAPABILITIES,
  ConversationRecord,
} from '../bridge.js';

interface ChatViewProps {
  activeServer?: ServerProfile | undefined;
}

export interface ActivityStepItem {
  id: string;
  label: string;
  detail?: string | undefined;
  status: 'running' | 'completed' | 'failed';
  timestamp: number;
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  thinking?: string | undefined;
  thoughtDurationMs?: number | undefined;
  isThinking?: boolean | undefined;
  activitySteps?: ActivityStepItem[] | undefined;
  toolCall?: ToolCallDetailPayload | undefined;
}

export interface ToolCallDetailPayload {
  name: string;
  output: string;
  durationMs?: number | undefined;
  target?: string | undefined;
  truncated?: boolean | undefined;
  redactionsCount?: number | undefined;
  restrictedMode?: boolean | undefined;
}

export const ChatView: React.FC<ChatViewProps> = ({ activeServer }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      id: '1',
      role: 'assistant',
      text: `Connected to ${activeServer?.name ?? 'local workstation'}. Policy engine, tool runtime, and local AI loop are active. Ask me about your system or request operations.`,
    },
  ]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [typedAck, setTypedAck] = useState('');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIProviderConfig | null>(null);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(DEFAULT_PRIVACY_SETTINGS);

  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string>('New Session');
  const [conversationsList, setConversationsList] = useState<ConversationRecord[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  const toggleThought = (msgId: string) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);
  const liveStepsRef = useRef<ActivityStepItem[]>([]);
  const liveThinkingRef = useRef<string>('');
  const latestToolCallDetailsRef = useRef<ToolCallDetailPayload | undefined>(undefined);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    } else if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, pendingApproval]);

  const refreshPendingApprovals = async () => {
    try {
      const pending = await Bridge.listPendingApprovals();
      if (pending.length > 0 && pending[0]) {
        setPendingApproval(pending[0]);
      } else {
        setPendingApproval(null);
      }
    } catch (e) {
      console.error('Failed to load pending approvals', e);
    }
  };

  const loadConversations = async () => {
    try {
      const list = await Bridge.listConversations(activeServer?.id);
      setConversationsList(list);
    } catch (e) {
      console.error('Failed to load conversations', e);
    }
  };

  const handleNewChat = () => {
    setCurrentConversationId(null);
    setCurrentConversationTitle('New Session');
    setMessages([
      {
        id: Date.now().toString(),
        role: 'assistant',
        text: `Connected to ${activeServer?.name ?? 'local workstation'}. Policy engine, tool runtime, and local AI loop are active. Ask me about your system or request operations.`,
      },
    ]);
    setPendingApproval(null);
    setApprovalError(null);
    setShowHistoryPanel(false);
  };

  const handleSelectConversation = async (conv: ConversationRecord) => {
    try {
      setIsLoadingHistory(true);
      setCurrentConversationId(conv.id);
      setCurrentConversationTitle(conv.title);
      const storedMsgs = await Bridge.listMessages(conv.id);
      if (storedMsgs.length > 0) {
        const mapped: MessageItem[] = storedMsgs.map((m) => {
          let toolCall = undefined;
          let thinking = undefined;
          let thoughtDurationMs = undefined;
          let activitySteps = undefined;
          if (m.toolCallsJson) {
            try {
              const parsed = JSON.parse(m.toolCallsJson);
              if (parsed && typeof parsed === 'object') {
                if ('toolCall' in parsed || 'thinking' in parsed || 'activitySteps' in parsed) {
                  toolCall = parsed.toolCall;
                  thinking = parsed.thinking;
                  thoughtDurationMs = parsed.thoughtDurationMs;
                  activitySteps = parsed.activitySteps;
                } else {
                  toolCall = parsed;
                }
              }
            } catch {
              // ignore
            }
          }
          return {
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            text: m.content,
            toolCall,
            thinking,
            thoughtDurationMs,
            activitySteps,
            isThinking: false,
          };
        });
        setMessages(mapped);
      } else {
        setMessages([
          {
            id: Date.now().toString(),
            role: 'assistant',
            text: `Continuing session "${conv.title}". Ask me about your system or request operations.`,
          },
        ]);
      }
      setShowHistoryPanel(false);
    } catch (e) {
      console.error('Failed to load conversation messages', e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    try {
      await Bridge.deleteConversation(convId);
      if (currentConversationId === convId) {
        handleNewChat();
      }
      await loadConversations();
    } catch (e) {
      console.error('Failed to delete conversation', e);
    }
  };

  useEffect(() => {
    refreshPendingApprovals();
    Bridge.getAIConfig().then(setAiConfig).catch(console.error);
    Bridge.getPrivacySettings().then(setPrivacySettings).catch(console.error);
    loadConversations();
  }, [activeServer?.id]);

  const runAiToolLoop = async (userPrompt: string) => {
    if (!userPrompt.trim() || isProcessing) return;

    setIsProcessing(true);
    setApprovalError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMsg: MessageItem = {
      id: Date.now().toString(),
      role: 'user',
      text: userPrompt,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    const assistantMsgId = (Date.now() + 1).toString();
    const startTime = Date.now();
    const initialStep: ActivityStepItem = {
      id: 'step-init',
      label: `Analyzing request for ${activeServer?.name ?? 'local workstation'}...`,
      status: 'running',
      timestamp: startTime,
    };
    liveStepsRef.current = [initialStep];
    liveThinkingRef.current = '';
    latestToolCallDetailsRef.current = undefined;

    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        text: '',
        isThinking: true,
        thinking: '',
        thoughtDurationMs: 0,
        activitySteps: [initialStep],
      },
    ]);

    const nowIso = new Date().toISOString();
    let convId = currentConversationId;
    let convTitle = currentConversationTitle;

    if (!convId) {
      convId = `conv-${Date.now()}`;
      convTitle = userPrompt.length > 40 ? `${userPrompt.slice(0, 40)}...` : userPrompt;
      setCurrentConversationId(convId);
      setCurrentConversationTitle(convTitle);
      Bridge.saveConversation({
        id: convId,
        title: convTitle,
        serverId: activeServer?.id ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }).catch(console.error);
    } else {
      Bridge.saveConversation({
        id: convId,
        title: convTitle,
        serverId: activeServer?.id ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }).catch(console.error);
    }

    Bridge.saveMessage({
      id: userMsg.id,
      conversationId: convId,
      role: 'user',
      content: userPrompt,
      createdAt: nowIso,
    }).catch(console.error);

    Bridge.writeLog(
      'info',
      'CHAT_PROMPT',
      `User prompt: ${userPrompt.slice(0, 100)}`,
      JSON.stringify({ target: activeServer?.name ?? 'Local Workstation', prompt: userPrompt }),
    ).catch(console.error);

    let currentToolCallDetails:
      | {
          name: string;
          output: string;
          durationMs?: number | undefined;
          target?: string | undefined;
          truncated?: boolean | undefined;
          redactionsCount?: number | undefined;
          restrictedMode?: boolean | undefined;
        }
      | undefined = undefined;

    try {
      const currentConfig = await Bridge.getAIConfig();
      setAiConfig(currentConfig);
      const currentPrivacy = await Bridge.getPrivacySettings();
      setPrivacySettings(currentPrivacy);
      const tools = await Bridge.listToolDefinitions();
      const provider = await Bridge.getActiveAIProvider(currentConfig);
      const orchestrator = new ToolLoopOrchestrator(provider, tools, {
        maxIterations: 10,
        maxOutputCharsPerTool: currentPrivacy.maxCharsPerToolOutput,
        privacySettings: currentPrivacy,
      });

      const systemPrompt: ChatMessage = {
        role: 'system',
        content: `You are RemoteCommander, a secure desktop AI operations assistant.
You have access to policy-governed tools to query and operate on servers and the local workstation.
Active target server: ${activeServer ? `${activeServer.name} (hostname: ${activeServer.hostname})` : 'Local Workstation'}.
Guidelines:
1. When asked to inspect system metrics (e.g. uptime, disk usage, CPU, memory, processes, services, files), select and invoke the relevant tool(s) (such as ssh.execute, server.disk_usage, local.system_info, etc.).
2. When referencing target server, pass server_id as "${activeServer?.id ?? ''}" or name "${activeServer?.name ?? ''}".
3. CRITICAL: Once the tool executes, ALWAYS synthesize and present a comprehensive, well-formatted final response directly answering the user's question with the output, metrics, and findings. Never return a blank response or only an acknowledgment.`,
      };

      const chatHistory: ChatMessage[] = [systemPrompt];
      for (const m of messages) {
        if (m.role === 'user' || m.role === 'assistant') {
          chatHistory.push({
            role: m.role as 'user' | 'assistant',
            content: m.text,
          });
        }
      }
      chatHistory.push({ role: 'user', content: userPrompt });

      const targetModel =
        currentConfig.model ||
        PROVIDER_CAPABILITIES[currentConfig.provider]?.defaultModel ||
        'gpt-5-mini';

      const result = await orchestrator.run(
        chatHistory,
        targetModel,
        async (call: ToolCallRequest) => {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(call.argumentsJson);
          } catch {
            parsedArgs = {};
          }

          const targetServerId =
            (parsedArgs as { server_id?: string })?.server_id || activeServer?.id;
          const callStart = Date.now();
          const outcome = await Bridge.evaluateAndExecuteTool({
            id: call.id,
            tool_name: call.toolName,
            arguments: parsedArgs,
            target_server_id: targetServerId,
          });

          const durationMs = Date.now() - callStart;

          if (outcome.type === 'executed') {
            const outStr =
              outcome.stdout || outcome.stderr || JSON.stringify(outcome.data, null, 2) || 'Done';
            currentToolCallDetails = {
              name: call.toolName,
              output: outStr,
              durationMs,
              target: targetServerId,
              truncated: outcome.truncated,
            };
            latestToolCallDetailsRef.current = currentToolCallDetails;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, toolCall: currentToolCallDetails } : msg,
              ),
            );
            return {
              success: outcome.success,
              output: outStr,
            };
          } else if (outcome.type === 'approval_required') {
            setPendingApproval(outcome);
            return {
              success: false,
              output: 'Pending user approval',
              requiresApproval: true,
              approvalRequest: outcome,
            };
          } else {
            return {
              success: false,
              output: `Denied by policy: ${outcome.reason}`,
              error: outcome.reason,
            };
          }
        },
        {
          onThoughtToken: (token: string) => {
            liveThinkingRef.current += token;
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id === assistantMsgId) {
                  return { ...msg, thinking: (msg.thinking || '') + token };
                }
                return msg;
              }),
            );
            scrollToBottom('auto');
          },
          onToken: (token: string) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id === assistantMsgId) {
                  return { ...msg, text: msg.text + token };
                }
                return msg;
              }),
            );
            scrollToBottom('auto');
          },
          onStep: (step) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;

                const currentSteps: ActivityStepItem[] = [...(msg.activitySteps || [])];
                const now = Date.now();

                const markLastCompleted = () => {
                  for (let i = currentSteps.length - 1; i >= 0; i--) {
                    if (currentSteps[i]!.status === 'running') {
                      currentSteps[i] = { ...currentSteps[i]!, status: 'completed' };
                      break;
                    }
                  }
                };

                if (step.type === 'AI_THINKING') {
                  markLastCompleted();
                  const label =
                    step.iteration === 1
                      ? `Reasoning with ${targetModel}...`
                      : `Evaluating tool results and formulating response...`;
                  currentSteps.push({
                    id: `step-thinking-${step.iteration}-${now}`,
                    label,
                    status: 'running',
                    timestamp: now,
                  });
                } else if (step.type === 'TOOL_REQUESTED') {
                  markLastCompleted();
                  const toolName = String(step.details?.toolName ?? 'tool');
                  currentSteps.push({
                    id: `step-req-${now}`,
                    label: `Selected tool: ${toolName}`,
                    status: 'completed',
                    timestamp: now,
                  });
                } else if (step.type === 'TOOL_EXECUTING') {
                  markLastCompleted();
                  const toolName = String(step.details?.toolName ?? 'tool');
                  const target = activeServer?.name ?? 'server';
                  currentSteps.push({
                    id: `step-exec-${now}`,
                    label: `Executing ${toolName} on ${target}...`,
                    status: 'running',
                    timestamp: now,
                  });
                } else if (step.type === 'TOOL_EXECUTED') {
                  markLastCompleted();
                  const toolName = String(step.details?.toolName ?? 'tool');
                  const dur = currentToolCallDetails?.durationMs
                    ? `${currentToolCallDetails.durationMs}ms`
                    : '';
                  const bytes = step.details?.outputLength
                    ? `${step.details.outputLength} chars`
                    : '';
                  const detail = [dur, bytes].filter(Boolean).join(', ');
                  currentSteps.push({
                    id: `step-done-${now}`,
                    label: `Completed ${toolName}`,
                    detail: detail || undefined,
                    status: 'completed',
                    timestamp: now,
                  });
                  if (currentToolCallDetails) {
                    const details = {
                      name: currentToolCallDetails.name,
                      output: currentToolCallDetails.output,
                      durationMs: currentToolCallDetails.durationMs,
                      target: currentToolCallDetails.target,
                      truncated: Boolean(step.details?.truncated),
                      restrictedMode: Boolean(step.details?.restrictedMode),
                      redactionsCount: Number(step.details?.redactionsCount ?? 0),
                    };
                    currentToolCallDetails = details;
                    latestToolCallDetailsRef.current = details;
                    liveStepsRef.current = currentSteps;
                    scrollToBottom('auto');
                    return {
                      ...msg,
                      activitySteps: currentSteps,
                      toolCall: details,
                    };
                  }
                } else if (step.type === 'FINAL_ANSWER') {
                  markLastCompleted();
                } else if (step.type === 'PROVIDER_FALLBACK') {
                  markLastCompleted();
                  currentSteps.push({
                    id: `step-fallback-${now}`,
                    label: `Switching to fallback: ${step.details?.toProvider ?? 'provider'}`,
                    status: 'completed',
                    timestamp: now,
                  });
                }

                liveStepsRef.current = currentSteps;
                scrollToBottom('auto');
                return {
                  ...msg,
                  activitySteps: currentSteps,
                };
              }),
            );
          },
        },
        abortController.signal,
      );

      const durationMs = Date.now() - startTime;
      const toolDetails = latestToolCallDetailsRef.current as unknown as
        ToolCallDetailPayload | undefined;
      let finalText = '';
      if (result.requiresApproval) {
        finalText = `I require your explicit approval to execute this operation.`;
      } else if (result.finalText && result.finalText.trim().length > 0) {
        finalText = result.finalText.trim();
      } else if (toolDetails?.output && toolDetails.output.trim().length > 0) {
        finalText = `Operation completed successfully:\n\n\`\`\`\n${toolDetails.output.trim()}\n\`\`\``;
      } else if (result.cancelled) {
        finalText = '[Execution cancelled by user]';
      } else {
        finalText = 'Operation completed.';
      }

      const finalSteps: ActivityStepItem[] = liveStepsRef.current.map((s) => ({
        ...s,
        status: (s.status === 'running' ? 'completed' : s.status) as
          'completed' | 'failed' | 'running',
      }));
      const finalThinking = result.thoughtProcess || liveThinkingRef.current;

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === assistantMsgId) {
            return {
              ...msg,
              isThinking: false,
              thoughtDurationMs: durationMs,
              thinking: finalThinking || '',
              activitySteps: finalSteps,
              text: finalText,
              toolCall: toolDetails,
            };
          }
          return msg;
        }),
      );

      const metadataPayload = {
        toolCall: toolDetails,
        thinking: finalThinking || undefined,
        thoughtDurationMs: durationMs,
        activitySteps: finalSteps,
      };

      Bridge.saveMessage({
        id: assistantMsgId,
        conversationId: convId,
        role: 'assistant',
        content: finalText,
        toolCallsJson: JSON.stringify(metadataPayload),
        createdAt: new Date().toISOString(),
      })
        .then(loadConversations)
        .catch(console.error);

      scrollToBottom('smooth');
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errString = (err as Error)?.message ?? String(err);
      const failedSteps: ActivityStepItem[] = liveStepsRef.current.map((s) => ({
        ...s,
        status: (s.status === 'running' ? 'failed' : s.status) as
          'completed' | 'failed' | 'running',
      }));
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === assistantMsgId) {
            return {
              ...msg,
              isThinking: false,
              thoughtDurationMs: durationMs,
              activitySteps: failedSteps,
              text: `Error: ${errString}`,
            };
          }
          return msg;
        }),
      );
      const metadataPayload = {
        toolCall: latestToolCallDetailsRef.current,
        thoughtDurationMs: durationMs,
        activitySteps: failedSteps,
      };
      Bridge.saveMessage({
        id: assistantMsgId,
        conversationId: convId,
        role: 'assistant',
        content: `Error: ${errString}`,
        toolCallsJson: JSON.stringify(metadataPayload),
        createdAt: new Date().toISOString(),
      })
        .then(loadConversations)
        .catch(console.error);

      scrollToBottom('smooth');

      Bridge.writeLog(
        'error',
        'CHAT_AI_EXCEPTION',
        `AI operation error: ${errString}`,
        JSON.stringify({
          error: errString,
          stack: (err as Error)?.stack,
          target: activeServer?.name ?? 'Local Workstation',
        }),
      ).catch(console.error);
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleApprove = async () => {
    if (!pendingApproval) return;
    setIsProcessing(true);
    setApprovalError(null);
    try {
      const res: ToolResult = await Bridge.submitApproval({
        approval_request_id: pendingApproval.id,
        approved: true,
        typed_acknowledgement: typedAck || undefined,
        approved_by: 'desktop_user',
      });

      if (res.success) {
        const approvedMsgId = Date.now().toString();
        const approvedToolDetails = {
          name: pendingApproval.tool_name,
          output: res.stdout || res.stderr || JSON.stringify(res.data, null, 2),
          durationMs: res.duration_ms,
        };
        setMessages((prev) => [
          ...prev,
          {
            id: approvedMsgId,
            role: 'assistant',
            text: `Approval granted and executed: ${pendingApproval.tool_name}`,
            toolCall: approvedToolDetails,
          },
        ]);
        if (currentConversationId) {
          Bridge.saveMessage({
            id: approvedMsgId,
            conversationId: currentConversationId,
            role: 'assistant',
            content: `Approval granted and executed: ${pendingApproval.tool_name}`,
            toolCallsJson: JSON.stringify(approvedToolDetails),
            createdAt: new Date().toISOString(),
          })
            .then(loadConversations)
            .catch(console.error);
        }
        setPendingApproval(null);
      } else {
        setApprovalError(res.error || 'Execution failed');
      }
    } catch (err: unknown) {
      setApprovalError((err as Error)?.message ?? String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!pendingApproval) return;
    setIsProcessing(true);
    try {
      await Bridge.submitApproval({
        approval_request_id: pendingApproval.id,
        approved: false,
        approved_by: 'desktop_user',
      });
      const rejectMsgId = Date.now().toString();
      setMessages((prev) => [
        ...prev,
        {
          id: rejectMsgId,
          role: 'assistant',
          text: `Approval rejected: ${pendingApproval.tool_name}`,
        },
      ]);
      if (currentConversationId) {
        Bridge.saveMessage({
          id: rejectMsgId,
          conversationId: currentConversationId,
          role: 'assistant',
          content: `Approval rejected: ${pendingApproval.tool_name}`,
          createdAt: new Date().toISOString(),
        })
          .then(loadConversations)
          .catch(console.error);
      }
      setPendingApproval(null);
    } catch (err: unknown) {
      setApprovalError((err as Error)?.message ?? String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="chat-container" style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid #30363d',
          backgroundColor: '#161b22',
          fontSize: '12px',
          color: '#8b949e',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Bot size={14} color="#58a6ff" />
            <span>
              Target:{' '}
              <strong style={{ color: '#c9d1d9' }}>
                {activeServer?.name ?? 'Local Workstation'}
              </strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={14} color="#3fb950" />
            <span>
              AI Provider:{' '}
              <strong style={{ color: '#c9d1d9', textTransform: 'capitalize' }}>
                {aiConfig?.provider ?? 'OpenAI'}
              </strong>{' '}
              <span style={{ color: '#8b949e' }}>({aiConfig?.model ?? 'gpt-5-mini'})</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck
              size={14}
              color={privacySettings.restrictedDataMode ? '#d29922' : '#3fb950'}
            />
            <span>
              Privacy:{' '}
              <strong
                style={{
                  color: privacySettings.restrictedDataMode
                    ? '#d29922'
                    : aiConfig?.provider === 'ollama'
                      ? '#3fb950'
                      : '#58a6ff',
                }}
              >
                {privacySettings.restrictedDataMode
                  ? 'Restricted Data'
                  : aiConfig?.provider === 'ollama'
                    ? 'Local On-Device'
                    : 'Cloud TLS'}
              </strong>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{
              padding: '3px 10px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: '#238636',
              borderColor: '#2ea043',
            }}
            onClick={handleNewChat}
            title="Start a new chat session"
          >
            <Plus size={13} />
            <span>New Chat</span>
          </button>
          <button
            type="button"
            className="btn"
            style={{
              padding: '3px 10px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: showHistoryPanel ? '#30363d' : '#21262d',
              borderColor: '#30363d',
              color: '#c9d1d9',
            }}
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            title="View previous chat sessions"
          >
            <History size={13} />
            <span>History ({conversationsList.length})</span>
          </button>
        </div>
      </div>

      {showHistoryPanel && (
        <div
          style={{
            position: 'absolute',
            top: '41px',
            right: 0,
            bottom: 0,
            width: '320px',
            backgroundColor: '#161b22',
            borderLeft: '1px solid #30363d',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-4px 0 16px rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderBottom: '1px solid #30363d',
              backgroundColor: '#0d1117',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
                fontSize: '13px',
                color: '#c9d1d9',
              }}
            >
              <History size={15} color="#58a6ff" />
              <span>Chat Sessions ({conversationsList.length})</span>
            </div>
            <button
              type="button"
              className="btn"
              style={{ padding: '2px 6px', fontSize: '11px', lineHeight: 1 }}
              onClick={() => setShowHistoryPanel(false)}
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {isLoadingHistory ? (
              <div
                style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: '#8b949e',
                  fontSize: '12px',
                }}
              >
                Loading session messages...
              </div>
            ) : conversationsList.length === 0 ? (
              <div
                style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                  color: '#8b949e',
                  fontSize: '13px',
                }}
              >
                <MessageSquare size={24} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                <p style={{ margin: 0, fontWeight: 500 }}>No chat sessions yet</p>
                <p style={{ fontSize: '11px', marginTop: '6px', color: '#6e7681' }}>
                  Ask questions in chat to automatically record and persist your sessions.
                </p>
              </div>
            ) : (
              conversationsList.map((conv) => {
                const isActive = conv.id === currentConversationId;
                return (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      marginBottom: '6px',
                      backgroundColor: isActive ? '#1f242c' : '#0d1117',
                      border: isActive ? '1px solid #58a6ff' : '1px solid #30363d',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '12px',
                          color: isActive ? '#58a6ff' : '#c9d1d9',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                        title={conv.title}
                      >
                        {conv.title}
                      </div>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          padding: '2px 4px',
                          background: 'transparent',
                          border: 'none',
                          color: '#8b949e',
                          cursor: 'pointer',
                        }}
                        title="Delete chat session"
                        onClick={(e) => handleDeleteConversation(e, conv.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#8b949e',
                        marginTop: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        {new Date(conv.updatedAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {isActive && (
                        <span style={{ color: '#3fb950', fontSize: '10px', fontWeight: 600 }}>
                          Active
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      <div className="chat-history" ref={chatHistoryRef}>
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              {m.role === 'assistant' && (
                <div style={{ marginTop: '2px', color: '#58a6ff' }}>
                  <Bot size={16} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* 1. Model Thought / Live Activity Block (Grey color, like ChatGPT/Gemini) */}
                {m.role === 'assistant' &&
                  (m.isThinking ||
                    (m.activitySteps && m.activitySteps.length > 0) ||
                    m.thinking) && (
                    <div style={{ marginBottom: '12px' }}>
                      {/* Thought header / toggle badge */}
                      <div
                        onClick={() => toggleThought(m.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '4px 10px',
                          backgroundColor: '#161b22',
                          border: '1px solid #30363d',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          color: m.isThinking ? '#58a6ff' : '#8b949e',
                          userSelect: 'none',
                          transition: 'all 0.15s ease',
                        }}
                        title="Click to toggle thought process and execution steps"
                      >
                        {m.isThinking ? (
                          <Loader2 size={13} className="animate-spin" color="#58a6ff" />
                        ) : (
                          <Brain size={13} color="#8b949e" />
                        )}
                        <span style={{ fontWeight: 500 }}>
                          {m.isThinking
                            ? 'Thinking & executing...'
                            : `Thought for ${((m.thoughtDurationMs ?? 0) / 1000).toFixed(1)}s`}
                        </span>
                        {m.activitySteps && m.activitySteps.length > 0 && !m.isThinking && (
                          <span style={{ fontSize: '11px', color: '#6e7681' }}>
                            • {m.activitySteps.length}{' '}
                            {m.activitySteps.length === 1 ? 'step' : 'steps'}
                          </span>
                        )}
                        <span style={{ marginLeft: '4px', opacity: 0.7 }}>
                          {(expandedThoughts[m.id] ?? m.isThinking) ? (
                            <ChevronDown size={13} />
                          ) : (
                            <ChevronRight size={13} />
                          )}
                        </span>
                      </div>

                      {/* Expanded thought details and activity steps */}
                      {(expandedThoughts[m.id] ?? m.isThinking) && (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '10px 14px',
                            backgroundColor: '#0d1117',
                            border: '1px solid #21262d',
                            borderRadius: '6px',
                            fontSize: '12px',
                            color: '#8b949e',
                          }}
                        >
                          {/* Activity Steps */}
                          {m.activitySteps && m.activitySteps.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                                marginBottom: m.thinking ? '10px' : '0',
                              }}
                            >
                              {m.activitySteps.map((step) => (
                                <div
                                  key={step.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '12px',
                                  }}
                                >
                                  {step.status === 'running' && (
                                    <Loader2 size={11} className="animate-spin" color="#58a6ff" />
                                  )}
                                  {step.status === 'completed' && (
                                    <Check size={11} color="#3fb950" />
                                  )}
                                  {step.status === 'failed' && <X size={11} color="#f85149" />}
                                  <span
                                    style={{
                                      color: step.status === 'running' ? '#c9d1d9' : '#8b949e',
                                      fontWeight: step.status === 'running' ? 500 : 400,
                                    }}
                                  >
                                    {step.label}
                                  </span>
                                  {step.detail && (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        color: '#6e7681',
                                        fontFamily: 'monospace',
                                      }}
                                    >
                                      ({step.detail})
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Model Reasoning stream in grey font */}
                          {m.thinking && (
                            <div
                              style={{
                                marginTop:
                                  m.activitySteps && m.activitySteps.length > 0 ? '8px' : '0',
                                paddingTop:
                                  m.activitySteps && m.activitySteps.length > 0 ? '8px' : '0',
                                borderTop:
                                  m.activitySteps && m.activitySteps.length > 0
                                    ? '1px solid #21262d'
                                    : 'none',
                                fontFamily: 'monospace',
                                fontSize: '11px',
                                lineHeight: '1.45',
                                color: '#8b949e',
                                maxHeight: '220px',
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                fontStyle: 'italic',
                              }}
                            >
                              {m.thinking}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                {/* 2. Final Formatted Answer (rendered cleanly in crisp bright text below) */}
                {m.text ? (
                  <div
                    style={{
                      whiteSpace: 'pre-wrap',
                      color: '#f0f6fc',
                      fontSize: '13.5px',
                      lineHeight: '1.6',
                    }}
                  >
                    {m.text}
                  </div>
                ) : m.isThinking ? (
                  <div
                    style={{
                      color: '#8b949e',
                      fontSize: '12px',
                      fontStyle: 'italic',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span className="animate-pulse">Working on your request...</span>
                  </div>
                ) : null}
              </div>
            </div>
            {m.toolCall && (
              <div
                style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#0d1117',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  border: '1px solid #30363d',
                }}
              >
                <div
                  style={{
                    color: '#58a6ff',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Terminal size={12} />
                    <strong>{m.toolCall.name}</strong>
                    {m.toolCall.target && (
                      <span
                        style={{
                          backgroundColor: '#161b22',
                          border: '1px solid #30363d',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          fontSize: '11px',
                          color: '#58a6ff',
                        }}
                      >
                        @{m.toolCall.target}
                      </span>
                    )}
                    {m.toolCall.truncated && (
                      <span
                        style={{
                          backgroundColor: '#2b2005',
                          border: '1px solid #e3b341',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          fontSize: '10px',
                          color: '#e3b341',
                        }}
                      >
                        TRUNCATED
                      </span>
                    )}
                    {m.toolCall.restrictedMode && (
                      <span
                        style={{
                          backgroundColor: 'rgba(88, 166, 255, 0.15)',
                          border: '1px solid #58a6ff',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          fontSize: '10px',
                          color: '#58a6ff',
                        }}
                      >
                        RESTRICTED DATA
                      </span>
                    )}
                    {Boolean(m.toolCall.redactionsCount && m.toolCall.redactionsCount > 0) && (
                      <span
                        style={{
                          backgroundColor: 'rgba(210, 153, 34, 0.15)',
                          border: '1px solid #d29922',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          fontSize: '10px',
                          color: '#d29922',
                        }}
                      >
                        {m.toolCall.redactionsCount} REDACTED
                      </span>
                    )}
                  </span>
                  {m.toolCall.durationMs !== undefined && (
                    <span style={{ color: '#8b949e', fontSize: '11px' }}>
                      {m.toolCall.durationMs}ms
                    </span>
                  )}
                </div>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    color: '#c9d1d9',
                    margin: 0,
                    maxWidth: '100%',
                    overflowX: 'auto',
                    wordBreak: 'break-word',
                  }}
                >
                  {m.toolCall.output}
                </pre>
              </div>
            )}
          </div>
        ))}

        {pendingApproval && (
          <div
            style={{
              padding: '16px',
              backgroundColor: '#161b22',
              border: '1px solid #d29922',
              borderRadius: '8px',
              marginTop: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <AlertTriangle size={18} color="#d29922" />
              <strong style={{ color: '#d29922' }}>
                Tool Execution Approval Required [{pendingApproval.risk_level}]
              </strong>
            </div>

            <div style={{ fontSize: '13px', color: '#c9d1d9', marginBottom: '8px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}
              >
                <div>
                  <strong>Tool:</strong> <code>{pendingApproval.tool_name}</code>
                </div>
                {pendingApproval.environment && (
                  <span
                    style={{
                      backgroundColor:
                        pendingApproval.environment === 'PRODUCTION' ? '#b91c1c' : '#1e3a8a',
                      color: '#ffffff',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {pendingApproval.environment}
                  </span>
                )}
              </div>
              {pendingApproval.server_name && (
                <div>
                  <strong>Target Server:</strong> {pendingApproval.server_name}
                </div>
              )}
              {pendingApproval.authenticated_user && (
                <div>
                  <strong>Authenticated User:</strong>{' '}
                  <code>{pendingApproval.authenticated_user}</code>
                </div>
              )}
              {pendingApproval.target_resource && (
                <div>
                  <strong>Target Resource:</strong> <code>{pendingApproval.target_resource}</code>
                </div>
              )}
              <div>
                <strong>Reason:</strong> {pendingApproval.decision_reason}
              </div>
              {pendingApproval.likely_impact && (
                <div style={{ color: '#ff7b72', marginTop: '4px' }}>
                  <strong>Likely Impact:</strong> {pendingApproval.likely_impact}
                </div>
              )}
              {pendingApproval.rollback_state && (
                <div style={{ color: '#7ee787', marginTop: '2px' }}>
                  <strong>Rollback State:</strong> {pendingApproval.rollback_state}
                </div>
              )}
              <div style={{ marginTop: '6px' }}>
                <strong>Arguments:</strong>
                <pre
                  style={{
                    margin: '4px 0',
                    padding: '6px',
                    background: '#0d1117',
                    borderRadius: '4px',
                    fontSize: '11px',
                  }}
                >
                  {JSON.stringify(pendingApproval.arguments, null, 2)}
                </pre>
              </div>
            </div>

            {pendingApproval.requires_typed_confirmation && (
              <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                <div
                  style={{
                    color: '#f85149',
                    fontWeight: 600,
                    fontSize: '13px',
                    marginBottom: '4px',
                  }}
                >
                  {pendingApproval.typed_confirmation_prompt || 'Typed Confirmation Required'}
                </div>
                <input
                  type="text"
                  className="chat-input"
                  placeholder={`Type "${pendingApproval.typed_confirmation_expected}" to confirm`}
                  value={typedAck}
                  onChange={(e) => setTypedAck(e.target.value)}
                  style={{ width: '100%', marginBottom: '6px' }}
                />
              </div>
            )}

            {approvalError && (
              <div style={{ color: '#f85149', fontSize: '12px', marginBottom: '8px' }}>
                {approvalError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="btn"
                onClick={handleReject}
                disabled={isProcessing}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <X size={14} /> Reject
              </button>
              <button
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={
                  isProcessing ||
                  (pendingApproval.requires_typed_confirmation &&
                    typedAck.trim() !== (pendingApproval.typed_confirmation_expected || 'CONFIRM'))
                }
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Check size={14} /> Approve & Execute
              </button>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} style={{ height: '1px', width: '100%', clear: 'both' }} />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {[
          {
            label: 'Check uptime & disk usage (M6 Acceptance)',
            query: `Check uptime and disk usage on ${activeServer?.name ?? 'production01'}.`,
          },
          {
            label: 'What OS am I running? (M4 Acceptance)',
            query: 'What operating system am I running and what are my system specs?',
          },
          { label: 'List files in directory', query: 'List files in current directory' },
          {
            label: 'Show running processes',
            query: 'What processes are running on my workstation?',
          },
          { label: 'Restart service (Approval flow)', query: 'Restart HTTP service on the server' },
        ].map((item) => (
          <button
            key={item.label}
            className="btn"
            style={{
              fontSize: '12px',
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            onClick={() => runAiToolLoop(item.query)}
            disabled={isProcessing}
          >
            <Sparkles size={12} color="#58a6ff" /> {item.label}
          </button>
        ))}
      </div>

      <div className="chat-input-box">
        <input
          type="text"
          className="chat-input"
          placeholder={`Ask AI about ${activeServer?.name ?? 'local system'} or request operations...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runAiToolLoop(input)}
          disabled={isProcessing}
        />
        {isProcessing ? (
          <button
            className="btn"
            style={{ backgroundColor: '#f85149', color: '#fff' }}
            onClick={handleCancel}
            title="Cancel execution"
          >
            <Square size={16} />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => runAiToolLoop(input)}>
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
