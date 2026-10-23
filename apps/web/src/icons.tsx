import type { JSX } from "solid-js";
export function Icon(props: {
    name:
        | "essay"
        | "structure"
        | "practice"
        | "library"
        | "progress"
        | "arrow"
        | "upload"
        | "undo"
        | "redo"
        | "check"
        | "close"
        | "download"
        | "plus"
        | "shield"
        | "chevron";
    size?: number;
}): JSX.Element {
    const paths = {
        essay: "M5 3h10l4 4v14H5V3Zm10 0v5h4M9 12h6M9 16h6",
        structure: "M4 5h16M12 5v6M5 19v-8h14v8M2 19h6M16 19h6",
        practice: "m13 2-9 12h7l-1 8 10-13h-7l1-7Z",
        library: "M4 4h5v16H4V4Zm5 2h5v14H9M15 5l4-1 4 15-4 1-4-15Z",
        progress: "M4 3v17h17M8 16v-4M13 16V8M18 16V5",
        arrow: "M4 12h16m-6-6 6 6-6 6",
        upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
        undo: "M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12",
        redo: "m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12",
        check: "m5 12 4 4L19 6",
        close: "m6 6 12 12M6 18 18 6",
        download: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
        plus: "M12 4v16M4 12h16",
        shield: "m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6",
        chevron: "m9 5 7 7-7 7",
    };
    return (
        <svg
            width={props.size ?? 20}
            height={props.size ?? 20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d={paths[props.name]} />
        </svg>
    );
}
