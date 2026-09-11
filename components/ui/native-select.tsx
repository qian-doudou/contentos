'use client';

import * as React from 'react';
import { Select } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default';
};

type SelectOption = {
  disabled: boolean;
  label: React.ReactNode;
  value: string;
};

function textValue(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return React.Children.toArray(node).map(textValue).join('');
}

function collectOptions(children: React.ReactNode): SelectOption[] {
  const options: SelectOption[] = [];

  function visit(node: React.ReactNode) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;

      if (child.type === React.Fragment || child.type === 'optgroup') {
        visit((child as React.ReactElement<{ children?: React.ReactNode }>).props.children);
        return;
      }

      if (child.type !== 'option') return;

      const props = (child as React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>>).props;
      options.push({
        disabled: Boolean(props.disabled),
        label: props.children,
        value: String(props.value ?? textValue(props.children)),
      });
    });
  }

  visit(children);
  return options;
}

/**
 * Preserves the native-select call-site API, while rendering an accessible
 * popup outside the document flow. The portal keeps form sections from
 * covering the option list and lets every trigger own its height.
 */
function NativeSelect({
  autoComplete,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  children,
  className,
  defaultValue,
  disabled,
  form,
  id,
  name,
  onChange,
  required,
  size = 'default',
  value,
}: NativeSelectProps) {
  const options = React.useMemo(() => collectOptions(children), [children]);
  const values = React.useMemo(
    () => options.map((option) => ({ label: option.label, value: option.value })),
    [options],
  );
  const isControlled = value !== undefined;
  const firstValue = options[0]?.value ?? null;
  const selectedValue = isControlled ? String(value ?? '') : undefined;
  const initialValue = defaultValue === undefined ? firstValue : String(defaultValue ?? '');

  return (
    <Select.Root
      autoComplete={autoComplete}
      defaultValue={isControlled ? undefined : initialValue}
      disabled={disabled}
      form={form}
      id={id}
      items={values}
      name={name}
      onValueChange={(nextValue) => {
        onChange?.({
          currentTarget: { value: nextValue ?? '' },
          target: { value: nextValue ?? '' },
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
      required={required}
      value={selectedValue}
    >
      <Select.Trigger
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        className={cn(
          'border-input text-foreground data-[placeholder]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-transparent py-1 pr-2.5 pl-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 aria-invalid:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:py-0.5',
          className,
        )}
        data-size={size}
        id={id}
      >
        <Select.Value />
        <Select.Icon className="shrink-0 text-[#787774]">
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner
          align="start"
          alignItemWithTrigger={false}
          className="z-[100] w-[var(--anchor-width)]"
          side="bottom"
          sideOffset={6}
        >
          <Select.Popup className="max-h-[min(18rem,var(--available-height))] min-w-44 overflow-y-auto rounded-lg border border-[#e9e9e7] bg-white p-1 shadow-[0_14px_30px_rgba(15,15,15,0.16)] outline-none">
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  className="data-[highlighted]:bg-[#f1f1ef] data-[selected]:bg-[#e7f3f8] flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm leading-5 text-[#37352f] outline-none data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45"
                  disabled={option.disabled}
                  key={option.value}
                  value={option.value}
                >
                  <Select.ItemIndicator className="flex size-4 shrink-0 items-center justify-center text-[#2383e2]">
                    <CheckIcon aria-hidden="true" className="size-3.5" />
                  </Select.ItemIndicator>
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function NativeSelectOption(props: React.ComponentProps<'option'>) {
  return <option {...props} data-slot="native-select-option" />;
}

function NativeSelectOptGroup(props: React.ComponentProps<'optgroup'>) {
  return <optgroup {...props} data-slot="native-select-optgroup" />;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
