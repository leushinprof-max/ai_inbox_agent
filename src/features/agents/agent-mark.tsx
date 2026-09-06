export function AgentMark({ name }: { name: string }) {
  const hue =
    [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6;
  return (
    <span aria-hidden="true" className={`agent-mark agent-hue-${hue}`}>
      {name.trim().charAt(0).toUpperCase() || "U"}
    </span>
  );
}
