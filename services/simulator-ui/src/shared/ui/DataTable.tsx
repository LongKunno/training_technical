import type { ReactNode } from "react";

import { EmptyState } from "./EmptyState";
import { cx } from "./cx";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}

export interface DataTableProps<Row> {
  caption?: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  getRowClassName?: (row: Row) => string | undefined;
  emptyTitle: string;
  emptyDescription: string;
  className?: string;
  density?: "default" | "dense";
  minWidth?: string;
}

const alignMap = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function DataTable<Row>({
  caption,
  className,
  columns,
  emptyDescription,
  emptyTitle,
  getRowId,
  getRowClassName,
  minWidth = "720px",
  rows,
  density = "dense",
}: DataTableProps<Row>) {
  if (!rows.length) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        eyebrow={caption}
        className={className}
      />
    );
  }

  return (
    <div className={cx("table-scroll w-full max-w-full overflow-x-auto", className)}>
      <table
        className="w-full border-separate border-spacing-0"
        style={{ minWidth }}
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cx(
                  "sticky top-0 z-[1] whitespace-nowrap border-b border-white/8 bg-[var(--bg-panel-strong)] text-xs font-medium uppercase tracking-[0.16em] text-slate-500",
                  density === "dense" ? "px-4 py-2.5" : "px-4 py-3",
                  alignMap[column.align ?? "left"],
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowId(row)}
              className={cx("group", getRowClassName?.(row))}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    "break-words border-b border-white/6 align-top text-sm text-slate-200 transition group-hover:bg-white/[0.03]",
                    density === "dense" ? "px-4 py-3.5" : "px-4 py-4",
                    alignMap[column.align ?? "left"],
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
