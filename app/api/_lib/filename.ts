// Private helper (underscore-prefixed folder — excluded from routing).
// Shared by the export route (download filename) and the open-in-Studio route
// (the on-disk .rbxl name Studio shows in its title bar).

/** Strips everything but safe filename characters; never empty. */
export function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  return cleaned || 'project'
}
