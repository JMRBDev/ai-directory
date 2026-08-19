import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return <Sonner closeButton position="bottom-right" toastOptions={{ classNames: { toast: 'border-border bg-background text-foreground', description: 'text-muted-foreground' } }} />;
}
