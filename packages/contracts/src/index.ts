import { z } from 'zod';

export const resourceTypeSchema = z.enum(['skills', 'agents', 'rules', 'templates']);
export const resourceReviewStatusSchema = z.enum(['unreviewed', 'reviewed']);
export const resourceLifecycleStatusSchema = z.enum(['active', 'retired']);
export const resourceVisibilitySchema = z.enum(['private', 'targeted', 'public']);

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const resourceVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

export const resourceIdSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:skills|agents|rules|templates)\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
);

const templateResourceIdSchema = resourceIdSchema.refine(
  (id) => !id.includes('/templates/'),
  'Templates cannot contain nested templates',
);

export const templateManifestSchema = z.object({
  name: slugSchema,
  description: z.string().min(1),
  resources: z
    .array(
      z.object({
        id: templateResourceIdSchema,
        version: resourceVersionSchema,
      }),
    )
    .min(1),
});

export const resourceSummarySchema = z.object({
  owner: slugSchema,
  type: resourceTypeSchema,
  name: slugSchema,
  description: z.string().min(1),
  latestVersion: resourceVersionSchema,
  reviewStatus: resourceReviewStatusSchema,
  lifecycleStatus: resourceLifecycleStatusSchema,
  visibility: resourceVisibilitySchema,
  updatedAt: z.string().min(1),
});

export const registryIndexSchema = z.object({
  schemaVersion: z.literal(1),
  resources: z.array(resourceSummarySchema),
});

export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type ResourceSummary = z.infer<typeof resourceSummarySchema>;
export type RegistryIndex = z.infer<typeof registryIndexSchema>;
export type TemplateManifest = z.infer<typeof templateManifestSchema>;
