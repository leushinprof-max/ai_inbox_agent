"use client";

import "./filters.css";
import { useState } from "react";
import { FilterFieldLabel, FilterSelect } from "./filter-select";
import { FilterDateRange } from "./filter-date-range";
import { Button } from "@/components/ui";
import type { LabelDefinition } from "@/domain/labels";
import {
  conversationFilters,
  calendarDate,
  filterFields,
  type ConversationFilter,
  type FilterField,
} from "@/domain/conversation-filters";

const colors: Record<string, string> = {
  green: "#34d399",
  blue: "#6aa6ff",
  purple: "#a79bff",
  teal: "#5bd6c2",
  amber: "#fbbf24",
  pink: "#ef9fce",
  red: "#f87171",
  gray: "#9a9aa6",
};
const options = {
  first_reply: [
    { id: "today", name: "Today" },
    { id: "this_week", name: "This week" },
    { id: "this_month", name: "This month" },
    { id: "custom", name: "Custom dates" },
  ],
  intent: [
    { id: "positive", name: "Positive", color: colors.green },
    { id: "neutral", name: "Neutral", color: colors.gray },
    { id: "negative", name: "Negative", color: colors.red },
  ],
  activity: [
    { id: "1", name: "Last 24 hours" },
    { id: "7", name: "Last 7 days" },
    { id: "30", name: "Last 30 days" },
    { id: "90", name: "Last 90 days" },
  ],
  sender: [
    { id: "inbound", name: "Contact" },
    { id: "outbound", name: "Our team" },
  ],
  read: [
    { id: "unread", name: "Unread" },
    { id: "read", name: "Read" },
  ],
};
function newFilter(field: FilterField): ConversationFilter {
  return {
    field,
    operator: "is",
    values: field === "labels" ? [] : [options[field][0].id],
  };
}
export function PinIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3h8l-1 6 3 4v2H6v-2l3-4-1-6ZM12 15v6" />
    </svg>
  );
}
export function FilterBuilder({
  applied,
  catalog,
  onApply,
  onPin,
  canPin,
  timezone = "UTC",
}: {
  applied: ConversationFilter[];
  catalog: LabelDefinition[];
  onApply: (filters: ConversationFilter[]) => void;
  onPin: (name: string, filters: ConversationFilter[]) => boolean;
  canPin: boolean;
  timezone?: string;
}) {
  const [rows, setRows] = useState(() =>
    applied.length ? applied : [newFilter("labels")],
  );
  const [menu, setMenu] = useState<string | null>(null);
  const [today] = useState(() => calendarDate(Date.now(), timezone));
  const [pinning, setPinning] = useState(false);
  const [name, setName] = useState("");
  const valid = conversationFilters.safeParse(rows);
  const labels = [
    ...catalog,
    { id: "uncategorized", name: "Unable to categorize", color: "gray" },
  ];
  function update(index: number, next: ConversationFilter) {
    setRows(rows.map((row, i) => (i === index ? next : row)));
  }
  return (
    <div
      className="conversation-filters"
      id="conversation-filters"
      role="region"
      aria-label="Conversation filters"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu !== null) {
          event.stopPropagation();
          setMenu(null);
        }
      }}
    >
      <div className="filter-heading">
        <strong>Filters</strong>
        {rows.length > 1 ? <span>Match all conditions</span> : null}
      </div>
      <div className="filter-conditions">
        {rows.map((row, index) => (
          <div className="filter-condition" key={index}>
            <FilterFieldLabel field={row.field} />
            <FilterSelect
              id={`${index}-operator`}
              label={`Filter ${index + 1} operator`}
              options={[
                {
                  id: "is",
                  name:
                    row.field === "labels"
                      ? "has any of"
                      : row.field === "activity" || row.field === "first_reply"
                        ? "within"
                        : "is",
                },
                {
                  id: "is_not",
                  name:
                    row.field === "labels"
                      ? "has none of"
                      : row.field === "first_reply"
                        ? "outside"
                        : row.field === "activity"
                          ? "older than"
                          : "is not",
                },
              ]}
              values={[row.operator]}
              open={menu}
              setOpen={setMenu}
              onChange={([value]) =>
                update(index, {
                  ...row,
                  operator: value as ConversationFilter["operator"],
                })
              }
            />
            {row.field === "labels" ? (
              <FilterSelect
                id={`${index}-labels`}
                label={`Filter ${index + 1} labels`}
                multiple
                options={labels.map((label) => ({
                  ...label,
                  color: colors[label.color],
                }))}
                values={row.values}
                open={menu}
                setOpen={setMenu}
                placeholder="Select labels…"
                onChange={(values) => update(index, { ...row, values })}
              />
            ) : row.field === "first_reply" ? (
              <div className="filter-date-period">
                <FilterSelect
                  id={`${index}-value`}
                  label={`Filter ${index + 1} first reply period`}
                  options={options.first_reply}
                  fallbackName={`Last ${row.values[0]} days`}
                  values={[row.values[0]]}
                  open={menu}
                  setOpen={setMenu}
                  onChange={([period]) =>
                    update(index, {
                      ...row,
                      values:
                        period === "custom"
                          ? [
                              period,
                              calendarDate(
                                Date.now(),
                                row.timezone ?? timezone,
                              ),
                              calendarDate(
                                Date.now(),
                                row.timezone ?? timezone,
                              ),
                            ]
                          : [period],
                    })
                  }
                />
              </div>
            ) : (
              <FilterSelect
                id={`${index}-value`}
                label={`Filter ${index + 1} value`}
                options={options[row.field]}
                values={row.values}
                open={menu}
                setOpen={setMenu}
                onChange={(values) => update(index, { ...row, values })}
              />
            )}
            <button
              className="filter-remove"
              aria-label={`Remove filter ${index + 1}`}
              onClick={() => {
                setRows(rows.filter((_, i) => i !== index));
                setMenu(null);
              }}
            >
              ×
            </button>
            {row.field === "first_reply" && row.values[0] === "custom" ? (
              <FilterDateRange
                start={row.values[1]}
                end={row.values[2]}
                today={today}
                onChange={(start, end) =>
                  update(index, { ...row, values: ["custom", start, end] })
                }
              />
            ) : null}
          </div>
        ))}
      </div>
      <FilterSelect
        id="add"
        label="Add filter"
        add
        options={Object.entries(filterFields).map(([id, name]) => ({
          id,
          name,
          icon: id as FilterField,
        }))}
        values={[]}
        open={menu}
        setOpen={setMenu}
        disabled={rows.length >= 10}
        onChange={([field]) =>
          setRows([
            ...rows,
            {
              ...newFilter(field as FilterField),
              ...(field === "first_reply" ? { timezone } : {}),
            },
          ])
        }
      />
      {pinning ? (
        <form
          className="filter-pin-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid.success && name.trim() && onPin(name.trim(), valid.data))
              onApply(valid.data);
          }}
        >
          <label htmlFor="filter-view-name">View name</label>
          <input
            id="filter-view-name"
            autoFocus
            maxLength={60}
            placeholder="e.g. Interested this week"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            variant="small"
            type="button"
            onClick={() => setPinning(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary small"
            type="submit"
            disabled={!name.trim() || !valid.success || !rows.length}
          >
            Save view
          </Button>
        </form>
      ) : null}
      <footer className="filter-footer">
        <button
          className="filter-clear"
          onClick={() => {
            setRows([]);
            setMenu(null);
            setPinning(false);
          }}
        >
          Clear all
        </button>
        <div className="filter-footer-actions">
          <button
            className="filter-pin"
            disabled={!valid.success || !rows.length || !canPin}
            onClick={() => {
              setPinning(!pinning);
              setMenu(null);
            }}
          >
            <PinIcon />
            Pin view
          </button>
          <Button
            variant="primary small"
            disabled={!valid.success}
            onClick={() => {
              if (valid.success) onApply(valid.data);
            }}
          >
            Apply filters
          </Button>
        </div>
      </footer>
    </div>
  );
}
