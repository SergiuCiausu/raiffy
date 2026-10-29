"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";

/** The console's side sheet (console.html `dialog.sheet`): a modal dialog that Escape, the close button and the parent can close. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby="sheet-title" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="sheet-h"><h2 id="sheet-title">{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><XIcon aria-hidden="true" /></button></div>
      {children}
      <div className="sheet-f">{footer}</div>
    </dialog>
  );
}
