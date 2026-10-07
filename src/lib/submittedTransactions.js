const sent = new Map();
export function rememberTransaction(id, hash) {
  sent.set(id, hash);
  try { window.localStorage.setItem(`cryptoline-submitted-${id}`, hash); } catch {}
}
export function getSubmittedTransaction(id) {
  try { return sent.get(id) || window.localStorage.getItem(`cryptoline-submitted-${id}`); } catch { return sent.get(id); }
}
