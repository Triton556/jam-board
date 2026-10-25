export function BrainGlyph({ size = 20 }: { size?: 16 | 20 | 24 | 48 }) {
  const small = size === 16;
  const left = small ? [9, 10.5] : size === 20 ? [9.6, 10.8] : [9.4, 10.4];
  const right = small ? [15, 13.5] : size === 20 ? [14.4, 13.2] : [14.6, 13.4];
  const midline = small
    ? "M12 5V7.5L9 10.5L15 13.5L12 16.5V19.2"
    : size === 20
      ? "M12 5V7.2L9.6 10.8L14.4 13.2L12 16.8V19.2"
      : "M12 5V7.6L9.4 10.4L14.6 13.4L12 16.4V19.2";
  return (
    <svg
      className="brain-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 5C11.4 3.4 8.6 3.1 7.6 4.9C5.6 4.8 4 6.8 4.6 9.2C3 10.4 3 13.2 4.2 14.4C3.6 16.6 5.4 18.8 7.4 18.9C8.6 20.4 11.2 20.4 12 19.2M12 5C12.6 3.4 15.4 3.1 16.4 4.9C18.4 4.8 20 6.8 19.4 9.2C21 10.4 21 13.2 19.8 14.4C20.4 16.6 18.6 18.8 16.6 18.9C15.4 20.4 12.8 20.4 12 19.2" />
      <path d={midline} />
      <g fill="currentColor" stroke="none">
        <circle cx={left[0]} cy={left[1]} r={size < 24 ? 1.4 : 1.6} />
        <circle cx={right[0]} cy={right[1]} r={size < 24 ? 1.4 : 1.6} />
      </g>
    </svg>
  );
}
