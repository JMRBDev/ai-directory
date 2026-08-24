import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import type { PublishReview } from './model';

export function ReviewCard({ review, description, pullRequestUrl }: {
  review: PublishReview;
  description: string;
  pullRequestUrl: string;
}) {
  return (
    <Card aria-labelledby="publish-review-title">
      <CardHeader>
        <CardTitle id="publish-review-title">Ready to submit</CardTitle>
        <CardAction>
          <Badge variant="success"><HugeiconsIcon icon={Tick02Icon} /> Validated</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Resource</dt><dd className="break-all font-mono">{review.resource}</dd></div>
          <div><dt className="text-muted-foreground">Version</dt><dd className="tabular-nums">{review.version}</dd></div>
          <div><dt className="text-muted-foreground">Entry file</dt><dd className="break-all font-mono">{review.entryFile}</dd></div>
          <div><dt className="text-muted-foreground">Files</dt><dd className="tabular-nums">{review.files.length}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">Description</dt><dd>{description}</dd></div>
        </dl>
      </CardContent>
      {pullRequestUrl && (
        <CardFooter>
          <Button asChild variant="outline" size="sm">
            <a href={pullRequestUrl} target="_blank" rel="noreferrer"><HugeiconsIcon icon={Tick02Icon} size={15} /> Open pull request</a>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
