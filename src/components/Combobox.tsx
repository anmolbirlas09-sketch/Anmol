'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { L } from '@/lib/labels';
import { cx, inputClass } from './ui';

export interface ComboOption {
  value: string;
  label: string;
  /** Second line / right-hand text, e.g. "300.000 kg". */
  detail?: string;
  /** Options are shown grouped under this heading, in first-seen order. */
  group?: string;
  /** Extra text matched by search but not shown. */
  keywords?: string;
}

interface Props {
  id: string;
  name: string;
  options: ComboOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  emptyText?: string;
  /** Allow clearing the selection (for optional fields). */
  clearable?: boolean;
}

/** Searchable dropdown with large touch targets; submits its value via a hidden input. */
export function Combobox({
  id, name, options, value: controlled, defaultValue = '', onChange, placeholder = L.app.select,
  invalid, describedBy, emptyText = L.app.noResults, clearable,
}: Props) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.detail ?? ''} ${o.group ?? ''} ${o.keywords ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    search.current?.focus();
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  function choose(v: string) {
    if (controlled === undefined) setInternal(v);
    onChange?.(v);
    setOpen(false);
    setQuery('');
    document.getElementById(id)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  let lastGroup: string | undefined;

  return (
    <div ref={root} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cx(inputClass, 'flex items-center justify-between gap-2 text-left')}
      >
        <span className={cx('min-w-0 truncate', !selected && 'text-muted')}>
          {selected ? selected.label : placeholder}
          {selected?.detail && <span className="ml-2 text-sm text-muted">{selected.detail}</span>}
        </span>
        <span aria-hidden className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
          <div className="border-b border-line p-2">
            <input
              ref={search}
              type="search"
              role="combobox"
              aria-controls={listId}
              aria-expanded
              aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].value}` : undefined}
              aria-label={L.app.search}
              placeholder={L.app.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              className={cx(inputClass, 'min-h-11')}
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {clearable && value && !query && (
              <li role="option" aria-selected={false} onClick={() => choose('')} className="cursor-pointer px-3 py-3 text-sm text-muted hover:bg-sunken">
                {L.app.none}
              </li>
            )}
            {filtered.length === 0 && <li className="px-3 py-3 text-sm text-muted">{emptyText}</li>}
            {filtered.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <li key={o.value} role="presentation">
                  {header && <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{header}</div>}
                  <div
                    id={`${listId}-${o.value}`}
                    role="option"
                    aria-selected={o.value === value}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={cx(
                      'flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 py-2',
                      i === active && 'bg-sunken',
                      o.value === value && 'font-semibold text-brand',
                    )}
                  >
                    <span className="min-w-0 truncate">{o.label}</span>
                    {o.detail && <span className="tnum shrink-0 text-sm text-muted">{o.detail}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
