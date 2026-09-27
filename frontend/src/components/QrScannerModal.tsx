import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Modal, Alert } from './ui';

const SCANNER_ID = 'qr-scanner-region';

export default function QrScannerModal({
  onClose,
  onResult,
}: {
  onClose: () => void;
  onResult: (text: string) => void;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [manual, setManual] = useState('');

  useEffect(() => {
    const canUseCamera =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function';

    if (!canUseCamera) {
      setError(
        'Die Kamera ist über diese Verbindung nicht erreichbar (nötig ist https oder localhost). Nutze unten das Eingabefeld und klicke auf „Einplanen“ – ein USB-Scanner fügt den Code dort automatisch ein.'
      );
      setStarting(false);
      return;
    }

    const scanner = new Html5Qrcode(SCANNER_ID);
    scannerRef.current = scanner;

    const startCamera = (facingMode: 'environment' | 'user') =>
      scanner.start(
        { facingMode },
        {
          fps: 10,
          qrbox: (w: number, h: number) => ({
            width: Math.min(260, Math.max(160, w)),
            height: Math.min(260, Math.max(160, h)),
          }),
        },
        (decodedText: string) => {
          void scanner
            .stop()
            .then(() => scanner.clear())
            .catch(() => undefined);
          cbRef.current(decodedText);
        },
        () => undefined
      );

    startCamera('environment')
      .catch(() => startCamera('user'))
      .then(() => setStarting(false))
      .catch(() => {
        setError(
          'Die Kamera konnte nicht gestartet werden (Berechtigung prüfen oder Kamera vorhanden?). Du kannst den QR-Code unten einfach einfügen und auf „Einplanen“ klicken.'
        );
        setStarting(false);
      });

    return () => {
      scannerRef.current = null;
      void scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => undefined);
    };
  }, []);

  function handleManual(e: FormEvent) {
    e.preventDefault();
    const text = manual.trim();
    if (!text) return;
    setManual('');
    onResult(text);
  }

  return (
    <Modal title="QR-Code scannen" onClose={onClose}>
      {error && <Alert tone="error">{error}</Alert>}
      {starting && !error && (
        <div className="loading-row">
          <span className="spinner" />
          <span>Kamera wird gestartet …</span>
        </div>
      )}
      <div
        id={SCANNER_ID}
        style={{
          width: '100%',
          minHeight: 240,
          borderRadius: 10,
          overflow: 'hidden',
          background: '#111',
          marginBottom: 10,
        }}
      />
      <form className="scan-form" onSubmit={handleManual}>
        <input
          className="form-input"
          placeholder="QR-Code per USB-Scanner hier einfügen …"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={!manual.trim()}>
          Einplanen
        </button>
      </form>
      <p className="form-hint">
        Halte ein Asset-, Case- oder Lagerort-Label in die Kamera – oder scanne den Code mit einem
        USB-Scanner in das Feld oben, falls die Kamera nicht verfügbar ist.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Modal>
  );
}