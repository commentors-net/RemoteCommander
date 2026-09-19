import React, { useState, useEffect, useRef } from 'react';
import { Send, Terminal, AlertTriangle, Check, X, Square, Bot, Sparkles } from 'lucide-react';
import { ServerProfile } from '@remote-commander/shared-types';
import {
  MockAIProvider,
  ToolLoopOrchestrator,
  ChatMessage,
  ToolCallRequest,
} from '@remote-commander/ai-core';
import { Bridge, ApprovalRequest, ToolResult } from '../bridge.js';

interface ChatViewProps {
  activeServer?: ServerProfile | undefined;
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolCall?:
    | {
        name: string;
        output: string;
        durationMs?: number | undefined;
        target?: string | undefined;
        truncated?: boolean | undefined;
      }
    | undefined;
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

  const abortControllerRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    refreshPendingApprovals();
  }, []);

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
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        text: 'Thinking...',
      },
    ]);

    try {
      const tools = await Bridge.listToolDefinitions();
      const provider = new MockAIProvider();
      const orchestrator = new ToolLoopOrchestrator(provider, tools, {
        maxIterations: 10,
        maxOutputCharsPerTool: 50_000,
      });

      const chatHistory: ChatMessage[] = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.text,
        }));
      chatHistory.push({ role: 'user', content: userPrompt });

      let currentToolCallDetails:
        | {
            name: string;
            output: string;
            durationMs?: number | undefined;
            target?: string | undefined;
            truncated?: boolean | undefined;
          }
        | undefined = undefined;

      const result = await orchestrator.run(
        chatHistory,
        'mock-gpt-4o',
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
          onToken: (token: string) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id === assistantMsgId) {
                  const currentText = msg.text === 'Thinking...' ? '' : msg.text;
                  return { ...msg, text: currentText + token };
                }
                return msg;
              }),
            );
          },
        },
        abortController.signal,
      );

      if (result.cancelled) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, text: msg.text + '\n[Execution cancelled by user]' }
              : msg,
          ),
        );
      } else if (!result.requiresApproval && result.finalText) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  text: result.finalText,
                  toolCall: currentToolCallDetails,
                }
              : msg,
          ),
        );
      }
    } catch (err: unknown) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, text: `Error: ${(err as Error)?.message ?? String(err)}` }
            : msg,
        ),
      );
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
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            text: `Approval granted and executed: ${pendingApproval.tool_name}`,
            toolCall: {
              name: pendingApproval.tool_name,
              output: res.stdout || res.stderr || JSON.stringify(res.data, null, 2),
              durationMs: res.duration_ms,
            },
          },
        ]);
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
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          text: `Approval rejected: ${pendingApproval.tool_name}`,
        },
      ]);
      setPendingApproval(null);
    } catch (err: unknown) {
      setApprovalError((err as Error)?.message ?? String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-history">
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              {m.role === 'assistant' && (
                <div style={{ marginTop: '2px', color: '#58a6ff' }}>
                  <Bot size={16} />
                </div>
              )}
              <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{m.text}</div>
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
                  </span>
                  {m.toolCall.durationMs !== undefined && (
                    <span style={{ color: '#8b949e', fontSize: '11px' }}>
                      {m.toolCall.durationMs}ms
                    </span>
                  )}
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', color: '#c9d1d9', margin: 0 }}>
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
              <div>
                <strong>Tool:</strong> <code>{pendingApproval.tool_name}</code>
              </div>
              {pendingApproval.server_name && (
                <div>
                  <strong>Target Server:</strong> {pendingApproval.server_name} (
                  {pendingApproval.environment})
                </div>
              )}
              <div>
                <strong>Reason:</strong> {pendingApproval.decision_reason}
              </div>
              <div style={{ marginTop: '4px' }}>
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
