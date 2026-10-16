import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Alert, EmptyState, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDateTime, relativeDate } from '../utils/format';
import type { ChatMessage, ChatPartner, Conversation } from '../types';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function MessagesPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [users, setUsers] = useState<ChatPartner[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partner, setPartner] = useState<ChatPartner | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeId = Number(searchParams.get('to')) || null;

  const loadLists = useCallback(async () => {
    try {
      const [conv, usr] = await Promise.all([
        api<{ conversations: Conversation[] }>('/api/messages/conversations'),
        api<{ users: ChatPartner[] }>('/api/messages/users'),
      ]);
      setConversations(conv.conversations);
      setUsers(usr.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const openConversation = useCallback(
    async (partnerId: number) => {
      setThreadLoading(true);
      setError('');
      setSearchParams({ to: String(partnerId) });
      try {
        const data = await api<{ partner: ChatPartner; messages: ChatMessage[] }>(
          `/api/messages/${partnerId}/messages`
        );
        setPartner(data.partner);
        setMessages(data.messages);
        setConversations((prev) =>
          prev.map((c) => (c.id === partnerId ? { ...c, unread: 0 } : c))
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Chat laden fehlgeschlagen');
      } finally {
        setThreadLoading(false);
      }
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (activeId) void openConversation(activeId);
    else {
      setPartner(null);
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const interval = setInterval(async () => {
      try {
        const last = messages[messages.length - 1]?.id ?? 0;
        const data = await api<{ messages: ChatMessage[] }>(
          `/api/messages/${activeId}/messages?after=${last}`
        );
        if (data.messages.length > 0) {
          setMessages((prev) => [...prev, ...data.messages]);
        }
      } catch {
        /* Polling-Fehler ignorieren */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeId, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    if (!activeId || !draft.trim()) return;
    const body = draft;
    setDraft('');
    try {
      const res = await api<{ id: number }>(`/api/messages/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: res.id,
          sender_id: user!.id,
          recipient_id: activeId,
          body,
          read_at: null,
          created_at: new Date().toISOString(),
        },
      ]);
      await loadLists();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Senden fehlgeschlagen');
      setDraft(body);
    }
  }

  const knownIds = new Set(conversations.map((c) => c.id));
  const otherUsers = users.filter((u) => !knownIds.has(u.id));

  return (
    <>
      <PageHeader title="Nachrichten" subtitle="Direkter Austausch im Team" />

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <Loading />
      ) : (
        <div className="chat-layout">
          <aside className="card chat-sidebar">
            <div className="chat-sidebar-head">
              <select
                className="form-select"
                value=""
                onChange={(e) => {
                  if (e.target.value) void openConversation(Number(e.target.value));
                }}
              >
                <option value="">Neue Unterhaltung …</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="chat-conv-list">
              {conversations.length === 0 && otherUsers.length === 0 && (
                <div className="chat-empty-hint">Keine Kontakte verfügbar.</div>
              )}
              {conversations.map((c) => (
                <button
                  key={c.id}
                  className={`chat-conv${activeId === c.id ? ' active' : ''}`}
                  onClick={() => void openConversation(c.id)}
                >
                  <span className="avatar">{initials(c.name)}</span>
                  <span className="chat-conv-body">
                    <strong>{c.name}</strong>
                    <span className="chat-conv-last">{c.last_body}</span>
                  </span>
                  <span className="chat-conv-meta">
                    <span>{relativeDate(c.last_at)}</span>
                    {c.unread > 0 && <span className="chat-unread">{c.unread}</span>}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="card chat-thread">
            {!partner ? (
              <EmptyState icon="message-square" title="Unterhaltung wählen" hint="Wähle links eine Person aus." />
            ) : (
              <>
                <header className="chat-thread-head">
                  <span className="avatar">{initials(partner.name)}</span>
                  <div>
                    <strong>{partner.name}</strong>
                    <span className="chat-thread-sub">@{partner.username}</span>
                  </div>
                </header>
                <div className="chat-messages">
                  {threadLoading ? (
                    <Loading label="Nachrichten laden …" />
                  ) : messages.length === 0 ? (
                    <div className="chat-empty-hint">Noch keine Nachrichten – schreib die erste.</div>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className={`chat-bubble${m.sender_id === user?.id ? ' mine' : ''}`}>
                        <div>{m.body}</div>
                        <span className="chat-bubble-time">{formatDateTime(m.created_at)}</span>
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>
                <div className="chat-compose">
                  <input
                    className="form-input"
                    placeholder="Nachricht schreiben …"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button className="btn btn-primary" disabled={!draft.trim()} onClick={() => void send()}>
                    <Icon name="send" size={16} />
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
