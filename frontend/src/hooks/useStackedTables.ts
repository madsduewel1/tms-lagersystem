import { useEffect } from 'react';

/**
 * Tabellen mit der Klasse `table--stack` werden auf kleinen Screens als
 * Karten dargestellt (siehe theme.css). Diese Darstellung braucht pro Zelle
 * ein `data-label` mit dem Spaltentitel. Statt es überall von Hand zu pflegen,
 * wird es hier automatisch aus dem `<thead>` abgeleitet und bei DOM-Änderungen
 * (neue Zeilen nach dem Laden) aktualisiert.
 */
export function useStackedTables() {
  useEffect(() => {
    let raf = 0;

    function annotate() {
      const tables = document.querySelectorAll<HTMLTableElement>('table.table--stack');
      for (const table of tables) {
        const headerRow = table.tHead?.rows[0];
        if (!headerRow) continue;
        const labels = Array.from(headerRow.cells).map((th) => th.textContent?.trim() ?? '');
        for (const row of table.tBodies) {
          for (const tr of Array.from(row.rows)) {
            Array.from(tr.cells).forEach((td, index) => {
              if (td.colSpan === 1 && labels[index]) td.setAttribute('data-label', labels[index]);
              else td.removeAttribute('data-label');
            });
          }
        }
      }
    }

    function schedule() {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (window.matchMedia('(max-width: 720px)').matches) annotate();
      });
    }

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);
}
