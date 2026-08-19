import { useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Gear } from '@phosphor-icons/react/dist/csr/Gear';
import { ListDashes } from '@phosphor-icons/react/dist/csr/ListDashes';
import { Package } from '@phosphor-icons/react/dist/csr/Package';
import { UploadSimple } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { useDirectory } from './context';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/utils';

export function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  );
}

export function SiteHeader() {
  const { setSheet, staged, refreshRegistry } = useDirectory();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);

  function refresh() {
    setRefreshing(true);
    refreshRegistry();
    window.setTimeout(() => setRefreshing(false), 500);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <button
          className="flex items-center gap-3 text-left"
          type="button"
          onClick={() => void navigate({ to: '/' })}
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Package size={20} weight="bold" />
          </span>
          <span>
            <span className="block font-semibold tracking-tight">AI Directory</span>
            <span className="hidden text-xs text-muted-foreground sm:block">
              Reusable development resources
            </span>
          </span>
        </button>
        <nav className="flex items-center gap-1" aria-label="Workspace actions">
          <IconButton label="Refresh registry" onClick={refresh}>
            <ArrowsClockwise className={cn(refreshing && 'animate-spin')} size={18} />
          </IconButton>
          <IconButton label="Installed resources" onClick={() => setSheet('installed')}>
            <ListDashes size={18} />
          </IconButton>
          <Button className="hidden sm:inline-flex" variant="outline" size="sm" onClick={() => setSheet('publish')}>
            <UploadSimple size={16} />
            Publish
          </Button>
          <span className="sm:hidden">
            <IconButton label="Publish resource" onClick={() => setSheet('publish')}>
              <UploadSimple size={18} />
            </IconButton>
          </span>
          <Button
            variant={Object.keys(staged).length > 0 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSheet('changes')}
          >
            <ListDashes size={16} />
            Changes{Object.keys(staged).length > 0 ? ` (${Object.keys(staged).length})` : ''}
          </Button>
          <IconButton label="Settings" onClick={() => setSheet('settings')}>
            <Gear size={18} />
          </IconButton>
        </nav>
      </div>
    </header>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <Alert className="flex items-start gap-3 border-destructive/30 bg-destructive/5 text-destructive">
      <WarningCircle className="mt-0.5 shrink-0" size={19} />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function LoadingCard() {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-3/5" />
      </CardContent>
    </Card>
  );
}

export function SheetFrame({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn('w-full overflow-y-auto sm:max-w-2xl', className)}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

export function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  const id = `select-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="mt-2"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([option, text]) => <SelectItem value={option} key={option}>{text}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
