import './sessao.css';

interface Props {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação em tela (o `window.confirm` do iOS standalone é feio e fácil de tocar sem querer). */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancelar', danger, onConfirm, onCancel }: Props) {
  return (
    <div className="dlg-backdrop" onClick={onCancel} role="presentation">
      <div className="dlg" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {message && <p className="text-secondary">{message}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
