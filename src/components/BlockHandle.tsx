export interface BlockHandleProps {
  /** Screen-space anchor in the gutter beside the hovered block, relative to the editor shell. */
  top: number
  left: number
  onOpen: () => void
}

/** Pencil shown in the left gutter of the hovered block; clicking it opens the block's toolbar. */
export function BlockHandle({ top, left, onOpen }: BlockHandleProps) {
  return (
    <button
      type="button"
      className="block-handle"
      style={{ top, left }}
      title="AI actions for this paragraph"
      aria-label="AI actions for this paragraph"
      // Keep the editor's selection: a selection inside the block narrows the action.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M11.2 2.3a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1L6 12.5l-3 .7.7-3 7.5-7.9Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
