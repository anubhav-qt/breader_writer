import { zip, type ZipFile } from './zip.ts';

/*
 * A book as an EPUB 3 file (step 7): how a book leaves the writer for now, and the owner adds it to
 * breader by hand. Kept plain so breader reads it well: a title page, then one file a chapter, each
 * a section with its heading and paragraphs, a contents page breader takes its chapters from, and no
 * styling of its own (the reader brings that).
 */

export interface EpubChapter {
  number: number;
  title: string;
  /** Plain prose, paragraphs a blank line apart. */
  body: string;
}

export interface EpubBook {
  /** The book's id, which names it for good. */
  id: string;
  title: string;
  author: string;
  chapters: EpubChapter[];
  /** When it was last changed. */
  modified: Date;
}

/** Text as XML takes it. */
function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A chapter's heading as the contents and the page show it: its number, then its title when it has one. */
export function headingOf(chapter: EpubChapter): string {
  if (chapter.title.trim() === '') {
    return `Chapter ${chapter.number}`;
  }
  return `Chapter ${chapter.number}: ${chapter.title.trim()}`;
}

function fileOf(chapter: EpubChapter): string {
  return `chapter-${chapter.number}.xhtml`;
}

/** An XHTML page of the book, its body as given. */
function page(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<title>${escaped(title)}</title>
</head>
<body>
${body}
</body>
</html>
`;
}

function titlePage(book: EpubBook): string {
  let by = '';
  if (book.author.trim() !== '') {
    by = `\n<p>${escaped(book.author)}</p>`;
  }
  return page(book.title, `<section epub:type="titlepage">\n<h1>${escaped(book.title)}</h1>${by}\n</section>`);
}

function chapterPage(chapter: EpubChapter): string {
  const paragraphs: string[] = [];
  for (const paragraph of chapter.body.split(/\n\s*\n/)) {
    const text = paragraph.trim().replace(/\s*\n\s*/g, ' ');
    if (text) {
      paragraphs.push(`<p>${escaped(text)}</p>`);
    }
  }
  const heading = `<h1>Chapter ${chapter.number}</h1>`;
  let title = '';
  if (chapter.title.trim() !== '') {
    title = `\n<h2>${escaped(chapter.title.trim())}</h2>`;
  }
  const body = `<section epub:type="chapter" id="chapter-${chapter.number}">\n${heading}${title}\n${paragraphs.join('\n')}\n</section>`;
  return page(headingOf(chapter), body);
}

function navPage(book: EpubBook): string {
  const items = book.chapters.map((chapter) => `<li><a href="${fileOf(chapter)}">${escaped(headingOf(chapter))}</a></li>`);
  const body = `<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n<ol>\n${items.join('\n')}\n</ol>\n</nav>`;
  return page('Contents', body);
}

/** The time a package says it was changed: to the second, in UTC. */
function modifiedOf(when: Date): string {
  return `${when.toISOString().slice(0, 19)}Z`;
}

function packageOf(book: EpubBook): string {
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
  ];
  const spine = ['<itemref idref="title"/>'];
  for (const chapter of book.chapters) {
    items.push(`<item id="chapter-${chapter.number}" href="${fileOf(chapter)}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="chapter-${chapter.number}"/>`);
  }
  let creator = '';
  if (book.author.trim() !== '') {
    creator = `\n<dc:creator>${escaped(book.author)}</dc:creator>`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:uuid:${book.id}</dc:identifier>
<dc:title>${escaped(book.title)}</dc:title>${creator}
<dc:language>en</dc:language>
<meta property="dcterms:modified">${modifiedOf(book.modified)}</meta>
</metadata>
<manifest>
${items.join('\n')}
</manifest>
<spine>
${spine.join('\n')}
</spine>
</package>
`;
}

const CONTAINER = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

/** The book as an EPUB file. */
export function epubOf(book: EpubBook): Uint8Array {
  const encoder = new TextEncoder();
  const text = (path: string, content: string): ZipFile => ({ path, data: encoder.encode(content) });
  // The mimetype comes first, stored as it is, as EPUB readers look for it there.
  const files: ZipFile[] = [
    text('mimetype', 'application/epub+zip'),
    text('META-INF/container.xml', CONTAINER),
    text('OEBPS/content.opf', packageOf(book)),
    text('OEBPS/nav.xhtml', navPage(book)),
    text('OEBPS/title.xhtml', titlePage(book)),
  ];
  for (const chapter of book.chapters) {
    files.push(text(`OEBPS/${fileOf(chapter)}`, chapterPage(chapter)));
  }
  return zip(files, book.modified);
}

/** A file name for the book: its title, without what file systems turn away. */
export function fileNameOf(title: string): string {
  const allowed = title.replace(/[\\/:*?"<>|]+/g, ' ');
  const plain = allowed.replace(/\s+/g, ' ').trim();
  if (plain === '') {
    return 'book.epub';
  }
  return `${plain}.epub`;
}
