/*
 * Phones paint their status bar (and Android its toolbar) in the page's theme-color, so the bar reads
 * as part of the page. index.html gives the library's white and black; an open book paints its own.
 */
export function paintBars(color: string) {
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const was = metas.map((m) => m.content);
  metas.forEach((m) => { m.content = color; });
  return () => metas.forEach((m, i) => { m.content = was[i]; });
}
