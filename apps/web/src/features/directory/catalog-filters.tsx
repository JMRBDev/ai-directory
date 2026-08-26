import { RESOURCE_TYPE_LABELS, type ResourceType } from '../../lib/types';
import { Button } from '../../components/ui/button';
import { Field, FieldLabel } from '../../components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
  installedFilter,
  reviewFilter,
  sortOption,
  type InstalledFilter,
  type ReviewFilter,
  type SortOption,
} from './model';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';

const reviewOptions = [
  { value: 'all', label: 'All resources' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'unreviewed', label: 'Unreviewed' },
] as const;

const installedOptions = [
  { value: 'all', label: 'All' },
  { value: 'installed', label: 'Installed' },
  { value: 'not-installed', label: 'Not installed' },
] as const;

const sortOptions = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name A-Z' },
  { value: 'version', label: 'Newest version' },
] as const;

function selectedLabel<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function CatalogFilters({
  activeType,
  query,
  review,
  installed,
  sort,
  filteredCount,
  currentPage,
  pageSize,
  onQueryChange,
  onReviewChange,
  onInstalledChange,
  onSortChange,
  onClear,
}: {
  activeType: ResourceType;
  query: string;
  review: ReviewFilter;
  installed: InstalledFilter;
  sort: SortOption;
  filteredCount: number;
  currentPage: number;
  pageSize: number;
  onQueryChange: (value: string) => void;
  onReviewChange: (value: ReviewFilter) => void;
  onInstalledChange: (value: InstalledFilter) => void;
  onSortChange: (value: SortOption) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(query || review !== 'all' || installed !== 'all' || sort !== 'updated');

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_11rem]">
        <Field>
          <FieldLabel htmlFor="resource-search">Search</FieldLabel>
          <InputGroup>
            <InputGroupAddon><HugeiconsIcon icon={Search01Icon} /></InputGroupAddon>
            <InputGroupInput id="resource-search" type="search" placeholder={`Search ${RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s`} value={query} onChange={(event) => onQueryChange(event.target.value)} />
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="resource-review">Review status</FieldLabel>
          <Select value={review} onValueChange={(value) => { if (value !== null) onReviewChange(reviewFilter(value)); }}>
            <SelectTrigger id="resource-review"><SelectValue>{selectedLabel(reviewOptions, review)}</SelectValue></SelectTrigger>
            <SelectContent>{reviewOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="resource-installed">Installed</FieldLabel>
          <Select value={installed} onValueChange={(value) => { if (value !== null) onInstalledChange(installedFilter(value)); }}>
            <SelectTrigger id="resource-installed"><SelectValue>{selectedLabel(installedOptions, installed)}</SelectValue></SelectTrigger>
            <SelectContent>{installedOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="resource-sort">Sort by</FieldLabel>
          <Select value={sort} onValueChange={(value) => { if (value !== null) onSortChange(sortOption(value)); }}>
            <SelectTrigger id="resource-sort"><SelectValue>{selectedLabel(sortOptions, sort)}</SelectValue></SelectTrigger>
            <SelectContent>{sortOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span role="status">
          {filteredCount === 0 ? 'No resources found' : `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filteredCount)} of ${filteredCount}`}
        </span>
        {hasFilters && <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button>}
      </div>
    </div>
  );
}
