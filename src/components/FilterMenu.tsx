import React, { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export type FilterGroup = {
  key: string;
  label: string;
  icon: React.ReactNode;
  options: string[];
  selected: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  getSwatch?: (option: string) => string | undefined;
};

const SEARCH_THRESHOLD = 12;

/** Lives inside the submenu, so the search text resets whenever the submenu closes. */
function FilterOptions({ group }: { group: FilterGroup }) {
  const [query, setQuery] = useState('');
  const { label, options, selected, onChange, getSwatch } = group;
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((option) => option.toLowerCase().includes(needle)) : options;
  return (
    <>
      {options.length > SEARCH_THRESHOLD && (
        <label className="color-search">
          <Search size={14} />
          <Input
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${label.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
      )}
      <div className="filter-menu-options">
        {shown.length === 0 && <div className="menu-empty">No matches</div>}
        {shown.map((option) => {
          const swatch = getSwatch?.(option);
          return (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selected.includes(option)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() =>
                onChange((current) => (current.includes(option) ? current.filter((x) => x !== option) : [...current, option]))
              }
            >
              {swatch && <span className="color-swatch mr-2" style={{ background: swatch }} aria-hidden="true" />}
              <span>{option}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </div>
      {selected.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onChange([]);
            }}
          >
            Clear {label.toLowerCase()}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

function FilterSub({ group }: { group: FilterGroup }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="filter-menu-trigger">
        {group.icon}
        <span>{group.label}</span>
        {group.selected.length > 0 && <span className="filter-menu-count">{group.selected.length}</span>}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="filter-menu-sub" sideOffset={6} collisionPadding={12}>
          <FilterOptions group={group} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export function FilterMenu({ groups, activeCount, onClearAll, compact = false, className }: { groups: FilterGroup[]; activeCount: number; onClearAll: () => void; compact?: boolean; className?: string }) {
  const label = `Filters${activeCount ? ` (${activeCount})` : ''}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            className={`filter-trigger-compact${activeCount ? ' active' : ''}${className ? ` ${className}` : ''}`}
            aria-label={label}
            title={label}
          >
            <SlidersHorizontal size={14} />
            {activeCount > 0 && <span className="filter-trigger-badge" aria-hidden="true">{activeCount}</span>}
          </Button>
        ) : (
          <Button variant={activeCount ? 'secondary' : 'outline'} size="sm" className={activeCount ? 'filter-trigger active' : 'filter-trigger'}>
            <SlidersHorizontal size={15} />
            <span>{label}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} className="filter-menu" aria-label="Filters">
        {groups.map((group) => (
          <FilterSub key={group.key} group={group} />
        ))}
        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClearAll}>Clear all filters</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}