import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function createIcon(path: ReactNode) {
  return function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {path}
      </svg>
    );
  };
}

export const DashboardIcon = createIcon(
  <>
    <path d="M4 13.5h7V20H4z" />
    <path d="M13 4h7v6.5h-7z" />
    <path d="M13 13.5h7V20h-7z" />
    <path d="M4 4h7v7.5H4z" />
  </>,
);

export const SessionsIcon = createIcon(
  <>
    <path d="M5 6.5h14" />
    <path d="M5 12h14" />
    <path d="M5 17.5h14" />
    <path d="M4 6.5h.01" />
    <path d="M4 12h.01" />
    <path d="M4 17.5h.01" />
  </>,
);

export const RunsIcon = createIcon(
  <>
    <path d="M4 18V6" />
    <path d="M4 18h16" />
    <path d="m7 14 3-4 3 2 4-5" />
    <path d="M15 7h2v2" />
  </>,
);

export const LabIcon = createIcon(
  <>
    <path d="M10 3v5l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V3" />
    <path d="M8.5 12h7" />
    <path d="M7.5 16h9" />
  </>,
);

export const SearchIcon = createIcon(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </>,
);

export const InfoIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 10.5v5" />
    <path d="M12 7.5h.01" />
  </>,
);

export const ChevronDownIcon = createIcon(
  <>
    <path d="m6 9 6 6 6-6" />
  </>,
);

export const CloseIcon = createIcon(
  <>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </>,
);

export const ArrowRightIcon = createIcon(
  <>
    <path d="M5 12h14" />
    <path d="m13 5 7 7-7 7" />
  </>,
);

export const ArrowUpRightIcon = createIcon(
  <>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </>,
);

export const PulseIcon = createIcon(
  <>
    <path d="M3 12h4l2.5-5 5 10 2.5-5H21" />
  </>,
);

export const ShieldIcon = createIcon(
  <>
    <path d="M12 3 5 6v5c0 5 3 8.5 7 10 4-1.5 7-5 7-10V6z" />
    <path d="m9.5 12 1.8 1.8 3.7-4.1" />
  </>,
);

export const ClockIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);

export const SparklineIcon = createIcon(
  <>
    <path d="M4 16.5 9 11l3 3 7-8" />
    <path d="M4 4v16h16" />
  </>,
);

export const DatabaseIcon = createIcon(
  <>
    <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
    <path d="M5 5.5v7c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-7" />
    <path d="M5 12.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    <path d="M5 9c0 1.4 3.1 2.5 7 2.5S19 10.4 19 9" />
  </>,
);

export const DownloadIcon = createIcon(
  <>
    <path d="M12 4v10" />
    <path d="m8 10 4 4 4-4" />
    <path d="M5 18h14" />
  </>,
);
