/** Relativize an absolute workspace path against its cwd. */
export function relativize(path: string, cwd: string): string {
  if (cwd.length === 0) return path
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  if (path.startsWith(prefix)) return path.slice(prefix.length)
  if (path === cwd) return ''
  return path
}
