import { Modal } from '../../components/Modal';

interface Props {
  title: string;
  /** The tab it's being removed from: the question is about the other place it's in. */
  from: 'mine' | 'shelf';
  /** True takes it out of both. */
  onChoose: (both: boolean) => void;
  onClose: () => void;
}

/** Removing one of the reader's books that is also on the Shared Library: from one place, or both? */
export function RemoveDialog({ title, from, onChoose, onClose }: Props) {
  const mine = from === 'mine';
  return (
    <Modal title={mine ? 'Remove from your books' : 'Take off the Shared Library'} onClose={onClose} width={420}>
      <div className="rm">
        <p className="rm-ask">
          “{title}” is {mine ? 'on the Shared Library' : 'in your books'} too. {mine ? 'Take it off there as well?' : 'Remove it from there as well?'}
        </p>
        <p className="rm-note">Anyone well into it keeps their copy when it leaves the Shared Library.</p>
        <div className="rm-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onChoose(false)}>{mine ? 'Keep it shared' : 'Keep it in my books'}</button>
          <button type="button" className="btn btn-danger" onClick={() => onChoose(true)}>Remove from both</button>
        </div>
      </div>
    </Modal>
  );
}
