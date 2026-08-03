// Make text that came from outside this codebase safe to put in HTML.
//
// One home, because there are two surfaces painting the same generated prose
// now: the game's DATA ON page (ui/screens.ts) and the encyclopaedia. It is
// not hypothetical — a generation run closed both of Tiraor's fields with a
// literal `</br>` (TODO 58), which without this would be markup rather than
// the five characters it is.
//
// The generator refuses angle brackets as well. Neither guard makes the other
// redundant: one is the gate on what may be committed, the other is the render
// boundary declining to trust its input.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
