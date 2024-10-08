import OneKeyMap from '@essentials/one-key-map';
import trieMemoize from 'trie-memoize';
import { Alert, Button, Center, Loader, Stack, Text } from '@mantine/core';
import { IconCalendar, IconInbox } from '@tabler/icons-react';

import { QueueItem } from '~/components/ImageGeneration/QueueItem';
import { useGetTextToImageRequests } from '~/components/ImageGeneration/utils/generationRequestHooks';
import { generationPanel } from '~/store/generation.store';
import { InViewLoader } from '~/components/InView/InViewLoader';
import { ScrollArea } from '~/components/ScrollArea/ScrollArea';
import { formatDate } from '~/utils/date-helpers';
import { useSchedulerDownloadingStore } from '~/store/scheduler-download.store';
import {
  downloadGeneratedImagesByDate,
  orchestratorIntegrationDate,
} from '~/server/common/constants';
import { useFiltersContext } from '~/providers/FiltersProvider';
import { WORKFLOW_TAGS } from '~/shared/constants/generation.constants';
import { MarkerType } from '~/server/common/enums';

export function Queue() {
  const { filters } = useFiltersContext((state) => ({
    filters: state.markers,
    setFilters: state.setMarkerFilters,
  }));

  let workflowTagsFilter = undefined;

  switch (filters.marker) {
    case MarkerType.Favorited:
      workflowTagsFilter = [WORKFLOW_TAGS.FAVORITE];
      break;

    case MarkerType.Liked:
      workflowTagsFilter = [WORKFLOW_TAGS.FEEDBACK.LIKED];
      break;

    case MarkerType.Disliked:
      workflowTagsFilter = [WORKFLOW_TAGS.FEEDBACK.DISLIKED];
      break;
  }

  const { data, isLoading, fetchNextPage, hasNextPage, isRefetching, isError } =
    useGetTextToImageRequests({
      tags: workflowTagsFilter,
    });

  const { downloading } = useSchedulerDownloadingStore();
  const handleSetDownloading = () => useSchedulerDownloadingStore.setState({ downloading: true });
  const canDownload = new Date().getTime() < downloadGeneratedImagesByDate.getTime();

  if (isError)
    return (
      <Alert color="red">
        <Text align="center">Could not retrieve image generation requests</Text>
      </Alert>
    );

  if (isLoading)
    return (
      <Center p="xl">
        <Loader />
      </Center>
    );

  const RetentionPolicyUpdate = canDownload ? (
    <div className="flex flex-col items-center justify-center gap-3 ">
      <div className="flex flex-col items-center justify-center">
        <Text color="dimmed">
          <IconCalendar size={14} style={{ display: 'inline', marginTop: -3 }} strokeWidth={2} />{' '}
          Images are kept in the generator for 30 days
        </Text>
        <Text color="dimmed">
          {
            'To download images created before this policy took effect, click the download button below'
          }
        </Text>
        {/* <Text color="dimmed" td="underline">
          Historical downloads have been temporarily disabled
        </Text> */}
      </div>
      <Button
        component="a"
        href="/api/generation/history"
        disabled={downloading}
        onClick={handleSetDownloading}
      >
        Download past images
      </Button>
    </div>
  ) : null;

  if (!data.length)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Stack spacing="xs" align="center" py="16">
          <IconInbox size={64} stroke={1} />
          {filters.marker && (
            <Stack spacing={0}>
              <Text size={32} align="center">
                No results found
              </Text>
              <Text align="center">{'Try adjusting your filters'}</Text>
            </Stack>
          )}
          {!filters.marker && (
            <Stack spacing={0}>
              <Text size="md" align="center">
                The queue is empty
              </Text>
              <Text size="sm" color="dimmed">
                Try{' '}
                <Text
                  variant="link"
                  onClick={() => generationPanel.setView('generate')}
                  sx={{ cursor: 'pointer' }}
                  span
                >
                  generating
                </Text>{' '}
                new images with our resources
              </Text>
            </Stack>
          )}
        </Stack>
        {RetentionPolicyUpdate}
      </div>
    );

  return (
    <ScrollArea
      scrollRestore={{ key: 'queue' }}
      className="flex flex-col gap-2 px-3"
      id="generator-queue"
    >
      {canDownload && (
        <Text size="xs" color="dimmed" mt="xs">
          <IconCalendar size={14} style={{ display: 'inline', marginTop: -3 }} strokeWidth={2} />{' '}
          Images are kept in the generator for 30 days.{' '}
          {/* <Text span td="underline">
              {`You'll be able to download older images soon.`}
            </Text> */}
          <Text
            variant="link"
            td="underline"
            component="a"
            href="/api/generation/history"
            onClick={handleSetDownloading}
          >
            Download images created before {formatDate(orchestratorIntegrationDate)}
          </Text>
        </Text>
      )}
      {/* {data.map((request) =>
          request.steps.map((step) => createRenderElement(QueueItem, request, step))
        )} */}
      <div className="flex flex-col gap-2">
        {data.map((request) =>
          request.steps.map((step) => {
            const { marker } = filters;

            return (
              <QueueItem
                key={request.id}
                id={request.id.toString()}
                request={request}
                step={step}
                filter={{ marker }}
              />
            );
          })
        )}
      </div>
      {hasNextPage ? (
        <InViewLoader loadFn={fetchNextPage} loadCondition={!!data.length && !isRefetching}>
          <Center sx={{ height: 60 }}>
            <Loader />
          </Center>
        </InViewLoader>
      ) : (
        <div className="p-6">{RetentionPolicyUpdate}</div>
      )}
    </ScrollArea>
  );
}

// supposedly ~5.5x faster than createElement without the memo
const createRenderElement = trieMemoize(
  [OneKeyMap, WeakMap, WeakMap],
  (RenderComponent, request, step) => (
    <RenderComponent key={request.id} id={request.id.toString()} request={request} step={step} />
  )
);
