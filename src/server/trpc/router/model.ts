import {
  ModelFile,
  ModelFileType,
  ModelStatus,
  Prisma,
  ReportReason,
  ScanResultCode,
} from '@prisma/client';
import { z } from 'zod';
import { ModelSort } from '~/server/common/enums';
import { modelSchema, modelVersionSchema } from '~/server/common/validation/model';
import {
  handleAuthorizationError,
  handleBadRequest,
  handleDbError,
} from '~/server/services/errorHandling';
import {
  getAllModelsSchema,
  getAllModelsSelect,
  getAllModelsTransform,
  getAllModelsWhere,
} from '~/server/validators/models/getAllModels';
import { modelWithDetailsSelect } from '~/server/validators/models/getById';
import { checkFileExists, getGetUrl, getS3Client } from '~/utils/s3-utils';
import { protectedProcedure, publicProcedure, router } from '../trpc';

function prepareFiles(
  modelFile: z.infer<typeof modelVersionSchema>['modelFile'],
  trainingDataFile: z.infer<typeof modelVersionSchema>['trainingDataFile']
) {
  const files: Partial<ModelFile>[] = [{ ...modelFile, type: ModelFileType.Model }];
  if (trainingDataFile != null)
    files.push({ ...trainingDataFile, type: ModelFileType.TrainingData });

  return files;
}

const unscannedFile = {
  scannedAt: null,
  scanRequestedAt: null,
  rawScanResult: Prisma.JsonNull,
  virusScanMessage: null,
  virusScanResult: ScanResultCode.Pending,
  pickleScanMessage: null,
  pickleScanResult: ScanResultCode.Pending,
};

export const modelRouter = router({
  getAll: publicProcedure.input(getAllModelsSchema).query(async ({ ctx, input = {} }) => {
    try {
      const session = ctx.session;
      const { cursor, limit = 50 } = input;
      input.showNsfw = session?.user?.showNsfw ?? true;

      const orderBy: Prisma.Enumerable<Prisma.ModelOrderByWithRelationInput> = [
        { createdAt: 'desc' },
      ];
      switch (input.sort) {
        case ModelSort.HighestRated: {
          orderBy.unshift({
            rank: {
              [`rating${input.period}Rank`]: 'asc',
            },
          });
          break;
        }
        case ModelSort.MostDownloaded: {
          orderBy.unshift({
            rank: {
              [`downloadCount${input.period}Rank`]: 'asc',
            },
          });
          break;
        }
      }

      // TODO TypeFix: too rushed to do this properly...
      const where: any = { ...getAllModelsWhere(input) };
      if (!session?.user?.isModerator) {
        // Only show models that are ready to be used unless the user is the owner
        where.OR = [{ status: ModelStatus.Published }, { user: { id: session?.user?.id } }];
      }

      const items = await ctx.prisma.model.findMany({
        take: limit + 1, // get an extra item at the end which we'll use as next cursor
        cursor: cursor ? { id: cursor } : undefined,
        where,
        orderBy: orderBy,
        select: getAllModelsSelect,
      });

      let nextCursor: typeof cursor | undefined = undefined;
      if (items.length > limit) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      const models = getAllModelsTransform(items);
      return { items: models, nextCursor };
    } catch (error) {
      return handleDbError({ code: 'INTERNAL_SERVER_ERROR', error });
    }
  }),
  getById: publicProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    try {
      const { id } = input as unknown as { id: number };

      // TODO TypeFix: too rushed to do this properly...
      const where: any = { id };
      if (!ctx.session?.user?.isModerator) {
        // Only show models that are ready to be used unless the user is the owner
        where.OR = [{ status: ModelStatus.Published }, { user: { id: ctx.session?.user?.id } }];
      }

      const model = await ctx.prisma.model.findFirst({
        where,
        select: modelWithDetailsSelect,
      });

      if (!model) {
        handleDbError({
          code: 'NOT_FOUND',
          message: `No model with id ${id}`,
        });
        return null;
      }

      const { modelVersions } = model;
      const transformedModel = {
        ...model,
        modelVersions: modelVersions.map(({ files, ...version }) => ({
          ...version,
          trainingDataFile: files.find((file) => file.type === ModelFileType.TrainingData),
          modelFile: files.find((file) => file.type === ModelFileType.Model),
        })),
      };

      return transformedModel;
    } catch (error) {
      handleDbError({ code: 'INTERNAL_SERVER_ERROR', error });
      return null;
    }
  }),
  getVersions: publicProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    try {
      const { id } = input;
      const modelVersions = await ctx.prisma.modelVersion.findMany({
        where: { modelId: id },
        select: { id: true, name: true },
      });

      return modelVersions;
    } catch (error) {
      return handleDbError({ code: 'INTERNAL_SERVER_ERROR', error });
    }
  }),
  add: protectedProcedure.input(modelSchema).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const { modelVersions, tagsOnModels, ...data } = input;

    // TODO DRY: This is used in add and update
    // Check that files exist
    const files = modelVersions.flatMap(({ modelFile, trainingDataFile }) =>
      prepareFiles(modelFile, trainingDataFile)
    );
    const s3 = getS3Client();
    for (const file of files) {
      if (!file.url) continue;
      const fileExists = await checkFileExists(file.url, s3);
      if (!fileExists)
        return handleBadRequest(`File ${file.name} could not be found. Please re-upload.`, {
          file,
        });
    }

    try {
      const createdModels = await ctx.prisma.model.create({
        data: {
          ...data,
          userId,
          // TODO Model Status: Allow them to save as draft and publish/unpublish
          status: ModelStatus.Published,
          modelVersions: {
            create: modelVersions.map(({ images, modelFile, trainingDataFile, ...version }) => ({
              ...version,
              // TODO Model Status: Allow them to save as draft and publish/unpublish
              status: ModelStatus.Published,
              files: {
                create: (prepareFiles(modelFile, trainingDataFile) as typeof modelFile[]).map(
                  (file) => ({
                    ...file,
                    ...unscannedFile,
                  })
                ),
              },
              images: {
                create: images.map((image, index) => ({
                  index,
                  image: { create: { ...image, userId } },
                })),
              },
            })),
          },
          tagsOnModels: {
            create: tagsOnModels?.map(({ name }) => ({
              tag: {
                connectOrCreate: {
                  where: { name },
                  create: { name },
                },
              },
            })),
          },
        },
      });

      return createdModels;
    } catch (error) {
      return handleDbError({ code: 'INTERNAL_SERVER_ERROR', error });
    }
  }),
  update: protectedProcedure
    .input(modelSchema.extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id, modelVersions, tagsOnModels, ...data } = input;
      const { tagsToCreate, tagsToUpdate } = tagsOnModels?.reduce(
        (acc, current) => {
          if (!current.id) acc.tagsToCreate.push(current);
          else acc.tagsToUpdate.push(current);

          return acc;
        },
        {
          tagsToCreate: [] as Array<typeof tagsOnModels[number]>,
          tagsToUpdate: [] as Array<typeof tagsOnModels[number]>,
        }
      ) ?? { tagsToCreate: [], tagsToUpdate: [] };

      // TODO DRY: this process is repeated in several locations that need this check
      const isModerator = ctx.session.user.isModerator;
      const ownerId = (await ctx.prisma.model.findUnique({ where: { id } }))?.userId ?? 0;
      if (!isModerator) {
        if (ownerId !== userId) return handleAuthorizationError();
      }

      // TODO DRY: This is used in add and update
      // Check that files exist
      const files = modelVersions.flatMap(({ modelFile, trainingDataFile }) =>
        prepareFiles(modelFile, trainingDataFile)
      );
      const s3 = getS3Client();
      for (const file of files) {
        if (!file.url) continue;
        const fileExists = await checkFileExists(file.url, s3);
        if (!fileExists)
          return handleBadRequest(`File ${file.name} could not be found. Please re-upload.`, {
            file,
          });
      }

      try {
        // Get current versions for file and version comparison
        const currentVersions = await ctx.prisma.modelVersion.findMany({
          where: { modelId: id },
          select: { id: true, files: { select: { type: true, url: true } } },
        });
        const versionIds = modelVersions.map((version) => version.id).filter(Boolean);
        const versionsToDelete = currentVersions
          .filter((version) => !versionIds.includes(version.id))
          .map(({ id }) => id);

        // TODO Model Status: Allow them to save as draft and publish/unpublish
        const model = await ctx.prisma.model.update({
          where: { id },
          data: {
            ...data,
            status: ModelStatus.Published,
            modelVersions: {
              deleteMany:
                versionsToDelete.length > 0 ? { id: { in: versionsToDelete } } : undefined,
              upsert: modelVersions.map(
                ({ id = -1, images, modelFile, trainingDataFile, ...version }) => {
                  const imagesWithIndex = images.map((image, index) => ({
                    index,
                    userId: ownerId,
                    ...image,
                  }));
                  const existingVersion = currentVersions.find((x) => x.id === id);

                  // Determine what files to create/update
                  const existingFileUrls: Record<string, string> = {};
                  for (const existingFile of existingVersion?.files ?? [])
                    existingFileUrls[existingFile.type] = existingFile.url;

                  const files = prepareFiles(modelFile, trainingDataFile) as typeof modelFile[];
                  const filesToCreate: typeof modelFile[] = [];
                  const filesToUpdate: typeof modelFile[] = [];
                  for (const file of files) {
                    if (!file.type) continue;
                    const existingUrl = existingFileUrls[file.type];
                    if (!existingUrl) filesToCreate.push(file);
                    else if (existingUrl !== file.url) filesToUpdate.push(file);
                  }

                  // Determine what images to create/update
                  const imagesToUpdate = imagesWithIndex.filter((x) => !!x.id);
                  const imagesToCreate = imagesWithIndex.filter((x) => !x.id);

                  // TODO Model Status: Allow them to save as draft and publish/unpublish
                  return {
                    where: { id },
                    create: {
                      ...version,
                      status: ModelStatus.Published,
                      files: {
                        create: filesToCreate.map(({ name, type, url, sizeKB }) => ({
                          name,
                          type,
                          url,
                          sizeKB,
                          ...unscannedFile,
                        })),
                      },
                      images: {
                        create: imagesWithIndex.map(({ index, ...image }) => ({
                          index,
                          image: { create: image },
                        })),
                      },
                    },
                    update: {
                      ...version,
                      epochs: version.epochs ?? null,
                      steps: version.steps ?? null,
                      status: ModelStatus.Published,
                      files: {
                        create: filesToCreate.map(({ name, type, url, sizeKB }) => ({
                          name,
                          type,
                          url,
                          sizeKB,
                          ...unscannedFile,
                        })),
                        update: filesToUpdate.map(({ type, url, name, sizeKB }) => ({
                          where: { modelVersionId_type: { modelVersionId: id, type } },
                          data: {
                            url,
                            name,
                            sizeKB,
                            ...unscannedFile,
                          },
                        })),
                      },
                      images: {
                        deleteMany: {
                          NOT: images.map((image) => ({ imageId: image.id })),
                        },
                        create: imagesToCreate.map(({ index, ...image }) => ({
                          index,
                          image: { create: image },
                        })),
                        update: imagesToUpdate.map(({ index, ...image }) => ({
                          where: {
                            imageId_modelVersionId: {
                              imageId: image.id as number,
                              modelVersionId: id,
                            },
                          },
                          data: {
                            index,
                          },
                        })),
                      },
                    },
                  };
                }
              ),
            },
            tagsOnModels: {
              deleteMany: {},
              connectOrCreate: tagsToUpdate.map((tag) => ({
                where: { modelId_tagId: { modelId: id, tagId: tag.id as number } },
                create: { tagId: tag.id as number },
              })),
              create: tagsToCreate.map((tag) => ({
                tag: { create: { name: tag.name.toLowerCase() } },
              })),
            },
          },
        });

        if (!model) {
          return handleDbError({
            code: 'NOT_FOUND',
            message: `No model with id ${id}`,
          });
        }

        return model;
      } catch (error) {
        return handleDbError({ code: 'INTERNAL_SERVER_ERROR', error });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { id } = input;

        // TODO DRY: this process is repeated in several locations that need this check
        const isModerator = ctx.session.user.isModerator;
        if (!isModerator) {
          const userId = ctx.session.user.id;
          const ownerId = (await ctx.prisma.model.findUnique({ where: { id } }))?.userId ?? 0;
          if (ownerId !== userId) return handleAuthorizationError();
        }

        const model = await ctx.prisma.model.delete({ where: { id } });

        if (!model) {
          return handleDbError({
            code: 'NOT_FOUND',
            message: `No model with id ${id}`,
          });
        }

        return model;
      } catch (error) {
        return handleDbError({ code: 'INTERNAL_SERVER_ERROR', error });
      }
    }),
  deleteModelVersion: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { id } = input;

        // TODO DRY: this process is repeated in several locations that need this check
        const isModerator = ctx.session.user.isModerator;
        if (!isModerator) {
          const userId = ctx.session.user.id;
          const ownerId =
            (
              await ctx.prisma.modelVersion.findUnique({
                where: { id },
                select: { model: { select: { userId: true } } },
              })
            )?.model?.userId ?? 0;
          if (ownerId !== userId) return handleAuthorizationError();
        }

        const modelVersion = await ctx.prisma.modelVersion.delete({ where: { id } });

        if (!modelVersion) {
          return handleDbError({
            code: 'NOT_FOUND',
            message: `No model version with id ${id}`,
          });
        }

        return modelVersion;
      } catch (error) {
        return handleDbError({ code: 'INTERNAL_SERVER_ERROR', error });
      }
    }),
  report: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.nativeEnum(ReportReason) }))
    .mutation(async ({ ctx, input: { id, reason } }) => {
      const data: Prisma.ModelUpdateInput =
        reason === ReportReason.NSFW ? { nsfw: true } : { tosViolation: true };

      try {
        await ctx.prisma.$transaction([
          ctx.prisma.model.update({
            where: { id },
            data,
          }),
          ctx.prisma.modelReport.create({
            data: {
              modelId: id,
              reason,
              userId: ctx.session.user.id,
            },
          }),
        ]);
      } catch (error) {
        return handleDbError({
          code: 'INTERNAL_SERVER_ERROR',
          error,
        });
      }
    }),
});
