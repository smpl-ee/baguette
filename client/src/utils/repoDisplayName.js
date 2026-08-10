/** Display name for a repo full_name:
 *  - GitHub "owner/repo"    → "repo"
 *  - local path "/a/b/name" → "name"
 *  - local name "my-proj"   → "my-proj"
 */
export function repoDisplayName(fullName) {
  if (!fullName) return '';
  if (fullName.startsWith('/')) return fullName.split('/').filter(Boolean).pop() || fullName;
  if (fullName.includes('/')) return fullName.split('/')[1];
  return fullName;
}

/** True for repos not hosted on GitHub (brand-new or imported from local path). */
export function isLocalRepo(fullName) {
  return !fullName || fullName.startsWith('/') || !fullName.includes('/');
}
