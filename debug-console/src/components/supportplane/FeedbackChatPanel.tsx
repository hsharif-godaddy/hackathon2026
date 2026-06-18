'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

interface Msg { role: 'user' | 'assistant'; text: string; ts: Date; }

const SUGGESTIONS = [
    'What are the top feedback topics this month?',
    'Show me the trend of negative ratings over the last 4 weeks',
    'Which apps have the lowest average ratings?',
    'How many feedback records were submitted this week vs last week?',
    'What percentage of feedback is positive (rating 5+)?',
    'Show me a breakdown of feedback by category',
];

async function callGemini(messages: { role: string; text: string }[]): Promise<string> {
    const context = `You are a Feedback Intelligence assistant with access to customer feedback data for the GoDaddy Airo App Builder platform.
You analyze feedback from S3/Athena stored in a local SQLite database.
Feedback has: rating (1-7 scale), category (feedback/issue/support), app_id, plan_type, topics, and free-text.
Answer questions about feedback trends, sentiment, ratings, topics, and app-level breakdowns.
Be concise, use data-focused answers, and mention when you'd need to query the database for live numbers.`;

    const prompt = `${context}\n\nConversation:\n${messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')}\nAssistant:`;

    const res = await fetch('/api/supportplane/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context: 'feedback' }),
    });
    if (!res.ok) throw new Error('Chat API error');
    const d = await res.json();
    return d.text ?? d.message ?? 'No response';
}

export default function FeedbackChatPanel() {
    const [messages, setMessages] = useState<Msg[]>([
        { role: 'assistant', text: 'Hello! I\'m your Feedback Intelligence assistant. Ask me about customer feedback trends, ratings, topics, or app-level breakdowns. What would you like to know?', ts: new Date() },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    async function send(text = input) {
        if (!text.trim() || loading) return;
        const userMsg: Msg = { role: 'user', text: text.trim(), ts: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        try {
            const history = [...messages, userMsg].map(m => ({ role: m.role, text: m.text }));
            const reply = await callGemini(history);
            setMessages(prev => [...prev, { role: 'assistant', text: reply, ts: new Date() }]);
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', text: '⚠️ Failed to get a response. Please check the chat API configuration.', ts: new Date() }]);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className={sp.panelRoot} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>
                        <Sparkles size={16} style={{ display: 'inline', marginRight: 6, color: 'var(--purple)' }} />
                        Feedback AI Chat
                    </div>
                    <div className={sp.panelSub}>Ask questions about customer feedback in natural language</div>
                </div>
            </div>

            {/* Suggestions */}
            {messages.length === 1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {SUGGESTIONS.map(s => (
                        <button key={s} onClick={() => send(s)}
                            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 11, color: 'var(--t2)', cursor: 'pointer' }}>
                            {s}
                        </button>
                    ))}
                </div>
            )}

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, marginBottom: 12 }}>
                {messages.map((m, i) => (
                    <div key={i} style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
                    }}>
                        <div style={{
                            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                            background: m.role === 'user' ? 'var(--blue)' : 'var(--purple)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            {m.role === 'user' ? <User size={14} color="#fff" /> : <Bot size={14} color="#fff" />}
                        </div>
                        <div style={{
                            background: m.role === 'user' ? 'var(--blue)18' : 'var(--surface2)',
                            border: `1px solid ${m.role === 'user' ? 'var(--blue)40' : 'var(--border)'}`,
                            borderRadius: m.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                            padding: '10px 14px', maxWidth: '80%',
                        }}>
                            <div style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                                {m.ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Bot size={14} color="#fff" />
                        </div>
                        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px', padding: '10px 14px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {[0, 1, 2].map(j => (
                                    <div key={j} style={{
                                        width: 6, height: 6, borderRadius: '50%', background: 'var(--t3)',
                                        animation: `bounce 1.2s ${j * 0.2}s infinite`,
                                    }} />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <input
                    className={sp.searchInput}
                    style={{ flex: 1, fontSize: 13, padding: '10px 14px' }}
                    placeholder="Ask about feedback trends, ratings, topics…"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    disabled={loading}
                />
                <button className={sp.btnPrimary} onClick={() => send()} disabled={loading || !input.trim()}>
                    <Send size={14} />
                    Send
                </button>
            </div>
        </div>
    );
}
