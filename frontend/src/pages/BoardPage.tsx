import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Alert, EmptyState, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDateTime } from '../utils/format';
import type { BoardPost, PostComment } from '../types';

interface CommentBox {
  open: boolean;
  items: PostComment[];
  loading: boolean;
  draft: string;
}

export default function BoardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [comments, setComments] = useState<Record<number, CommentBox>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ posts: BoardPost[] }>(`/api/board${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setPosts(data.posts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePin(post: BoardPost) {
    try {
      await api(`/api/board/${post.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !post.pinned }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktualisieren fehlgeschlagen');
    }
  }

  async function remove(post: BoardPost) {
    if (!window.confirm('Beitrag wirklich löschen?')) return;
    try {
      await api(`/api/board/${post.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  async function toggleComments(post: BoardPost) {
    const box = comments[post.id];
    if (box?.open) {
      setComments((c) => ({ ...c, [post.id]: { ...box, open: false } }));
      return;
    }
    setComments((c) => ({
      ...c,
      [post.id]: { open: true, items: box?.items ?? [], loading: true, draft: box?.draft ?? '' },
    }));
    try {
      const data = await api<{ comments: PostComment[] }>(`/api/board/${post.id}/comments`);
      setComments((c) => ({
        ...c,
        [post.id]: { open: true, items: data.comments, loading: false, draft: c[post.id]?.draft ?? '' },
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kommentare laden fehlgeschlagen');
    }
  }

  async function addComment(post: BoardPost) {
    const box = comments[post.id];
    if (!box?.draft.trim()) return;
    try {
      await api(`/api/board/${post.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: box.draft }),
      });
      const data = await api<{ comments: PostComment[] }>(`/api/board/${post.id}/comments`);
      setComments((c) => ({ ...c, [post.id]: { ...box, items: data.comments, draft: '' } }));
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, comment_count: data.comments.length } : p))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kommentar fehlgeschlagen');
    }
  }

  async function removeComment(post: BoardPost, comment: PostComment) {
    try {
      await api(`/api/board/${post.id}/comments/${comment.id}`, { method: 'DELETE' });
      const data = await api<{ comments: PostComment[] }>(`/api/board/${post.id}/comments`);
      setComments((c) => ({ ...c, [post.id]: { ...c[post.id], items: data.comments } }));
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, comment_count: data.comments.length } : p))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <>
      <PageHeader
        title="Pinnwand"
        subtitle="Mitteilungen und Aushänge für das Team"
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/pinnwand/new')}>
            <Icon name="plus" size={16} />
            Neuer Beitrag
          </button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card filter-bar">
        <input
          className="form-input"
          placeholder="Beiträge durchsuchen …"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <Loading />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="message-square"
          title="Noch keine Beiträge"
          hint="Teile Neuigkeiten, Hinweise oder Ankündigungen mit dem Team."
          action={
            <button className="btn btn-primary" onClick={() => navigate('/pinnwand/new')}>
              <Icon name="plus" size={16} />
              Neuer Beitrag
            </button>
          }
        />
      ) : (
        <div className="board-list">
          {posts.map((post) => {
            const box = comments[post.id];
            const canEdit = post.author_id === user?.id || user?.isAdmin;
            return (
              <article key={post.id} className={`card board-post${post.pinned ? ' pinned' : ''}`}>
                <header className="board-post-head">
                  <div>
                    {post.pinned && (
                      <span className="board-pin">
                        <Icon name="pin" size={14} /> angepinnt
                      </span>
                    )}
                    {post.title && <h2 className="board-post-title">{post.title}</h2>}
                    <div className="board-post-meta">
                      {post.author_name ?? 'Unbekannt'} · {formatDateTime(post.created_at)}
                    </div>
                  </div>
                  <div className="board-post-actions">
                    {canEdit && (
                      <button
                        className={`icon-btn${post.pinned ? ' active' : ''}`}
                        title={post.pinned ? 'Loslösen' : 'Anpinnen'}
                        onClick={() => void togglePin(post)}
                      >
                        <Icon name="pin" size={16} />
                      </button>
                    )}
                    {canEdit && (
                      <button className="icon-btn danger" title="Löschen" onClick={() => void remove(post)}>
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
                </header>
                <p className="board-post-body">{post.body}</p>
                <button className="board-comments-toggle" onClick={() => void toggleComments(post)}>
                  <Icon name="message-square" size={15} />
                  {post.comment_count} Kommentar{post.comment_count === 1 ? '' : 'e'}
                </button>

                {box?.open && (
                  <div className="board-comments">
                    {box.loading ? (
                      <Loading label="Kommentare laden …" />
                    ) : (
                      <>
                        {box.items.map((c) => (
                          <div key={c.id} className="board-comment">
                            <div className="board-comment-head">
                              <strong>{c.author_name ?? 'Unbekannt'}</strong>
                              <span>{formatDateTime(c.created_at)}</span>
                              {(c.author_id === user?.id ||
                                user?.isAdmin ||
                                post.author_id === user?.id) && (
                                <button
                                  className="icon-btn danger tiny"
                                  title="Löschen"
                                  onClick={() => void removeComment(post, c)}
                                >
                                  <Icon name="x" size={12} />
                                </button>
                              )}
                            </div>
                            <div>{c.body}</div>
                          </div>
                        ))}
                        <div className="board-comment-form">
                          <input
                            className="form-input"
                            placeholder="Kommentar schreiben …"
                            value={box.draft}
                            onChange={(e) =>
                              setComments((c) => ({
                                ...c,
                                [post.id]: { ...c[post.id], draft: e.target.value },
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void addComment(post);
                            }}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={!box.draft.trim()}
                            onClick={() => void addComment(post)}
                          >
                            <Icon name="send" size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
