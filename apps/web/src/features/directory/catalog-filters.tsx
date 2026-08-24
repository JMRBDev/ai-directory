import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
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
            <InputGroupAddon><MagnifyingGlass /></InputGroupAddon>
            <InputGroupInput id="resource-search" type="search" placeholder={`Search ${RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s`} value={query} onChange={(event) => onQueryChange(event.target.value)} />
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="resource-review">Review status</FieldLabel>
          <Select value={review} onValueChange={(value) => onReviewChange(reviewFilter(value))}>
            <SelectTrigger id="resource-review"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All resources</SelectItem><SelectItem value="reviewed">Reviewed</SelectItem><SelectItem value="unreviewed">Unreviewed</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="resource-installed">Installed</FieldLabel>
          <Select value={installed} onValueChange={(value) => onInstalledChange(installedFilter(value))}>
            <SelectTrigger id="resource-installed"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="installed">Installed</SelectItem><SelectItem value="not-installed">Not installed</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="resource-sort">Sort by</FieldLabel>
          <Select value={sort} onValueChange={(value) => onSortChange(sortOption(value))}>
            <SelectTrigger id="resource-sort"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="updated">Recently updated</SelectItem><SelectItem value="name">Name A-Z</SelectItem><SelectItem value="version">Newest version</SelectItem></SelectContent>
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span role="status">
          {filteredCount === 0 ? 'No resources found' : `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filteredCount)} of ${filteredCount}`}
        </span>
        {hasFilters && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>Clear filters</Button>}
      </div>
    </div>
  );
}
