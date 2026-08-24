import { Skeleton } from '../../components/ui/skeleton';

export function ResourceSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-24" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-52 max-w-full" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        <Skeleton className="hidden h-80 rounded-xl lg:block" />
      </div>
    </div>
  );
}
