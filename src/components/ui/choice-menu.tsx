import { ChevronDown } from 'lucide-react';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './dropdown-menu';

export function ChoiceMenu({ id, label, value, options, onChange }: {
  id?: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button id={id} type="button" variant="outline" className="choice-menu" aria-label={label}>
          <span>{options.find(option => option.value === value)?.label || label}</span><ChevronDown size={14}/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
