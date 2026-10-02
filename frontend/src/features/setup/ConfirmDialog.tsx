import { Modal } from '../../components/Modal';

interface Props {
  title: string;
  text: string;
  /** The button that goes ahead, like "Leave". */
  go: string;
  /** The button that stays, like "Keep editing". */
  stay: string;
  onGo: () => void;
  onClose: () => void;
}

/** Asks before something that loses what was typed. */
export function ConfirmDialog({ title, text, go, stay, onGo, onClose }: Props) {
  return (
    <Modal title={title} onClose={onClose} width={400}>
      <div className="add">
        <p className="add-keynote">{text}</p>
        <div className="add-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{stay}</button>
          <button type="button" className="btn btn-danger" onClick={onGo}>{go}</button>
        </div>
      </div>
    </Modal>
  );
}
