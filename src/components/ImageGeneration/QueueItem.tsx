import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { IconBolt, IconPhoto, IconX } from '@tabler/icons-react';

import { Collection } from '~/components/Collection/Collection';
import { ContentClamp } from '~/components/ContentClamp/ContentClamp';
import { Countdown } from '~/components/Countdown/Countdown';
import { DaysFromNow } from '~/components/Dates/DaysFromNow';
import { DescriptionTable } from '~/components/DescriptionTable/DescriptionTable';
import { splitUppercase, titleCase } from '~/utils/string-helpers';

export function QueueItem({ item, onBoostClick }: Props) {
  const { prompt, ...details } = item.params;
  const detailItems = Object.entries(details).map(([key, value]) => ({
    label: titleCase(splitUppercase(key)),
    value: <ContentClamp maxHeight={44}>{value as string}</ContentClamp>,
  }));

  return (
    <Card withBorder>
      <Card.Section py="xs" inheritPadding withBorder>
        <Group position="apart">
          <Group spacing={8}>
            <ThemeIcon variant="outline" w="auto" h="auto" size="sm" color="gray" px={8} py={2}>
              <Group spacing={8}>
                <IconPhoto size={16} />
                <Text size="sm" inline>
                  {item.images.length}
                </Text>
              </Group>
            </ThemeIcon>
            <Button.Group>
              <Button size="xs" variant="outline" compact>
                ETA <Countdown endTime={item.estimatedCompletionDate} />
              </Button>
              <Button
                size="xs"
                leftIcon={<IconBolt size={16} />}
                onClick={() => onBoostClick(item)}
                compact
              >
                Boost
              </Button>
            </Button.Group>
          </Group>
          <ActionIcon color="red" size="md">
            <IconX />
          </ActionIcon>
        </Group>
      </Card.Section>
      <Stack py="md" spacing={8}>
        <ContentClamp maxHeight={44}>
          <Text>{prompt}</Text>
        </ContentClamp>
        <Collection
          items={item.resources}
          limit={3}
          renderItem={(resource: any) => <Badge size="sm">{resource.name}</Badge>}
          grouped
        />
      </Stack>
      <Card.Section withBorder>
        <Accordion variant="filled">
          <Accordion.Item value="details">
            <Accordion.Control>Additional Details</Accordion.Control>
            <Accordion.Panel>
              <DescriptionTable items={detailItems} labelWidth={150} />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Card.Section>
      <Card.Section py="xs" inheritPadding>
        <Group position="apart" spacing={8}>
          <Text color="dimmed" size="xs">
            Fulfillment by {item.provider.name}
          </Text>
          <Text color="dimmed" size="xs">
            Started <DaysFromNow date={item.createdAt} />
          </Text>
        </Group>
      </Card.Section>
    </Card>
  );
}

type Props = {
  item: any;
  onBoostClick: (item: any) => void;
};
