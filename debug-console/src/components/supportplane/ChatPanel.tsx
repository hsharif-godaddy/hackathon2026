'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import sp from '@/components/supportplane/sp.module.css';
import SPIcon from '@/components/supportplane/SPIcon';

interface ChatMsg { role: 'user'|'assistant'|'status'; content: string; }

const INIT_CHIPS = [
    'Who is on call right now?', 'Show me open CIEC tickets',
    'Top L1 contact reasons this week', 'Summarise recent refund patterns',
];

export default function ChatPanel() {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input,    setInput]    = useState('');
    const [loading,  setLoading]  = useState(false);
    const [chips,    setChips]    = useState(INIT_CHIPS);
    const bottomRef  = useRef<HTMLDivElement>(null);

    useEffect(() => { bottomRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages]);

    const send = useCallback(async (q: string) => {
        if (!q.trim() || loading) return;
        setChips([]);
        const history = messages.filter((m)=>m.role!=='status').map((m)=>({role:m.role,content:m.content}));
        setMessages((p) => [...p, {role:'user',content:q}, {role:'status',content:'Thinking…'}]);
        setInput('');
        setLoading(true);
        try {
            const res = await fetch('/api/supportplane/ask',{
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({message:q, history}),
            });
            if (!res.body) throw new Error('No stream');
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            setMessages((p) => [...p.filter((m)=>m.role!=='status'),{role:'assistant',content:''}]);
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const {done,value} = await reader.read();
                if (done) break;
                for (const line of dec.decode(value).split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const raw = line.slice(6).trim();
                    if (raw === '[DONE]') break;
                    try { buf += (JSON.parse(raw) as {delta?:string}).delta ?? ''; } catch { continue; }
                    const m = /SUGGEST:\[([^\]]+)\]/.exec(buf);
                    const clean = m ? buf.replace(m[0],'').trimEnd() : buf;
                    if (m) { try { setChips(JSON.parse(`[${m[1]}]`) as string[]); } catch { /* ignore */ } }
                    setMessages((p) => {
                        const n = [...p];
                        const last = n[n.length-1];
                        if (last?.role==='assistant') n[n.length-1] = {...last,content:clean};
                        return n;
                    });
                }
            }
        } catch (e) {
            setMessages((p) => [...p.filter((m)=>m.role!=='status'), {role:'assistant',content:`⚠ ${e instanceof Error?e.message:'Error'}`}]);
        } finally { setLoading(false); }
    }, [loading, messages]);

    return (
        <div className={sp.chatWrap} style={{height:'calc(100dvh - 48px)'}}>
            <div className={sp.chatMessages}>
                {messages.length === 0 && (
                    <div className={sp.empty} style={{paddingTop:60}}>
                        <SPIcon size={40} />
                        <div className={sp.emptyTitle}>SupportPlane AI</div>
                        <div className={sp.emptySub}>Ask about on-call, CIEC tickets, transcripts, or care trends</div>
                    </div>
                )}
                {messages.map((m,i) => (
                    <div key={i} className={`${sp.chatMsg} ${m.role==='user'?sp.chatMsgUser:m.role==='status'?sp.chatMsgStatus:sp.chatMsgAssistant}`}>
                        {m.role==='assistant'
                            ? <div className={sp.prose}><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                            : m.content}
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
            {chips.length > 0 && (
                <div className={sp.chatSuggestions}>
                    {chips.map((c) => <button key={c} className={sp.chatChip} onClick={()=>send(c)}>{c}</button>)}
                </div>
            )}
            <div className={sp.chatInputRow}>
                <textarea className={sp.chatInput} rows={1}
                    placeholder="Ask about trends, on-call, or CIEC tickets…"
                    value={input} onChange={(e)=>setInput(e.target.value)}
                    onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(input);}}} />
                <button className={`${sp.btn} ${sp.btnPrimary}`} onClick={()=>send(input)} disabled={loading||!input.trim()}>
                    Send
                </button>
            </div>
        </div>
    );
}
