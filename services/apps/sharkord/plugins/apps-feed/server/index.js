import fs from 'fs/promises';
import path from 'path';

const CHANNEL_NAME = 'apps-feed';
const CATEGORY_NAME = 'Apps';
const CONTENT_DIR = '/home/bun/.config/sharkord/content/apps';

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
// so the "card" is plain paragraphs rather than headings or lists
const buildMessageHtml = ({ title, link, description }) => {
  const titleHtml = link
    ? `<a href="${link}" target="_blank">${escapeHtml(title)}</a>`
    : escapeHtml(title);

  return [
    `<p><strong>${titleHtml}</strong></p>`,
    description ? `<p>${escapeHtml(description)}</p>` : '',
    link ? `<p>${link}</p>` : ''
  ]
    .filter(Boolean)
    .join('');
};

const ensureChannel = async (ctx) => {
  const channels = await ctx.channels.list();
  const existing = channels.find((channel) => channel.name === CHANNEL_NAME);

  if (existing) return existing;

  const categories = await ctx.categories.list();
  const category =
    categories.find((entry) => entry.name === CATEGORY_NAME) ??
    (await ctx.categories.create(CATEGORY_NAME));

  const channel = await ctx.channels.create({
    name: CHANNEL_NAME,
    type: 'TEXT',
    categoryId: category.id
  });

  ctx.logger.info(
    `Created #${CHANNEL_NAME} (id ${channel.id}). One-time manual step: in ` +
      'channel settings, deny "Send Messages" for @everyone so only reactions ' +
      'are possible there -- plugin posts bypass that check either way.'
  );

  return channel;
};

const loadEntries = async () => {
  let files;

  try {
    files = await fs.readdir(CONTENT_DIR);
  } catch {
    return [];
  }

  const entries = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const raw = await fs.readFile(path.join(CONTENT_DIR, file), 'utf-8');
    const { meta, body } = parseFrontmatter(raw);

    entries.push({
      id: file,
      title: meta.title || file.replace(/\.md$/, ''),
      link: meta.link,
      image: meta.image,
      description: meta.description || body
    });
  }

  return entries;
};

const syncEntries = async (ctx) => {
  const channel = await ensureChannel(ctx);
  const entries = await loadEntries();

  let posted = 0;

  for (const entry of entries) {
    const storageKey = `posted:${entry.id}`;

    if (await ctx.storage.get(storageKey)) continue;

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
      buildMessageHtml(entry),
      { files }
    );

    await ctx.storage.set(storageKey, { messageId, postedAt: Date.now() });
    posted++;
  }

  return { total: entries.length, posted };
};

const onLoad = (ctx) => {
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
};

export { onLoad };
