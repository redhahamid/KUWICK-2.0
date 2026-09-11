import type { ReactNode } from 'react';
import { IconSearch } from './icons';

/** The row above a table: search on the left, filters and views on the right. */
export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="hr-toolbar">
      {children}
      {right ? <div className="hr-toolbar__right">{right}</div> : null}
    </div>
  );
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="hr-search">
      <IconSearch />
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
