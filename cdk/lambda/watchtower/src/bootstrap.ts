import type { Client } from '@elastic/elasticsearch';

const ILM_POLICY = 'watchtower-30d';

export async function ensureStatsIndex(client: Client, statsIndex: string): Promise<void> {
  await client.ilm.putLifecycle({
    name: ILM_POLICY,
    body: {
      policy: {
        phases: {
          hot: { actions: { rollover: { max_age: '30d', max_primary_shard_size: '10gb' } } },
          delete: { min_age: '30d', actions: { delete: {} } },
        },
      },
    },
  });

  await client.indices.putIndexTemplate({
    name: `${statsIndex}-template`,
    body: {
      index_patterns: [`${statsIndex}*`],
      template: {
        settings: {
          'index.lifecycle.name': ILM_POLICY,
          'index.lifecycle.rollover_alias': statsIndex,
          number_of_shards: 1,
          number_of_replicas: 1,
        },
        mappings: {
          properties: {
            '@timestamp': { type: 'date' },
            window: { type: 'keyword' },
            notes: { type: 'text', index: false },
            data: {
              properties: {
                log_count: { type: 'long' },
                error_count: { type: 'long' },
                warn_count: { type: 'long' },
                error_rate: { type: 'float' },
                error_event_count: { type: 'long' },
                distinct_error_events: { type: 'long' },
                sse_connected_count: { type: 'long' },
                sse_first_response_count: { type: 'long' },
                sse_connect_p95_ms: { type: 'float' },
                sse_first_response_p95_ms: { type: 'float' },
              },
            },
          },
        },
      },
    },
  });

  const aliasExists = await client.indices.existsAlias({ name: statsIndex });
  if (aliasExists) return;
  try {
    await client.indices.create({
      index: `${statsIndex}-000001`,
      body: { aliases: { [statsIndex]: { is_write_index: true } } },
    });
  } catch (err: unknown) {
    const errType = (err as { meta?: { body?: { error?: { type?: string } } } })?.meta?.body?.error?.type;
    if (errType !== 'resource_already_exists_exception') throw err;
  }
}
