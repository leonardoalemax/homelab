// Generic downloads feed. Valtar knows nothing about "games" or any other
// specific area -- it only understands the common manifest shape produced
// by services/media/downloads/areas/*.sh. Area-specific formats, metadata
// lookups and caching all live in those scripts, not here.
//
// `downloads` is the compose service name for services/media/downloads.yml,
// resolved over the shared docker network (both containers declare
// `name: base`), so this never depends on the public proxy being reachable.
const INDEX_URL = 'http://downloads/_data/index.json';
const CATEGORY_NAME = 'Valt';
const MAX_BUTTONS = 5;

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// only p/strong/em/code/pre/a/span/img survive the server's message
// sanitizer. `image` and `link` are plain text/anchors on purpose, not <img>
// tags: the host's own link-preview job detects direct image URLs and bare
// links independently of the sanitizer and renders them as embeds, which is
// how the cover art and the download link end up shown without ever
// uploading a file or fighting the sanitizer's <img> src allowlist
const buildMessageHtml = ({ title, description, image, link }) =>
  [
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    description ? `<p>${escapeHtml(description)}</p>` : '',
    image ? `<p><a href="${image}" target="_blank">${image}</a></p>` : '',
    link ? `<p><a href="${link}" target="_blank">${link}</a></p>` : ''
  ]
    .filter(Boolean)
    .join('');

const buildComponents = (entry) =>
  (entry.buttons ?? [])
    .slice(0, MAX_BUTTONS)
    .filter((button) => button?.label && button?.url)
    .map((button) => ({
      name: 'linkButton',
      props: { label: button.label, url: button.url }
    }));

const ensureCategory = async (ctx, name, cache) => {
  if (cache.categories.has(name)) return cache.categories.get(name);

  const categories = await ctx.categories.list();
  const category =
    categories.find((entry) => entry.name === name) ??
    (await ctx.categories.create(name));

  cache.categories.set(name, category);

  return category;
};

const ensureChannel = async (ctx, categoryId, name, cache) => {
  const cacheKey = `${categoryId}/${name}`;

  if (cache.channels.has(cacheKey)) return cache.channels.get(cacheKey);

  const channels = await ctx.channels.list();
  const existing = channels.find(
    (channel) => channel.categoryId === categoryId && channel.name === name
  );

  const channel =
    existing ??
    (await ctx.channels.create({ name, type: 'TEXT', categoryId }));

  if (!existing) {
    ctx.logger.info(
      `Created #${name} (id ${channel.id}). Two one-time manual steps: ` +
        '1) in channel settings, deny "Send Messages" for @everyone so only ' +
        'reactions are possible there -- plugin posts bypass that check ' +
        'either way; 2) in Settings > Roles, grant @everyone the ' +
        'USE_PLUGINS permission, or the buttons on these posts will be ' +
        'invisible to members.'
    );
  }

  cache.channels.set(cacheKey, channel);

  return channel;
};

const fetchJson = async (url) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }

  return response.json();
};

const loadAreas = async (ctx) => {
  let index;

  try {
    index = await fetchJson(INDEX_URL);
  } catch (error) {
    ctx.logger.error(`Could not load ${INDEX_URL}: ${error.message}`);

    return [];
  }

  const areas = [];

  for (const area of index.areas ?? []) {
    try {
      const manifest = await fetchJson(`http://downloads${area.manifest}`);

      areas.push({
        name: area.name,
        channelName: area.channel ?? manifest.channel ?? area.name,
        entries: manifest.entries ?? []
      });
    } catch (error) {
      ctx.logger.error(
        `Could not load area '${area.name}' (${area.manifest}): ${error.message}`
      );
    }
  }

  return areas;
};

// `posted:<area>:<entry.id>` in storage is the one-message-per-entry
// guarantee: this check-then-send-then-mark is the only place a message
// gets created, so an entry already marked is never re-sent
const syncEntries = async (ctx) => {
  const areas = await loadAreas(ctx);
  const cache = { categories: new Map(), channels: new Map() };

  let posted = 0;
  let total = 0;

  for (const area of areas) {
    for (const entry of area.entries) {
      total++;

      const storageKey = `posted:${area.name}:${entry.id}`;

      if (await ctx.storage.get(storageKey)) continue;

      const category = await ensureCategory(ctx, CATEGORY_NAME, cache);
      const channel = await ensureChannel(
        ctx,
        category.id,
        area.channelName,
        cache
      );

      const { messageId } = await ctx.messages.send(
        channel.id,
        buildMessageHtml(entry),
        { components: buildComponents(entry) }
      );

      await ctx.storage.set(storageKey, { messageId, postedAt: Date.now() });
      posted++;
    }
  }

  return { total, posted };
};

const clearPostedStorage = async (ctx) => {
  let cleared = 0;
  let after;

  while (true) {
    const page = await ctx.storage.list({ prefix: 'posted:', limit: 1000, after });

    if (page.length === 0) break;

    for (const { key } of page) {
      await ctx.storage.delete(key);
      cleared++;
    }

    after = page[page.length - 1].key;
  }

  return cleared;
};

const onLoad = (ctx) => {
  // required even though this plugin has no slot UI: it's what makes the
  // host fetch client/index.js at all, which is where messageComponents
  // (the buttons) are registered
  ctx.ui.enable();

  syncEntries(ctx)
    .then(({ total, posted }) =>
      ctx.logger.info(`Valtar: ${posted} new post(s) out of ${total} entries.`)
    )
    .catch((error) => ctx.logger.error(`Initial sync failed: ${error.message}`));

  ctx.commands.register({
    name: 'sync-valt',
    description: 'Re-fetch every area manifest and post anything new',
    requires: 'MANAGE_MESSAGES',
    async executes() {
      const { total, posted } = await syncEntries(ctx);

      return { message: `Synced. ${posted} new post(s) out of ${total} entries.` };
    }
  });

  ctx.commands.register({
    name: 'reset-valt',
    description:
      'Forget which entries were already posted (does not delete the old ' +
      'messages) so the next /sync-valt re-posts everything from scratch',
    requires: 'MANAGE_MESSAGES',
    async executes() {
      const cleared = await clearPostedStorage(ctx);

      return { message: `Cleared ${cleared} entries. Run /sync-valt to re-post.` };
    }
  });

  ctx.commands.register({
    name: 'wipe-valt',
    description:
      'Delete every message this plugin has posted and forget them, so the ' +
      'next /sync-valt starts clean. Does not touch the channels/categories.',
    requires: 'MANAGE_MESSAGES',
    async executes() {
      let deleted = 0;
      let after;

      while (true) {
        const page = await ctx.storage.list({
          prefix: 'posted:',
          limit: 1000,
          after
        });

        if (page.length === 0) break;

        for (const { key, value } of page) {
          if (value?.messageId) {
            await ctx.messages.delete(value.messageId).catch((error) =>
              ctx.logger.error(
                `Could not delete message ${value.messageId}: ${error.message}`
              )
            );
            deleted++;
          }

          await ctx.storage.delete(key);
        }

        after = page[page.length - 1].key;
      }

      return { message: `Deleted ${deleted} post(s). Run /sync-valt to re-post.` };
    }
  });
};

export { onLoad };
