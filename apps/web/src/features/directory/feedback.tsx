import { WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';

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
