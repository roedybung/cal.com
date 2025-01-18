"use client";

import type { Row } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import type { Table as ReactTableType } from "@tanstack/react-table";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
// eslint-disable-next-line no-restricted-imports
import kebabCase from "lodash/kebabCase";
import { usePathname } from "next/navigation";
import { useEffect, memo } from "react";

import classNames from "@calcom/lib/classNames";
import { Icon, TableNew, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@calcom/ui";

import { useColumnSizingVars } from "../hooks";
import { usePersistentColumnResizing } from "../lib/resizing";

export type DataTableProps<TData, TValue> = {
  table: ReactTableType<TData>;
  tableContainerRef: React.RefObject<HTMLDivElement>;
  isPending?: boolean;
  onRowMouseclick?: (row: Row<TData>) => void;
  onScroll?: (e: Pick<React.UIEvent<HTMLDivElement, UIEvent>, "target">) => void;
  tableOverlay?: React.ReactNode;
  variant?: "default" | "compact";
  testId?: string;
  bodyTestId?: string;
  hideHeader?: boolean;
  children?: React.ReactNode;
  identifier?: string;
  enableColumnResizing?: boolean;
  className?: string;
  containerClassName?: string;
};

export function DataTable<TData, TValue>({
  table,
  tableContainerRef,
  isPending,
  variant,
  onRowMouseclick,
  onScroll,
  children,
  hideHeader,
  identifier: _identifier,
  enableColumnResizing,
  testId,
  bodyTestId,
  className,
  containerClassName,
  ...rest
}: DataTableProps<TData, TValue> & React.ComponentPropsWithoutRef<"div">) {
  const pathname = usePathname() as string | null;
  const identifier = _identifier ?? pathname ?? undefined;

  const { rows } = table.getRowModel();

  // https://stackblitz.com/github/tanstack/table/tree/main/examples/react/virtualized-infinite-scrolling
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 100,
    getScrollElement: () => tableContainerRef.current,
    // measure dynamic row height, except in firefox because it measures table border height incorrectly
    measureElement:
      typeof window !== "undefined" && navigator.userAgent.indexOf("Firefox") === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 10,
  });

  useEffect(() => {
    if (rowVirtualizer.getVirtualItems().length >= rows.length && tableContainerRef.current) {
      const target = tableContainerRef.current;
      // Right after the last row is rendered, tableContainer's scrollHeight is
      // temporarily larger than the actual height of the table, so we need to
      // wait for a short time before calling onScroll to ensure the scrollHeight
      // is correct.
      setTimeout(() => {
        onScroll?.({ target });
      }, 100);
    }
  }, [rowVirtualizer.getVirtualItems().length, rows.length, tableContainerRef.current]);

  const columnSizingVars = useColumnSizingVars({ table });

  usePersistentColumnResizing({
    enabled: Boolean(enableColumnResizing && identifier),
    table,
    tableContainerRef,
    identifier,
  });

  return (
    <div
      className={classNames("grid", className)}
      style={{
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: "'header' 'body' 'footer'",
        ...rest.style,
      }}
      data-testid={testId ?? "data-table"}>
      <div
        ref={tableContainerRef}
        onScroll={onScroll}
        className={classNames(
          "relative h-[80dvh] overflow-auto", // Set a fixed height for the container
          "scrollbar-thin border-subtle relative rounded-md border",
          containerClassName
        )}
        style={{ gridArea: "body" }}>
        <TableNew
          className="grid border-0"
          style={{
            ...columnSizingVars,
            ...(Boolean(enableColumnResizing) && { width: table.getTotalSize() }),
          }}>
          {!hideHeader && (
            <TableHeader className="sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-subtle flex w-full">
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    return (
                      <TableHead
                        key={header.id}
                        style={{
                          ...(meta?.sticky?.position === "left" && { left: `${meta.sticky.gap || 0}px` }),
                          ...(meta?.sticky?.position === "right" && { right: `${meta.sticky.gap || 0}px` }),
                          width: `var(--header-${kebabCase(header?.id)}-size)`,
                        }}
                        className={classNames(
                          "relative flex shrink-0 items-center",
                          header.column.getCanSort()
                            ? "bg-subtle hover:bg-muted cursor-pointer select-none"
                            : "",
                          meta?.sticky && "top-0 z-20 sm:sticky"
                        )}>
                        <div
                          className="flex h-full w-full items-center overflow-hidden"
                          onClick={header.column.getToggleSortingHandler()}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() && (
                            <Icon
                              name="arrow-up"
                              className="ml-2 h-4 w-4"
                              style={{
                                transform:
                                  header.column.getIsSorted() === "asc" ? "rotate(0deg)" : "rotate(180deg)",
                                transition: "transform 0.2s ease-in-out",
                              }}
                            />
                          )}
                        </div>
                        {Boolean(enableColumnResizing) && header.column.getCanResize() && (
                          <div
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className={classNames(
                              "bg-inverted absolute right-0 top-0 h-full w-[5px] cursor-col-resize touch-none select-none opacity-0 hover:opacity-50",
                              header.column.getIsResizing() && "!opacity-75"
                            )}
                          />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
          )}
          {/* When resizing any column we will render this special memoized version of our table body */}
          {table.getState().columnSizingInfo.isResizingColumn ? (
            <MemoizedTableBody
              table={table}
              rowVirtualizer={rowVirtualizer}
              rows={rows}
              testId={bodyTestId}
              variant={variant}
              isPending={isPending}
              onRowMouseclick={onRowMouseclick}
            />
          ) : (
            <DataTableBody
              table={table}
              rowVirtualizer={rowVirtualizer}
              rows={rows}
              testId={bodyTestId}
              variant={variant}
              isPending={isPending}
              onRowMouseclick={onRowMouseclick}
            />
          )}
        </TableNew>
      </div>
      {children}
    </div>
  );
}

const MemoizedTableBody = memo(
  DataTableBody,
  (prev, next) =>
    prev.table.options.data === next.table.options.data &&
    prev.rowVirtualizer === next.rowVirtualizer &&
    prev.rows === next.rows &&
    prev.testId === next.testId &&
    prev.variant === next.variant &&
    prev.isPending === next.isPending &&
    prev.onRowMouseclick === next.onRowMouseclick
) as typeof DataTableBody;

type DataTableBodyProps<TData> = {
  table: ReactTableType<TData>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  rows: Row<TData>[];
  testId?: string;
  variant?: "default" | "compact";
  isPending?: boolean;
  onRowMouseclick?: (row: Row<TData>) => void;
};

function DataTableBody<TData>({
  table,
  rowVirtualizer,
  rows,
  testId,
  variant,
  isPending,
  onRowMouseclick,
}: DataTableBodyProps<TData>) {
  const virtualRows = rowVirtualizer.getVirtualItems();
  return (
    <TableBody
      className="relative grid"
      data-testid={testId}
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
      {virtualRows && !isPending ? (
        virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index] as Row<TData>;
          return (
            <TableRow
              ref={(node) => rowVirtualizer.measureElement(node)} //measure dynamic row height
              key={row.id}
              data-index={virtualRow.index} //needed for dynamic row height measurement
              data-state={row.getIsSelected() && "selected"}
              onClick={() => onRowMouseclick && onRowMouseclick(row)}
              style={{
                display: "flex",
                position: "absolute",
                transform: `translateY(${virtualRow.start}px)`, //this should always be a `style` as it changes on scroll
                width: "100%",
              }}
              className={classNames(onRowMouseclick && "hover:cursor-pointer", "group")}>
              {row.getVisibleCells().map((cell) => {
                const column = table.getColumn(cell.column.id);
                const meta = column?.columnDef.meta;
                return (
                  <TableCell
                    key={cell.id}
                    style={{
                      ...(meta?.sticky?.position === "left" && { left: `${meta.sticky.gap || 0}px` }),
                      ...(meta?.sticky?.position === "right" && { right: `${meta.sticky.gap || 0}px` }),
                      width: `var(--col-${kebabCase(cell.column.id)}-size)`,
                    }}
                    className={classNames(
                      "flex shrink-0 items-center overflow-hidden",
                      variant === "compact" && "p-0",
                      meta?.sticky &&
                        "bg-default group-hover:!bg-muted group-data-[state=selected]:bg-subtle sm:sticky"
                    )}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })
      ) : (
        <TableRow>
          <TableCell colSpan={table.getAllColumns().length} className="h-24 text-center">
            No results.
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}
