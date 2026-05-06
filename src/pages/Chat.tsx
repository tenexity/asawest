import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDistanceToNow } from "date-fns";

type Conv = { id: string; title: string; updated_at: string };
type Msg = { id?: string; role: "user" | "assistant"; content: string; tool_calls?: string[] };

const STARTERS = [
  "Which freeze-prone branches are short on PEX fittings right now?",
  "Show me our total exposure to the R-410A phase-down",
  "Which suppliers have the worst on-time performance this quarter?",
  "What's the financial impact of all current stockouts?",
  "Which SKUs are excess at Phoenix but at risk at Dallas?",
  "Which contractors drive the most demand for water heaters?",
];

export default function Chat() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (user) loadConversations(); }, [user]);
  useEffect(() => { if (convId) loadMessages(convId); else setMessages([]); }, [convId]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

  async function loadConversations() {
    const { data } = await supabase.from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(50);
    setConversations((data ?? []) as Conv[]);
  }

  async function loadMessages(id: string) {
    const { data } = await supabase.from("chat_messages").select("id, role, content, tool_calls").eq("conversation_id", id).order("created_at");
    setMessages((data ?? []).map((m: any) => ({ ...m, tool_calls: m.tool_calls ?? [] })) as Msg[]);
  }

  async function newConversation(): Promise<string | undefined> {
    if (!user) return;
    const { data, error } = await supabase.from("conversations").insert({ user_id: user.id, title: "New conversation" }).select().single();
    if (error) { toast.error(error.message); return; }
    setConvId(data.id);
    setMessages([]);
    loadConversations();
    return data.id as string;
  }

  async function deleteConversation(id: string) {
    await supabase.from("conversations").delete().eq("id", id);
    if (convId === id) setConvId(null);
    loadConversations();
  }

  async function send(text: string) {
    if (!text.trim() || sending) return;
    let id = convId;
    if (!id) {
      id = await newConversation();
      if (!id) return;
    }
    const userMsg: Msg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setSending(true);

    // Update title from first user message
    if (messages.length === 0) {
      const title = text.slice(0, 60);
      await supabase.from("conversations").update({ title }).eq("id", id);
      loadConversations();
    }

    try {
      const { data, error } = await supabase.functions.invoke("chat", {
        body: { conversation_id: id, history: newMessages.map((m) => ({ role: m.role, content: m.content })) },
      });
      if (error) throw error;
      setMessages([...newMessages, { role: "assistant", content: data.content ?? "(no response)", tool_calls: data.sql ?? [] }]);
    } catch (err: any) {
      toast.error(err.message ?? "Chat failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-[240px_1fr] gap-4 h-[calc(100vh-7rem)]">
      <aside className="space-y-2 overflow-hidden flex flex-col">
        <Button onClick={newConversation} variant="outline" className="w-full justify-start gap-2">
          <Plus className="h-4 w-4" /> New conversation
        </Button>
        <ScrollArea className="flex-1">
          <div className="space-y-1">
            {conversations.map((c) => (
              <div key={c.id} className={cn("group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent", convId === c.id && "bg-accent")}
                onClick={() => setConvId(c.id)}>
                <div className="flex-1 truncate">
                  <div className="truncate">{c.title}</div>
                  <div className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}</div>
                </div>
                <button className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h1 className="font-semibold">Ask AI</h1>
          <span className="text-xs text-muted-foreground ml-auto">Inventory analyst · Claude Sonnet</span>
        </div>

        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="p-6 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Try one of these:</p>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="text-xs px-3 py-2 rounded-full border bg-background hover:bg-accent transition-colors text-left">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} onAskFollowUp={send} />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
                Querying inventory data…
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask about inventory, suppliers, demand…"
            disabled={sending}
          />
          <Button onClick={() => send(input)} disabled={sending || !input.trim()} className="gap-1">
            <Send className="h-4 w-4" /> Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-muted/50 rounded-2xl rounded-bl-sm px-4 py-3 text-sm space-y-2">
        <div className="prose prose-sm dark:prose-invert max-w-none prose-table:text-xs prose-th:px-2 prose-td:px-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
        {msg.tool_calls && msg.tool_calls.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3 w-3" /> Show queries ({msg.tool_calls.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1">
              {msg.tool_calls.map((s, i) => (
                <pre key={i} className="text-[11px] bg-background border rounded p-2 overflow-x-auto whitespace-pre-wrap">{s}</pre>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
