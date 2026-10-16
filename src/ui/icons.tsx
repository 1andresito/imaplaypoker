import type { ReactNode } from "react";

// Line icons drawn for the game (24×24, stroke = currentColor), used instead of
// emoji so they match the type, scale with text, and look the same on every OS.

const PATHS = {
  cards: (
    <>
      <rect x="3.5" y="5" width="11" height="15" rx="1.8" transform="rotate(-10 9 12.5)" />
      <rect x="9.5" y="4" width="11" height="15" rx="1.8" transform="rotate(8 15 11.5)" />
      <path d="M15.3 9.2c-.9-1.2-2.8-.4-2.4 1 .3 1 2.2 2.3 2.2 2.3s2.2-.8 2.6-1.8c.5-1.4-1.4-2.5-2.4-1.5" />
    </>
  ),
  hint: (
    <>
      <path d="M9 17.5h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
    </>
  ),
  coach: (
    <>
      <path d="M2.5 9 12 4.5 21.5 9 12 13.5Z" />
      <path d="M6.5 11v4.6c1.5 1.5 3.4 2.2 5.5 2.2s4-.7 5.5-2.2V11M21.5 9v5.5" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1Z" />
    </>
  ),
  soundOn: (
    <>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4Z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  soundOff: (
    <>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4Z" />
      <path d="m16 9.5 5 5m0-5-5 5" />
    </>
  ),
  music: (
    <>
      <path d="M9 17.5V6l10-2v11.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  door: (
    <>
      <path d="M14 4H6.5v16H14" />
      <path d="M11 12h9.5M17.5 8.5 21 12l-3.5 3.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </>
  ),
  back: <path d="M15 5 8 12l7 7" />,
  play: <path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" />,
  trophy: (
    <>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0Z" />
      <path d="M7.5 6H4.5c0 3 1.3 4.5 3.3 4.7M16.5 6h3c0 3-1.3 4.5-3.3 4.7M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5Z" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  spade: (
    <path
      d="M12 3.5C9.5 7 5 9.3 5 13a3.6 3.6 0 0 0 6.2 2.5c-.3 2-1.1 3.5-2.4 5h6.4c-1.3-1.5-2.1-3-2.4-5A3.6 3.6 0 0 0 19 13c0-3.7-4.5-6-7-9.5Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  chart: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = "1.15em", className }: { name: IconName; size?: string; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
