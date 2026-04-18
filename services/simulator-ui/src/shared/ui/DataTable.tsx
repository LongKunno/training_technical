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
  emptyTitle: string;
  emptyDescription: string;
  className?: string;
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
  rows,
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
    <div className={cx("table-scroll overflow-auto", className)}>
      <table className="min-w-full border-separate border-spacing-0">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cx(
                  "sticky top-0 z-[1] border-b border-white/8 bg-[var(--bg-panel-strong)] px-4 py-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 backdrop-blur",
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
            <tr key={getRowId(row)} className="group">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    "border-b border-white/6 px-4 py-4 text-sm text-slate-200 transition group-hover:bg-white/[0.02]",
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
