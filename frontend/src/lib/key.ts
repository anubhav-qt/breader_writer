/** Keys are made and checked by the shared package, so the server reads them the same way. */
export { newLibraryKey, normalizeKey } from '@breader/shared/key';

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'b' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
