"use client";

/**
 * A table's save bar (admin.html .save-bar, in the .gc-h header): appears once anything differs from what's saved,
 * with one reason for the whole save, Discard and Save. Confirming asks once more before an outsized change.
 */
export function SaveBar({ count, failed, hidden, note, onNote, onDiscard, onSave, onCancel, saving, confirm, idle }: {
  count: number; failed: number; hidden: number; note: string; onNote: (v: string) => void;
  onDiscard: () => void; onSave: () => void; onCancel: () => void; saving: boolean; confirm: string | null; idle: string;
}) {
  if (!count) return <span className="micro" role="status">{idle}</span>;
  const plural = (n: number) => `${n} change${n > 1 ? "s" : ""}`;
  return (
    <div className="save-bar">
      <span className="cnt" role="status">{failed ? `${plural(failed)} didn’t save` : plural(count)}{hidden ? ` · ${hidden} hidden by filters` : ""}</span>
      <label className="input"><span className="sr-only">Reason for these changes</span>
        <input type="text" maxLength={500} placeholder="Reason (optional)" value={note} onChange={(e) => onNote(e.target.value)} disabled={saving} /></label>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard} disabled={saving}>Discard</button>
      <button type="button" className="btn btn-dark btn-sm" onClick={onSave} disabled={saving} aria-busy={saving}>{saving ? "Saving…" : confirm ?? "Save changes"}</button>
      {confirm && !saving && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
    </div>
  );
}
