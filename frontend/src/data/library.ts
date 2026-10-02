import type { BookRecord, Format } from '../books/types';
import { colorKeyFor } from './colors';

const HOUR = 3_600_000;

interface Seed {
  title: string;
  author: string;
  words: number;
  line: string;
  format?: Format;
  /** Placed by hand, for the series previews. */
  hoursAgo?: number;
  progress?: number;
}

/*
 * Real public-domain books bundled in /public/samples. Each line is the actual sentence at the
 * seeded position, so the card and the reader agree.
 */
const SAMPLES: Array<Seed & { id: string; url: string; progress: number; hoursAgo: number; color: string }> = [
  { id: 'alice', title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll', format: 'EPUB', url: '/samples/alice.epub', words: 26369, progress: 0.54, hoursAgo: 2, color: 'rose',
    line: 'Now, if you only kept on good terms with him, he’d do almost anything you liked with the clock.' },
  { id: 'pride', title: 'Pride and Prejudice', author: 'Jane Austen', format: 'TXT', url: '/samples/pride-and-prejudice.txt', words: 127360, progress: 0.12, hoursAgo: 26, color: 'teal',
    line: '“It shows an affection for her sister that is very pleasing,” said Bingley.' },
  { id: 'time-machine', title: 'The Time Machine', author: 'H. G. Wells', format: 'TXT', url: '/samples/the-time-machine.txt', words: 32454, progress: 0.68, hoursAgo: 80, color: 'indigo',
    line: 'My first was to secure some safe place of refuge, and to make myself such arms of metal or stone as I could contrive.' },
  { id: 'yellow-wallpaper', title: 'The Yellow Wallpaper', author: 'Charlotte Perkins Gilman', format: 'TXT', url: '/samples/the-yellow-wallpaper.txt', words: 6085, progress: 0, hoursAgo: 125, color: 'ochre',
    line: 'It is very seldom that mere ordinary people like John and myself secure ancestral halls for the summer.' },
  { id: 'flatland', title: 'Flatland', author: 'Edwin A. Abbott', format: 'TXT', url: '/samples/flatland.txt', words: 33844, progress: 0.03, hoursAgo: 220, color: 'graphite',
    line: 'As there is neither sun with us, nor any light of such a kind as to make shadows, we have none of the helps to the sight that you have in Spaceland.' },
  { id: 'gift-of-the-magi', title: 'The Gift of the Magi', author: 'O. Henry', format: 'TXT', url: '/samples/the-gift-of-the-magi.txt', words: 2065, progress: 1, hoursAgo: 900, color: 'moss',
    line: 'They are the magi.' },
];

/* Placeholder books for layout previews: public-domain titles with their real opening lines. */
const PLACEHOLDERS: Seed[] = [
  { title: 'Moby-Dick', author: 'Herman Melville', words: 206000, line: 'Call me Ishmael.' },
  { title: 'A Tale of Two Cities', author: 'Charles Dickens', words: 135000, line: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness…' },
  { title: 'A Christmas Carol', author: 'Charles Dickens', words: 28900, line: 'Marley was dead: to begin with.' },
  { title: 'Peter Pan', author: 'J. M. Barrie', words: 47000, line: 'All children, except one, grow up.' },
  { title: 'Adventures of Huckleberry Finn', author: 'Mark Twain', words: 110000, line: 'You don’t know about me without you have read a book by the name of The Adventures of Tom Sawyer; but that ain’t no matter.' },
  { title: 'Anna Karenina', author: 'Leo Tolstoy', words: 350000, line: 'Happy families are all alike; every unhappy family is unhappy in its own way.' },
  { title: 'David Copperfield', author: 'Charles Dickens', words: 358000, line: 'Whether I shall turn out to be the hero of my own life, or whether that station will be held by anybody else, these pages must show.' },
  { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', words: 47000, line: 'In my younger and more vulnerable years my father gave me some advice that I’ve been turning over in my mind ever since.' },
  { title: 'Jane Eyre', author: 'Charlotte Brontë', words: 183000, line: 'There was no possibility of taking a walk that day.' },
  { title: 'Wuthering Heights', author: 'Emily Brontë', words: 107000, line: '1801.—I have just returned from a visit to my landlord—the solitary neighbour that I shall be troubled with.' },
  { title: 'Middlemarch', author: 'George Eliot', words: 316000, line: 'Miss Brooke had that kind of beauty which seems to be thrown into relief by poor dress.' },
  { title: 'The Picture of Dorian Gray', author: 'Oscar Wilde', words: 78000, line: 'The studio was filled with the rich odour of roses, and when the light summer wind stirred amidst the trees of the garden, there came through the open door the heavy scent of the lilac, or the more delicate perfume of the pink-flowering thorn.' },
  { title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', words: 105000, line: 'To Sherlock Holmes she is always the woman.' },
  { title: 'Little Women', author: 'Louisa May Alcott', words: 185000, line: '“Christmas won’t be Christmas without any presents,” grumbled Jo, lying on the rug.' },
  { title: 'Emma', author: 'Jane Austen', words: 156000, line: 'Emma Woodhouse, handsome, clever, and rich, with a comfortable home and happy disposition, seemed to unite some of the best blessings of existence; and had lived nearly twenty-one years in the world with very little to distress or vex her.' },
  { title: 'Sense and Sensibility', author: 'Jane Austen', words: 119000, line: 'The family of Dashwood had long been settled in Sussex.' },
  { title: 'Great Expectations', author: 'Charles Dickens', words: 183000, line: 'My father’s family name being Pirrip, and my Christian name Philip, my infant tongue could make of both names nothing longer or more explicit than Pip.' },
  { title: 'Heart of Darkness', author: 'Joseph Conrad', words: 38000, format: 'PDF', line: 'The Nellie, a cruising yawl, swung to her anchor without a flutter of the sails, and was at rest.' },
  { title: 'The War of the Worlds', author: 'H. G. Wells', words: 60000, line: 'No one would have believed in the last years of the nineteenth century that this world was being watched keenly and closely by intelligences greater than man’s and yet as mortal as his own…' },
  { title: 'The Wonderful Wizard of Oz', author: 'L. Frank Baum', words: 39000, line: 'Dorothy lived in the midst of the great Kansas prairies, with Uncle Henry, who was a farmer, and Aunt Em, who was the farmer’s wife.' },
  { title: 'The Call of the Wild', author: 'Jack London', words: 32000, line: 'Buck did not read the newspapers, or he would have known that trouble was brewing, not alone for himself, but for every tide-water dog, strong of muscle and with warm, long hair, from Puget Sound to San Diego.' },
  { title: 'Walden', author: 'Henry David Thoreau', words: 106000, format: 'PDF', line: 'When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbor, in a house which I had built myself, on the shore of Walden Pond, in Concord, Massachusetts, and earned my living by the labor of my hands only.' },
  { title: 'Don Quixote', author: 'Miguel de Cervantes', words: 430000, line: 'In a village of La Mancha, the name of which I have no desire to call to mind, there lived not long since one of those gentlemen that keep a lance in the lance-rack, an old buckler, a lean hack, and a greyhound for coursing.' },
  { title: 'The Count of Monte Cristo', author: 'Alexandre Dumas', words: 464000, line: 'On the 24th of February, 1815, the look-out at Notre-Dame de la Garde signalled the three-master, the Pharaon from Smyrna, Trieste, and Naples.' },
  { title: 'Ulysses', author: 'James Joyce', words: 265000, line: 'Stately, plump Buck Mulligan came from the stairhead, bearing a bowl of lather on which a mirror and a razor lay crossed.' },
  { title: 'Mrs Dalloway', author: 'Virginia Woolf', words: 64000, line: 'Mrs. Dalloway said she would buy the flowers herself.' },
  { title: 'The Secret Garden', author: 'Frances Hodgson Burnett', words: 80000, line: 'When Mary Lennox was sent to Misselthwaite Manor to live with her uncle everybody said she was the most disagreeable-looking child ever seen.' },
  { title: 'The Odyssey', author: 'Homer', words: 117000, line: 'Tell me, O muse, of that ingenious hero who travelled far and wide after he had sacked the famous town of Troy.' },
  { title: 'Strange Case of Dr Jekyll and Mr Hyde', author: 'Robert Louis Stevenson', words: 25000, line: 'Mr. Utterson the lawyer was a man of a rugged countenance that was never lighted by a smile; cold, scanty and embarrassed in discourse; backward in sentiment; lean, long, dusty, dreary and yet somehow lovable.' },
  { title: 'The Invisible Man', author: 'H. G. Wells', words: 49000, line: 'The stranger came early in February, one wintry day, through a biting wind and a driving snow, the last snowfall of the year, over the down, walking from Bramblehurst railway station, and carrying a little black portmanteau in his thickly gloved hand.' },
  { title: 'Around the World in Eighty Days', author: 'Jules Verne', words: 63000, line: 'Mr. Phileas Fogg lived, in 1872, at No. 7, Saville Row, Burlington Gardens, the house in which Sheridan died in 1814.' },
  { title: 'The Awakening', author: 'Kate Chopin', words: 50000, line: 'A green and yellow parrot, which hung in a cage outside the door, kept repeating over and over: “Allez vous-en! Allez vous-en! Sapristi! That’s all right!”' },
  { title: 'Northanger Abbey', author: 'Jane Austen', words: 77000, line: 'No one who had ever seen Catherine Morland in her infancy would have supposed her born to be an heroine.' },
  { title: 'The Hound of the Baskervilles', author: 'Arthur Conan Doyle', words: 59000, line: 'Mr. Sherlock Holmes, who was usually very late in the mornings, save upon those not infrequent occasions when he was up all night, was seated at the breakfast table.' },
  { title: 'Frankenstein', author: 'Mary Shelley', words: 75000, line: 'You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings.' },
  { title: 'Dracula', author: 'Bram Stoker', words: 160000, line: '3 May. Bistritz.—Left Munich at 8:35 P. M., on 1st May, arriving at Vienna early next morning; should have arrived at 6:46, but train was an hour late.' },
  { title: 'The Scarlet Letter', author: 'Nathaniel Hawthorne', words: 63000, format: 'MD', line: 'A throng of bearded men, in sad-coloured garments and grey steeple-crowned hats, intermixed with women, some wearing hoods, and others bareheaded, was assembled in front of a wooden edifice, the door of which was heavily timbered with oak, and studded with iron spikes.' },
  { title: 'Anne of Green Gables', author: 'L. M. Montgomery', words: 97000, line: 'Mrs. Rachel Lynde lived just where the Avonlea main road dipped down into a little hollow, fringed with alders and ladies’ eardrops and traversed by a brook that had its source away back in the woods of the old Cuthbert place…' },
  { title: 'Persuasion', author: 'Jane Austen', words: 83000, line: 'Sir Walter Elliot, of Kellynch Hall, in Somersetshire, was a man who, for his own amusement, never took up any book but the Baronetage…' },
  // Later books in series already above, so previews show series at every library size.
  { title: 'Ozma of Oz', author: 'L. Frank Baum', words: 41000, hoursAgo: 9, progress: 0.35, line: 'The wind blew hard and joggled the water of the ocean, sending ripples across its surface.' },
  { title: 'The Marvelous Land of Oz', author: 'L. Frank Baum', words: 42000, hoursAgo: 12, progress: 1, line: 'In the Country of the Gillikins, which is at the North of the Land of Oz, lived a youth called Tip.' },
  { title: 'The Sign of the Four', author: 'Arthur Conan Doyle', words: 43000, hoursAgo: 20, progress: 0.6, line: 'Sherlock Holmes took his bottle from the corner of the mantel-piece and his hypodermic syringe from its neat morocco case.' },
  { title: 'A Study in Scarlet', author: 'Arthur Conan Doyle', words: 43000, hoursAgo: 3000, progress: 1, line: 'In the year 1878 I took my degree of Doctor of Medicine of the University of London, and proceeded to Netley to go through the course prescribed for surgeons in the army.' },
  { title: 'Anne of Avonlea', author: 'L. M. Montgomery', words: 88000, hoursAgo: 60, progress: 0, line: 'A tall, slim girl, “half-past sixteen,” with serious gray eyes and hair which her friends called auburn, had sat down on the broad red sandstone doorstep of a Prince Edward Island farmhouse one ripe afternoon in August, firmly resolved to construe so many lines of Virgil.' },
];

/* More books in series, only for the series preview. */
const SERIES_EXTRAS: Seed[] = [
  { title: 'Dorothy and the Wizard in Oz', author: 'L. Frank Baum', words: 44000, line: 'The train from ’Frisco was very late.' },
  { title: 'The Road to Oz', author: 'L. Frank Baum', words: 40000, line: '“Please, miss,” said the shaggy man, “can you tell me the road to Butterfield?”' },
  { title: 'Good Wives', author: 'Louisa May Alcott', words: 90000, line: 'In order that we may start afresh and go to Meg’s wedding with free minds, it will be well to begin with a little gossip about the Marches.' },
  { title: 'Little Men', author: 'Louisa May Alcott', words: 100000, line: '“Please, sir, is this Plumfield?” asked a ragged boy of the man who opened the great gate at which the omnibus left him.' },
  { title: 'Jo’s Boys', author: 'Louisa May Alcott', words: 95000, line: '“If anyone had told me what wonderful changes were to take place here in ten years, I wouldn’t have believed it,” said Mrs. Jo to Mrs. Meg, as they sat on the piazza at Plumfield one summer day, looking about them with faces full of pride and pleasure.' },
  { title: 'A Princess of Mars', author: 'Edgar Rice Burroughs', words: 65000, line: 'I am a very old man; how old I do not know.' },
  { title: 'The Gods of Mars', author: 'Edgar Rice Burroughs', words: 88000, line: 'Twelve years had passed since I had laid the body of my great-uncle, Captain John Carter, of Virginia, away from the sight of men in that strange mausoleum in the old cemetery at Richmond.' },
  { title: 'The Warlord of Mars', author: 'Edgar Rice Burroughs', words: 70000, line: 'In the shadows of the forest that flanks the crimson plain by the side of the Lost Sea of Korus in the Valley Dor, beneath the hurtling moons of Mars…' },
];

/*
 * The series preview: five series and no other books, each in a different state. Oz is part way
 * through, Sherlock Holmes has its latest finished so the next is up, Little Women is all read,
 * Barsoom is just started and Anne hasn't been opened. [title, hours since read, progress]
 */
const SERIES_PREVIEW: Array<{ name: string; books: Array<[string, number, number]> }> = [
  { name: 'The Land of Oz', books: [['The Wonderful Wizard of Oz', 700, 1], ['The Marvelous Land of Oz', 150, 1], ['Ozma of Oz', 9, 0.35], ['Dorothy and the Wizard in Oz', 400, 0], ['The Road to Oz', 400, 0]] },
  { name: 'Sherlock Holmes', books: [['A Study in Scarlet', 3000, 1], ['The Sign of the Four', 20, 1], ['The Adventures of Sherlock Holmes', 500, 0], ['The Hound of the Baskervilles', 500, 0]] },
  { name: 'Little Women', books: [['Little Women', 2000, 1], ['Good Wives', 1400, 1], ['Little Men', 600, 1], ['Jo’s Boys', 90, 1]] },
  { name: 'Barsoom', books: [['A Princess of Mars', 2, 0.12], ['The Gods of Mars', 30, 0], ['The Warlord of Mars', 30, 0]] },
  { name: 'Anne of Green Gables', books: [['Anne of Green Gables', 200, 0], ['Anne of Avonlea', 200, 0]] },
];

/*
 * A library as it arrives from real files, for previewing the cards: titles with imprints and
 * volumes, illustrators and translators credited as authors, a PDF named after its file. Invented
 * books with invented lines, and public-domain ones with their real opening lines.
 * [series, number] where the file names one; `cover` draws one for the book.
 */
const MIXED: Array<Seed & { hoursAgo: number; progress: number; series?: [string, number]; cover?: [string, string] }> = [
  { title: 'The Hollow Lantern and the Seventh Girl, Vol. 1', author: 'Ren Mikado and 402', words: 52000, hoursAgo: 1, progress: 0.19, series: ['The Hollow Lantern', 1], cover: ['#1d2340', '#f3c969'],
    line: 'Nobody at Kiriyama High remembers the day the lantern first went out, except me.' },
  { title: 'The Paper Crane Murders (Harbour Noir)', author: 'Kenji Oyama, Emma Hale (Translator)', words: 61000, hoursAgo: 3, progress: 0,
    line: 'Before I set down the strange history that follows, I walked the village once more to be sure of the distances.' },
  { title: 'Kagami no Mori no Tanteidan - Volume 1', author: 'Aoi Hoshino', words: 48000, hoursAgo: 6, progress: 0.02,
    line: 'The mirror in the forest showed a girl who was not there, and she was waving.' },
  { title: 'The Unlikely Knight of Lantern Academy, Vol. 2: Entrance Exam Arc, Part II', author: 'Sora Miyazawa and Kei Ishida', words: 64000, hoursAgo: 8, progress: 0, series: ['The Unlikely Knight of Lantern Academy', 2],
    line: 'An unremarkable older brother and a remarkable younger sister walked through the gate together.' },
  { title: 'Frankenstein; or, The Modern Prometheus', author: 'Shelley, Mary', words: 75000, hoursAgo: 20, progress: 0.41,
    line: 'You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings.' },
  { title: 'Salt & Stone: A History of the World in Twelve Harbours', author: 'Maya Okafor', words: 120000, hoursAgo: 30, progress: 0.63,
    line: 'Every harbour begins as an argument between the land and the sea, and most of them are still arguing.' },
  { title: 'Botchan', author: 'Natsume Sōseki, Yasotaro Morri (Translator)', words: 52000, hoursAgo: 44, progress: 0.88,
    line: 'Because of an hereditary recklessness, I have been playing always a losing game since my childhood.' },
  { title: 'Microsoft Word - field_notes_on_estuary_birds.docx', author: '', format: 'PDF', words: 9000, hoursAgo: 70, progress: 0, line: 'Page 1 of 48' },
  { title: 'The Hollow Lantern and the Seventh Girl, Vol. 2', author: 'Ren Mikado and 402', words: 55000, hoursAgo: 90, progress: 0, series: ['The Hollow Lantern', 2],
    line: 'The second time the lantern went out, I was ready for it, and it did not help at all.' },
  { title: 'The Art of War (Classic Edition)', author: 'Sun Tzu; Lionel Giles (Translator)', words: 12000, hoursAgo: 130, progress: 1,
    line: 'Sun Tzu said: The art of war is of vital importance to the State.' },
  { title: 'Quiet Hours: Notes on Attention, Boredom and the Art of Reading Slowly', author: 'Tomas Lind', words: 70000, hoursAgo: 160, progress: 0.07,
    line: 'I lost the ability to read a long book somewhere between my second phone and my third.' },
  { title: 'Death on the Night Ferry: A Detective Inspector Moreau Mystery (Harbour Noir)', author: 'Claire Dumont, Emma Hale (Translator)', words: 83000, hoursAgo: 200, progress: 0,
    line: 'The ferry left Calais at eleven, and by midnight one of its passengers had stopped breathing.' },
  { title: 'The Winter Anthology: Twelve New Voices', author: 'Various Authors; edited by Hana Moss', words: 90000, hoursAgo: 260, progress: 0.3,
    line: 'Snow came to the valley the way news does, first as a rumour and then all at once.' },
  { title: 'Twenty Thousand Leagues Under the Sea (Illustrated)', author: 'Verne, Jules', words: 101000, hoursAgo: 320, progress: 1,
    line: 'The year 1866 was signalised by a remarkable incident, a mysterious and puzzling phenomenon, which doubtless no one has yet forgotten.' },
  { title: 'Meditations', author: 'Marcus Aurelius, George Long (Translator)', words: 60000, hoursAgo: 400, progress: 0.15,
    line: 'From my grandfather Verus I learned good morals and the government of my temper.' },
  { title: 'The Unlikely Knight of Lantern Academy, Vol. 1: Entrance Exam Arc, Part I', author: 'Sora Miyazawa and Kei Ishida', words: 62000, hoursAgo: 500, progress: 1, series: ['The Unlikely Knight of Lantern Academy', 1],
    line: 'On the morning of the entrance exam, my sister was the best in the country and I was the worst.' },
  { title: 'The Pocket Atlas of Clouds (Illustrated Edition)', author: 'Priya Raman; illustrated by Jonah Wells', words: 30000, hoursAgo: 600, progress: 0,
    line: 'Look up: the sky has been writing to you all day.' },
  { title: 'Treasure Island', author: 'Robert Louis Stevenson', words: 67000, hoursAgo: 800, progress: 0.52,
    line: 'Squire Trelawney, Dr. Livesey, and the rest of these gentlemen having asked me to write down the whole particulars about Treasure Island, from the beginning to the end, keeping nothing back but the bearings of the island, and that only because there is treasure not yet lifted, I take up my pen in the year of grace 17— and go back to the time when my father kept the Admiral Benbow inn and the brown old seaman with the sabre cut first took up his lodging under our roof.' },
  { title: 'The Moonstone: A Romance (Lantern Classics)', author: 'Wilkie Collins', words: 196000, hoursAgo: 1100, progress: 0.09,
    line: 'I address these lines—written in India—to my relatives in England.' },
  { title: 'Witch of the Salt Road (Light Novel) Vol. 4', author: 'Hiro Tanabe, Yuu Kurosaki (Illustrator)', words: 45000, hoursAgo: 1500, progress: 0.7, series: ['Witch of the Salt Road', 4],
    line: 'The salt merchants say a witch can’t cross running water, which is why I bought a boat.' },
  { title: 'Witch of the Salt Road (Light Novel) Vol. 3', author: 'Hiro Tanabe, Yuu Kurosaki (Illustrator)', words: 44000, hoursAgo: 1600, progress: 1, series: ['Witch of the Salt Road', 3],
    line: 'Three towns, two lies and one very expensive cart of salt.' },
  { title: 'Ghost Stories of an Antiquary', author: 'M. R. James', words: 45000, hoursAgo: 2400, progress: 0,
    line: 'St. Bertrand de Comminges is a decayed town on the spurs of the Pyrenees, not very far from Toulouse, and still nearer to Bagnères-de-Luchon.' },
];

/** Placeholder books that belong to a series, by title: [series, number]. */
const SERIES: Record<string, [string, number]> = {
  'The Wonderful Wizard of Oz': ['The Land of Oz', 1],
  'The Marvelous Land of Oz': ['The Land of Oz', 2],
  'Ozma of Oz': ['The Land of Oz', 3],
  'A Study in Scarlet': ['Sherlock Holmes', 1],
  'The Sign of the Four': ['Sherlock Holmes', 2],
  'The Adventures of Sherlock Holmes': ['Sherlock Holmes', 3],
  'The Hound of the Baskervilles': ['Sherlock Holmes', 5],
  'Anne of Green Gables': ['Anne of Green Gables', 1],
  'Anne of Avonlea': ['Anne of Green Gables', 2],
};
const seriesOf = (title: string) => {
  const s = SERIES[title];
  return s ? { series: s[0], seriesIndex: s[1] } : {};
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Placeholder formats vary so every gallery shape shows up in previews. */
const FORMAT_MIX: Format[] = ['EPUB', 'EPUB', 'PDF', 'TXT', 'EPUB', 'MD', 'Text', 'EPUB', 'PDF', 'TXT'];

const slug = (s: string) => s.toLowerCase().replace(/[’'“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function sampleRecords(now: number): BookRecord[] {
  return SAMPLES.map((s) => ({
    id: s.id, title: s.title, author: s.author, format: s.format ?? 'TXT', source: 'sample', url: s.url, shared: false,
    addedAt: now - (s.hoursAgo + 48) * HOUR, words: s.words, color: s.color,
    progress: s.progress, line: s.line, lastOpened: now - s.hoursAgo * HOUR,
  }));
}

export function placeholderRecords(now: number): BookRecord[] {
  const r = rng(7);
  return PLACEHOLDERS.map((p, j) => {
    const roll = r();
    const progress = p.progress ?? (roll < 0.2 ? 0 : roll < 0.33 ? 1 : Math.round((0.03 + r() * 0.9) * 100) / 100);
    let hoursAgo = 5 + j * j * 1.9 + j * 9;
    if (j >= 34) hoursAgo *= 3;
    if (p.hoursAgo !== undefined) hoursAgo = p.hoursAgo;
    return {
      id: `ph-${slug(p.title)}`, title: p.title, author: p.author, format: p.format ?? FORMAT_MIX[j % FORMAT_MIX.length], source: 'placeholder', shared: false,
      addedAt: now - (hoursAgo + 24) * HOUR, words: p.words, color: colorKeyFor(p.title), progress, line: p.line, lastOpened: now - hoursAgo * HOUR,
      ...seriesOf(p.title),
    };
  });
}

export function seriesRecords(now: number): BookRecord[] {
  const seeds = new Map([...PLACEHOLDERS, ...SERIES_EXTRAS].map((p) => [p.title, p]));
  return SERIES_PREVIEW.flatMap(({ name, books }) =>
    books.map(([title, hoursAgo, progress], j) => {
      const p = seeds.get(title)!;
      return {
        id: `ph-${slug(title)}`, title, author: p.author, format: p.format ?? FORMAT_MIX[(title.length + j) % FORMAT_MIX.length], source: 'placeholder' as const, shared: false,
        addedAt: now - (hoursAgo + 24) * HOUR, words: p.words, color: colorKeyFor(title), progress, line: p.line, lastOpened: now - hoursAgo * HOUR,
        series: name, seriesIndex: SERIES[title]?.[1] ?? j + 1,
      };
    }),
  );
}

export function mixedRecords(now: number): BookRecord[] {
  return MIXED.map((p, j) => ({
    id: `mx-${slug(p.title)}`, title: p.title, author: p.author, format: p.format ?? FORMAT_MIX[j % FORMAT_MIX.length], source: 'placeholder', shared: false,
    addedAt: now - (p.hoursAgo + 24) * HOUR, words: p.words, color: colorKeyFor(p.title), progress: p.progress, line: p.line, lastOpened: now - p.hoursAgo * HOUR,
    ...(p.series ? { series: p.series[0], seriesIndex: p.series[1] } : {}),
  }));
}

/** Drawn covers for the mixed library's books that have one, by id. */
export function mixedCovers(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of MIXED) {
    if (!p.cover) continue;
    const [bg, fg] = p.cover;
    const words = p.title.replace(/,.*$/, '').split(' ');
    const lines = [words.slice(0, 2).join(' '), words.slice(2, 4).join(' '), words.slice(4).join(' ')].filter(Boolean);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="${bg}"/><circle cx="200" cy="230" r="120" fill="${fg}" opacity="0.9"/><circle cx="200" cy="230" r="70" fill="${bg}"/>${lines
      .map((l, i) => `<text x="200" y="${440 + i * 44}" font-family="Georgia, serif" font-size="36" text-anchor="middle" fill="${fg}">${l}</text>`)
      .join('')}</svg>`;
    out[`mx-${slug(p.title)}`] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  return out;
}

/** What other people have put on the shared shelf, for previews. */
export function shelfRecords(now: number): BookRecord[] {
  return PLACEHOLDERS.slice(19, 33).map((p, j) => ({
    id: `shelf-${slug(p.title)}`, title: p.title, author: p.author, format: p.format ?? FORMAT_MIX[(j + 3) % FORMAT_MIX.length], source: 'placeholder', shared: true,
    addedAt: now - (10 + j * j * 14) * HOUR, words: p.words, color: colorKeyFor(p.title), progress: 0, line: p.line, lastOpened: now - (10 + j * j * 14) * HOUR,
    ...seriesOf(p.title),
  }));
}

/** Only a reader's own uploads can go on the Shared Library or come off it; a copy's file is the sharer's. */
export const canShare = (rec: BookRecord) => rec.source === 'file' && !rec.origin;

/** Books other people put on the shared shelf are theirs to take off, not yours. */
export const canRemove = (rec: BookRecord) => rec.source !== 'shelf' && !(rec.shared && rec.source === 'placeholder');

export type PreviewMode = 'live' | 'empty' | 'one' | 'few' | 'many' | 'series' | 'mixed';

export const PREVIEW_MODES: Array<{ id: PreviewMode; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'empty', label: 'Empty' },
  { id: 'one', label: '1 book' },
  { id: 'few', label: '6 books' },
  { id: 'many', label: '50 books' },
  { id: 'series', label: '5 series' },
  { id: 'mixed', label: 'Real mix' },
];
