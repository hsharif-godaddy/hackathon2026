'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import sp from '@/components/supportplane/sp.module.css';

interface Msg { role: 'user' | 'assistant'; text: string; ts: Date; }

const SUGGESTIONS = [
    'What are the most common intents in transcripts this week?',
    'Show me transcripts where customers mentioned billing issues',
    'How many transcripts were uploaded in the last 7 days?',
    'Which agents handled the most escalations?',
    'What are the top 5 issue categories from last month?',
    'Find transcripts with negative sentiment and unresolved issues',
];

async function askChat(lastUserMessage: string): Promise<string> {
    const res = await fetch('/api/supportplane/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: lastUserMessage, context: 'transcripts' }),
    });
    if (!res.ok) throw new Error('Chat API error');
    const d = await res.json();
    return d.text ?? d.message ?? 'No response';
}

export default function TranscriptChatPanel() {
    const [messages, setMessages] = useState<Msg[]>([
        { role: 'assistant', text: 'Hi! I\'m your L1 Transcript assistant. Ask me about call patterns, agent performance, issue categories, or customer sentiment from your transcripts.', ts: new Date() },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    // Load chat history on mount
    useEffect(() => {
        async function loadHistory() {
            try {
                const res = await fetch('/api/supportplane/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ load_history: true, context: 'transcripts' }),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.messages && data.messages.length > 0) {
                        setSessionId(data.session_id);
                        // Filter out malformed messages from old implementation
                        const loaded = data.messages
                            .filter((m: any) => !m.content?.includes('You are an L1 Transcript Intelligence assistant'))
                            .map((m: any) => ({
                                role: m.role,
                                text: m.content,
                                ts: new Date(m.ts),
                            }));
                        if (loaded.length > 0) {
                            setMessages([...loaded]);
                        }
                    }
                }
            } catch {
                // Silently degrade - start fresh if history load fails
            }
        }
        void loadHistory();
    }, []);

    async function send(text = input) {
        if (!text.trim() || loading) return;
        const userMsg: Msg = { role: 'user', text: text.trim(), ts: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        try {
            const reply = await askChat(text.trim());
            setMessages(prev => [...prev, { role: 'assistant', text: reply, ts: new Date() }]);
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', text: '⚠️ Failed to get a response. Check the chat API configuration.', ts: new Date() }]);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className={sp.panelRoot} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>
                        <Sparkles size={16} style={{ display: 'inline', marginRight: 6, color: 'var(--blue)' }} />
                        L1 Transcripts — AI Chat
                    </div>
                    <div className={sp.panelSub}>Natural language queries on your transcript database</div>
                </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 11, color: 'var(--t2)', cursor: 'pointer' }}>
                        {s}
                    </button>
                ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, marginBottom: 12 }}>
                {messages.map((m, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                        <div style={{
                            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                            background: m.role === 'user' ? 'var(--blue)' : 'var(--green)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            {m.role === 'user' ? <User size={14} color="#fff" /> : <Bot size={14} color="#fff" />}
                        </div>
                        <div style={{
                            background: m.role === 'user' ? 'var(--blue)18' : 'var(--surface2)',
                            border: `1px solid ${m.role === 'user' ? 'var(--blue)40' : 'var(--border)'}`,
                            borderRadius: m.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                            padding: '10px 14px',
                            maxWidth: '80%',
                            wordWrap: 'break-word',
                            overflowWrap: 'break-word',
                            overflow: 'hidden',
                        }}>
                            <div className={sp.markdown} style={{
                                fontSize: 13,
                                color: 'var(--t1)',
                                lineHeight: 1.6,
                                wordWrap: 'break-word',
                                overflowWrap: 'break-word',
                            }}>
                                <ReactMarkdown
                                    components={{
                                        ul: ({node, ...props}) => <ul style={{margin: 0, paddingLeft: '1.5em'}} {...props} />,
                                        ol: ({node, ...props}) => <ol style={{margin: 0, paddingLeft: '1.5em'}} {...props} />,
                                        p: ({node, ...props}) => <p style={{margin: '0.5em 0'}} {...props} />,
                                    }}
                                >{m.text}</ReactMarkdown>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                                {m.ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Bot size={14} color="#fff" />
                        </div>
                        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px', padding: '10px 14px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {[0,1,2].map(j => (
                                    <div key={j} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--t3)', animation: `bounce 1.2s ${j * 0.2}s infinite` }} />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <input
                    className={sp.searchInput}
                    style={{ flex: 1, fontSize: 13, padding: '10px 14px' }}
                    placeholder="Ask about transcripts, agents, intents, sentiment…"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    disabled={loading}
                />
                <button className={sp.btnPrimary} onClick={() => send()} disabled={loading || !input.trim()}>
                    <Send size={14} /> Send
                </button>
            </div>
        </div>
    );
}
