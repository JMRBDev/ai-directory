import { WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Skeleton } from '../../components/ui/skeleton';

export function ErrorMessage({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <WarningCircle size={17} />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function LoadingCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div className="space-y-4 rounded-xl border bg-card p-5" key={index}>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}
