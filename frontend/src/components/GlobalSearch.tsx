import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Icon } from './Icon';
import type { SearchResults } from '../types';
import { deviceStatusLabels } from '../utils/format';

const empty: SearchResults = { items: [], locations: [], events: [], suppliers: [] };

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(empty);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(empty);
      return;
    }
    const handle = window.setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((data) => {
          setResults(data);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const hasResults =
    results.items.length + results.locations.length + results.events.length + results.suppliers.length >
    0;

  function go(path: string) {
    setOpen(false);
    setQuery('');
    navigate(path);
  }

  return (
    <div className="global-search" ref={wrapRef}>
      <div className="search-input-wrap">
        <Icon name="search" size={16} />
        <input
          className="search-input"
          placeholder="Suche: Inventar, Serie, Gerät, Lagerplatz, Event …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              go(`/suche?q=${encodeURIComponent(query.trim())}`);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label="Leeren">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="search-results card">
          {!hasResults && <div className="search-empty">Keine Treffer</div>}
          {results.items.length > 0 && (
            <div className="search-group">
              <div className="search-group-label">Geräte & Artikel</div>
              {results.items.map((item) => (
                <button
                  key={`i-${item.id}`}
                  className="search-item"
                  onClick={() => go(`/inventar/detail?id=${item.id}`)}
                >
                  <Icon name={item.kind === 'geraet' ? 'device' : 'package'} size={16} />
                  <span className="search-item-main">
                    <strong>{item.name}</strong>
                    <small>
                      {item.inventory_number ?? [item.manufacturer, item.model].filter(Boolean).join(' ')}
                      {item.kind === 'artikel' && ` · ${item.quantity} ${item.unit ?? 'Stk'}`}
                      {item.kind === 'geraet' && ` · ${deviceStatusLabels[item.status]}`}
                    </small>
                  </span>
                  {item.location_path && <span className="search-item-side">{item.location_path}</span>}
                </button>
              ))}
            </div>
          )}
          {results.locations.length > 0 && (
            <div className="search-group">
              <div className="search-group-label">Lagerplätze</div>
              {results.locations.map((loc) => (
                <button
                  key={`l-${loc.id}`}
                  className="search-item"
                  onClick={() => go(`/lagerorte/detail?id=${loc.id}`)}
                >
                  <Icon name="map-pin" size={16} />
                  <span className="search-item-main">
                    <strong>{loc.path || loc.name}</strong>
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.events.length > 0 && (
            <div className="search-group">
              <div className="search-group-label">Events</div>
              {results.events.map((ev) => (
                <button key={`e-${ev.id}`} className="search-item" onClick={() => go(`/events/detail?id=${ev.id}`)}>
                  <Icon name="calendar" size={16} />
                  <span className="search-item-main">
                    <strong>{ev.name}</strong>
                    {ev.location && <small>{ev.location}</small>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.suppliers.length > 0 && (
            <div className="search-group">
              <div className="search-group-label">Lieferanten</div>
              {results.suppliers.map((s) => (
                <button
                  key={`s-${s.id}`}
                  className="search-item"
                  onClick={() => go(`/lieferanten?focus=${s.id}`)}
                >
                  <Icon name="truck" size={16} />
                  <span className="search-item-main">
                    <strong>{s.name}</strong>
                  </span>
                </button>
              ))}
            </div>
          )}
          {hasResults && (
            <button
              className="search-all"
              onClick={() => go(`/suche?q=${encodeURIComponent(query.trim())}`)}
            >
              Alle Ergebnisse anzeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
