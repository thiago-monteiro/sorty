import type { VoiceCommand } from "../domain/types";

export function parseCommand(input: string): VoiceCommand {
  const text = input
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(stop|pause|wait|hold on|break|tired|overwhelmed)\b/.test(text))
    return "pause";
  if (/\b(help|assistance|someone else)\b/.test(text)) return "help";
  if (
    /\b(cant move|cannot move|too heavy|cant lift|cannot lift|stuck object)\b/.test(
      text,
    )
  )
    return "immovable";
  if (
    /\b(taken|blocked|occupied|no room|wont fit|doesnt fit|cant reach)\b/.test(
      text,
    )
  )
    return "blocked";
  if (/\b(remeasure|re measure|measure again|verify clearance)\b/.test(text))
    return "remeasure";
  if (/\b(check|look|inspect|photo|picture)\b/.test(text)) return "check";
  if (/\b(repeat|again|say that|what was that)\b/.test(text)) return "repeat";
  if (/\b(back|previous)\b/.test(text)) return "back";
  if (/\b(resume|continue|ready|lets go)\b/.test(text)) return "resume";
  if (/\b(next|done|finished|complete|moved it)\b/.test(text)) return "next";
  return "unknown";
}
