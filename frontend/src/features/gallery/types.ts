import type { Book } from '../../data/books';

export interface SectionProps {
  books: Book[];
  now: number;
  enter: boolean;
  onOpen: (book: Book, rect: DOMRect) => void;
}
