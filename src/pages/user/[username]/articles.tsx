import { Group, Stack, Tabs } from '@mantine/core';
import { MetricTimeframe } from '@prisma/client';
import { useRouter } from 'next/router';
import { useState } from 'react';

import { NotFound } from '~/components/AppLayout/NotFound';
import { ArticlesInfinite } from '~/components/Article/Infinite/ArticlesInfinite';
import { UserDraftArticles } from '~/components/Article/UserDraftArticles';
import { useArticleQueryParams } from '~/components/Article/article.utils';
import { SortFilter } from '~/components/Filters';
import { MasonryContainer } from '~/components/MasonryColumns/MasonryContainer';
import { MasonryProvider } from '~/components/MasonryColumns/MasonryProvider';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { constants } from '~/server/common/constants';
import { ArticleSort } from '~/server/common/enums';
import { getFeatureFlags } from '~/server/services/feature-flags.service';
import { createServerSideProps } from '~/server/utils/server-side-helpers';
import { postgresSlugify } from '~/utils/string-helpers';
import { UserProfileLayout } from './';
import { FeedContentToggle } from '~/components/FeedContentToggle/FeedContentToggle';
import { ArticleFiltersDropdown } from '~/components/Article/Infinite/ArticleFiltersDropdown';

export const getServerSideProps = createServerSideProps({
  useSession: true,
  resolver: async ({ ctx, session }) => {
    const features = getFeatureFlags({ user: session?.user });
    if (!features.articles)
      return {
        redirect: {
          destination: `/user/${ctx.query.username}`,
          permanent: false,
        },
      };
  },
});

export default function UserArticlesPage() {
  const currentUser = useCurrentUser();
  const router = useRouter();
  const {
    replace,
    query: { followed = undefined, ...query },
  } = useArticleQueryParams();
  const period = query.period ?? MetricTimeframe.AllTime;
  const sort = query.sort ?? ArticleSort.Newest;
  const username = (router.query.username as string) ?? '';
  const selfView =
    !!currentUser && postgresSlugify(currentUser.username) === postgresSlugify(username);

  const [section, setSection] = useState<'published' | 'draft'>(
    selfView ? query.section ?? 'published' : 'published'
  );
  const viewingPublished = section === 'published';

  // currently not showing any content if the username is undefined
  if (!username) return <NotFound />;

  return (
    <Tabs.Panel value="/articles">
      <MasonryProvider
        columnWidth={constants.cardSizes.model}
        maxColumnCount={7}
        maxSingleColumnWidth={450}
      >
        <MasonryContainer fluid>
          <Stack spacing="xs">
            <Group spacing={8} position="apart">
              {selfView && (
                <FeedContentToggle
                  size="xs"
                  value={section}
                  onChange={(section) => {
                    setSection(section);
                    replace({ section });
                  }}
                />
              )}
              {viewingPublished && (
                <Group spacing={8} noWrap>
                  <SortFilter
                    type="articles"
                    variant="button"
                    value={sort}
                    onChange={(x) => replace({ sort: x as ArticleSort })}
                  />
                  <ArticleFiltersDropdown
                    query={{ ...query, followed }}
                    onChange={(filters) => replace(filters)}
                  />
                </Group>
              )}
            </Group>
            {viewingPublished ? (
              <ArticlesInfinite
                filters={{
                  ...query,
                  sort,
                  period,
                  includeDrafts: !!currentUser?.isModerator,
                }}
              />
            ) : (
              <UserDraftArticles />
            )}
          </Stack>
        </MasonryContainer>
      </MasonryProvider>
    </Tabs.Panel>
  );
}

UserArticlesPage.getLayout = UserProfileLayout;
