// Bottom sheets on document.body (the card face is 3D-transformed, so a fixed
// layer inside it would be positioned against the card): "Mostrar en caja"
// with the code and its QR, and the full terms. Plus the small toast.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'react-qr-code';
import { X } from 'lucide-react';
import type { TermsView } from '../../../lib/advent/viewModel';

const Sheet: React.FC<{
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className: string;
  reducedMotion: boolean;
  children: React.ReactNode;
}> = ({ open, onClose, labelledBy, className, reducedMotion, children }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Mounted closed first so the slide-up transition plays, and kept mounted
  // while it slides back down.
  const [shown, setShown] = useState(false);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (!open) {
      setShown(false);
      const t = setTimeout(() => setMounted(false), reducedMotion ? 0 : 400);
      return () => clearTimeout(t);
    }
    setMounted(true);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    const restore = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      restore?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, reducedMotion]);
  if (!mounted && !open) return null;
  return createPortal(
    <div className={`adv-portal${reducedMotion ? ' adv-rm' : ''}`}>
      <div className={`adv-scrim${shown ? ' open' : ''}`} onClick={onClose} />
      <div className={`adv-sheet ${className}${shown ? ' open' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <button ref={closeRef} type="button" className="x" aria-label="Cerrar" onClick={onClose}>
          <X aria-hidden />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
};

const List: React.FC<{ items: string[] }> = ({ items }) => (
  <ul>
    {items.map((t, i) => (
      <li key={i}>{t}</li>
    ))}
  </ul>
);

export interface CodeSheetData {
  title: string;
  code: string;
  validity: string;
  terms: TermsView;
}

export const CodeSheet: React.FC<{
  data: CodeSheetData | null;
  who: string;
  reducedMotion: boolean;
  onClose: () => void;
}> = ({ data: current, who, reducedMotion, onClose }) => {
  const id = React.useId();
  const last = useRef(current);
  if (current) last.current = current;
  const data = current ?? last.current;
  return (
    <Sheet open={!!current} onClose={onClose} labelledBy={id} className="adv-code-sheet" reducedMotion={reducedMotion}>
      {data && (
        <>
          <div className="grab" />
          <span className="who">{who}</span>
          <h3 id={id}>{data.title}</h3>
          <div className="qr">
            <QRCode value={data.code} size={170} level="M" bgColor="#ffffff" fgColor="#000000" style={{ width: '100%', height: '100%' }} />
          </div>
          <div className="code">{data.code}</div>
          {data.validity && <div className="valid">{data.validity}</div>}
          <div className="hint">Muéstrale esta pantalla a la recepción</div>
          <details>
            <summary>Términos y condiciones</summary>
            <List items={data.terms.own} />
            {data.terms.common && <List items={data.terms.common} />}
          </details>
        </>
      )}
    </Sheet>
  );
};

export const TermsSheet: React.FC<{ terms: TermsView | null; reducedMotion: boolean; onClose: () => void }> = ({ terms: current, reducedMotion, onClose }) => {
  const id = React.useId();
  const last = useRef(current);
  if (current) last.current = current;
  const terms = current ?? last.current;
  return (
    <Sheet open={!!current} onClose={onClose} labelledBy={id} className="adv-terms-sheet" reducedMotion={reducedMotion}>
      {terms && (
        <>
          <h3 id={id}>Términos y condiciones</h3>
          <p className="for">{terms.forLine}</p>
          <h4>De este regalo</h4>
          <List items={terms.own} />
          {terms.common && (
            <>
              <h4>Para todos los regalos del calendario</h4>
              <List items={terms.common} />
            </>
          )}
        </>
      )}
    </Sheet>
  );
};

/** One message at a time; it fades after 2.4 s. */
export const useAdventToast = () => {
  const [toast, setToast] = useState<{ text: string; visible: boolean; key: number }>({ text: '', visible: false, key: 0 });
  useEffect(() => {
    if (!toast.visible) return;
    const t = setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 2400);
    return () => clearTimeout(t);
  }, [toast.visible, toast.key]);
  const show = React.useCallback((text: string) => setToast({ text, visible: true, key: Date.now() }), []);
  const node = createPortal(
    <div className="adv-portal">
      <div className={`adv-toast${toast.visible ? ' show' : ''}`} role="status">
        {toast.text}
      </div>
    </div>,
    document.body,
  );
  return { show, node };
};
