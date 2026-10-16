import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Icon } from '../components/Icon';
import type { SearchResults } from '../types';
import { deviceStatusLabels } from '../utils/format';

const empty: SearchResults = { items: [], locations: [], events: [], suppliers: [] };

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [input, setInput] = useState(query);
  const [results, setResults] = useState<SearchResults>(empty);
  const [loading, setLoading] = useState(false);

  useEffect(() => setInput(query), [query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(empty);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults(empty))
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const total =
    results.items.length + results.locations.length + results.events.length + results.suppliers.length;
  const q = query.trim();

  function submit(value: string) {
    setParams(value.trim() ? { q: value.trim() } : {});
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Suche</h1>
          <p className="page-sub">
            {q ? `${total} Treffer für „${q}“` : 'Geräte, Artikel, Lagerplätze, Events und Lieferanten durchsuchen'}
          </p>
        </div>
      </div>

      <form
        className="filter-bar card"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div className="grow search-input-wrap">
          <Icon name="search" size={16} />
          <input
            className="search-input"
            placeholder="Suchbegriff eingeben …"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Suchen
        </button>
      </form>

      {loading && <div className="loading-row">Suche läuft …</div>}

      {!loading && q.length >= 2 && total === 0 && (
        <div className="card empty-state">
          <span className="empty-icon">
            <Icon name="search" size={24} />
          </span>
          <strong className="empty-title">Keine Treffer</strong>
          <p className="empty-hint">Für „{q}“ wurde nichts gefunden. Prüfe die Schreibweise oder suche kürzer.</p>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="search-page-groups">
          {results.items.length > 0 && (
            <section className="card section">
              <h2 className="section-title">Geräte & Artikel ({results.items.length})</h2>
              <div className="search-group-list">
                {results.items.map((item) => (
                  <Link key={`i-${item.id}`} className="search-item" to={`/inventar/detail?id=${item.id}`}>
                    <span className="search-item-main">
                      <Icon name={item.kind === 'geraet' ? 'device' : 'package'} size={18} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {' '}
                          {item.inventory_number ??
                            [item.manufacturer, item.model].filter(Boolean).join(' ')}
                          {item.kind === 'artikel' && ` · ${item.quantity} ${item.unit ?? 'Stk'}`}
                          {item.kind === 'geraet' && ` · ${deviceStatusLabels[item.status]}`}
                        </small>
                      </span>
                    </span>
                    {item.location_path && <span className="search-item-side">{item.location_path}</span>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.locations.length > 0 && (
            <section className="card section">
              <h2 className="section-title">Lagerplätze ({results.locations.length})</h2>
              <div className="search-group-list">
                {results.locations.map((loc) => (
                  <Link key={`l-${loc.id}`} className="search-item" to={`/lagerorte/detail?id=${loc.id}`}>
                    <span className="search-item-main">
                      <Icon name="warehouse" size={18} />
                      <strong>{loc.path || loc.name}</strong>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.events.length > 0 && (
            <section className="card section">
              <h2 className="section-title">Events ({results.events.length})</h2>
              <div className="search-group-list">
                {results.events.map((ev) => (
                  <Link key={`e-${ev.id}`} className="search-item" to={`/events/detail?id=${ev.id}`}>
                    <span className="search-item-main">
                      <Icon name="calendar" size={18} />
                      <span>
                        <strong>{ev.name}</strong>
                        {ev.location && <small> · {ev.location}</small>}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.suppliers.length > 0 && (
            <section className="card section">
              <h2 className="section-title">Lieferanten ({results.suppliers.length})</h2>
              <div className="search-group-list">
                {results.suppliers.map((s) => (
                  <div key={`s-${s.id}`} className="search-item">
                    <span className="search-item-main">
                      <Icon name="truck" size={18} />
                      <span>
                        <strong>{s.name}</strong>
                        {s.contact_name && <small> · {s.contact_name}</small>}
                        {s.email && <small> · {s.email}</small>}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
