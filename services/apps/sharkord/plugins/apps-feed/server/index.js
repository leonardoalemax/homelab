import fs from 'fs/promises';
import path from 'path';

const CONTENT_DIR = '/home/bun/.config/sharkord/content';

// top-level folders under CONTENT_DIR are categories, their subfolders are
// channels, everything else (images, loose files) is ignored
const RESERVED_DIRS = new Set(['images']);

const titleCase = (slug) =>
  slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

// minimal "frontmatter" parser: a `---` block of `key: value` lines, then body
const parseFrontmatter = (raw) => {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) return { meta: {}, body: raw.trim() };

  const [, frontmatter, body] = match;
  const meta = {};

  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');

    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    meta[key] = value;
  }

  return { meta, body: body.trim() };
};

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// only p/strong/em/code/pre/a/span/img survive the server's message sanitizer,
// so the "card" is plain paragraphs rather than headings or lists.
// `link` has to appear as real text (not just a button's props) because the
// host's own link-preview job scans message content for URLs to unfurl --
// this is what gets the site's thumbnail/OG image attached under the post.
// `iconUrl` (set once the attached image is uploaded, see postEntry) reuses
// the `emoji-image` class -- the only img class the sanitizer keeps -- so it
// renders small and inline right next to the title instead of full size
const buildMessageHtml = ({ title, description, link }, iconUrl) =>
  [
    `<p>${
      iconUrl ? `<img src="${iconUrl}" alt="" class="emoji-image" /> ` : ''
    }<strong>${escapeHtml(title)}</strong></p>`,
    description ? `<p>${escapeHtml(description)}</p>` : '',
    link ? `<p><a href="${link}" target="_blank">${link}</a></p>` : ''
  ]
    .filter(Boolean)
    .join('');

const MAX_BUTTONS = 5;

// frontmatter format: `buttons: Label=https://url|Other=https://url2`
const parseButtons = (raw) => {
  if (!raw) return [];

  return raw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, MAX_BUTTONS)
    .map((part) => {
      const idx = part.indexOf('=');

      if (idx === -1) return null;

      return {
        name: 'linkButton',
        props: {
          label: part.slice(0, idx).trim(),
          url: part.slice(idx + 1).trim()
        }
      };
    })
    .filter(Boolean);
};

// falls back to a single "Abrir" button off `link` when no `buttons` field
// is set, so existing entries keep working without editing their frontmatter
const buildComponents = (entry) => {
  const parsed = parseButtons(entry.buttons);

  if (parsed.length > 0) return parsed;

  return entry.link
    ? [{ name: 'linkButton', props: { label: 'Abrir', url: entry.link } }]
    : [];
};

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

// walks CONTENT_DIR two levels deep: <category>/<channel>/*.md. Anything
// shallower or in RESERVED_DIRS is skipped, so content/images/*.png next to
// the category folders stays out of the scan
const loadEntries = async () => {
  let categoryDirs;

  try {
    categoryDirs = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries = [];

  for (const categoryDir of categoryDirs) {
    if (!categoryDir.isDirectory() || RESERVED_DIRS.has(categoryDir.name)) {
      continue;
    }

    const categoryPath = path.join(CONTENT_DIR, categoryDir.name);
    const channelDirs = await fs.readdir(categoryPath, {
      withFileTypes: true
    });

    for (const channelDir of channelDirs) {
      if (!channelDir.isDirectory()) continue;

      const channelPath = path.join(categoryPath, channelDir.name);
      const files = await fs.readdir(channelPath);

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const raw = await fs.readFile(path.join(channelPath, file), 'utf-8');
        const { meta, body } = parseFrontmatter(raw);

        entries.push({
          id: `${categoryDir.name}/${channelDir.name}/${file}`,
          categoryName: titleCase(categoryDir.name),
          channelName: channelDir.name,
          title: meta.title || file.replace(/\.md$/, ''),
          link: meta.link,
          image: meta.image,
          description: meta.description || body,
          buttons: meta.buttons
        });
      }
    }
  }

  return entries;
};

// the icon's served URL depends on the name the file manager gives the
// upload, which we only learn after sending -- so this posts once without an
// icon, then edits the message in to add it once the upload's URL is known
const postEntry = async (ctx, channel, entry) => {
  const files = [];

  if (entry.image) {
    try {
      const data = await fs.readFile(path.join(CONTENT_DIR, entry.image));

      files.push({ name: path.basename(entry.image), data });
    } catch (error) {
      ctx.logger.error(`Could not read image for ${entry.id}: ${error.message}`);
    }
  }

  const { messageId } = await ctx.messages.send(
    channel.id,
    buildMessageHtml(entry, null),
    { files, components: buildComponents(entry) }
  );

  if (files.length === 0) return messageId;

  const saved = await ctx.messages.get(messageId);
  const uploadedName = saved?.files?.[0]?.name;

  if (uploadedName) {
    const iconUrl = `/public/${encodeURIComponent(uploadedName)}`;

    await ctx.messages.edit(messageId, buildMessageHtml(entry, iconUrl));
  }

  return messageId;
};

const syncEntries = async (ctx) => {
  const entries = await loadEntries();
  const cache = { categories: new Map(), channels: new Map() };

  let posted = 0;

  for (const entry of entries) {
    const storageKey = `posted:${entry.id}`;

    if (await ctx.storage.get(storageKey)) continue;

    const category = await ensureCategory(ctx, entry.categoryName, cache);
    const channel = await ensureChannel(
      ctx,
      category.id,
      entry.channelName,
      cache
    );

    const messageId = await postEntry(ctx, channel, entry);

    await ctx.storage.set(storageKey, { messageId, postedAt: Date.now() });
    posted++;
  }

  return { total: entries.length, posted };
};

const onLoad = (ctx) => {
  // required even though this plugin has no slot UI: it's what makes the
  // host fetch client/index.js at all, which is where messageComponents
  // (the buttons) are registered. Without this the button props arrive but
  // nothing renders them.
  ctx.ui.enable();

  syncEntries(ctx)
    .then(({ total, posted }) =>
      ctx.logger.info(`Apps Feed: ${posted} new post(s) out of ${total} entries.`)
    )
    .catch((error) => ctx.logger.error(`Initial sync failed: ${error.message}`));

  ctx.commands.register({
    name: 'sync-apps',
    description: 'Re-scan the apps content folder and post anything new',
    requires: 'MANAGE_MESSAGES',
    async executes() {
      const { total, posted } = await syncEntries(ctx);

      return { message: `Synced. ${posted} new post(s) out of ${total} entries.` };
    }
  });

  ctx.commands.register({
    name: 'reset-apps',
    description:
      'Forget which entries were already posted (does not delete the old ' +
      'messages) so the next /sync-apps re-posts everything from scratch',
    requires: 'MANAGE_MESSAGES',
    async executes() {
      const cleared = await clearPostedStorage(ctx);

      return { message: `Cleared ${cleared} entries. Run /sync-apps to re-post.` };
    }
  });

  ctx.commands.register({
    name: 'wipe-apps',
    description:
      'Delete every message this plugin has posted and forget them, so the ' +
      'next /sync-apps starts clean. Does not touch the channels/categories.',
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

      return { message: `Deleted ${deleted} post(s). Run /sync-apps to re-post.` };
    }
  });
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

export { onLoad };
