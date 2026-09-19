// Normalizes RSS 2.0, RSS 1.0/RDF and Atom feeds into the same shape so the
// templates never need to care which dialect the pasted feed URL uses, and merges
// multiple feed URLs (settings.yml polls one per comma-separated rss_url entry)
// into a single date-sorted list.
// Serverless runtime (node) - entry point must be named run(), not transform().
function run(input) {
  function text(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (typeof val === 'object') {
      if (typeof val['#text'] === 'string') return val['#text'];
      if (typeof val['_text'] === 'string') return val['_text'];
      if (typeof val.text === 'string') return val.text;
    }
    return '';
  }

  // attributes show up under different keys depending on the XML->JSON step
  // (plain key, "@key", or nested under "_attributes")
  function attr(val, name) {
    if (!val || typeof val !== 'object') return '';
    if (typeof val[name] === 'string') return val[name];
    if (typeof val['@' + name] === 'string') return val['@' + name];
    if (val._attributes && typeof val._attributes[name] === 'string') return val._attributes[name];
    return '';
  }

  // TRMNL's XML->JSON step drops namespace prefixes (confirmed: <media:thumbnail url="...">
  // shows up as item.thumbnail, not item['media:thumbnail']) - so every namespaced tag
  // (media:, content:, dc:, itunes:) needs to be looked up both with and without its prefix.
  function firstOf(obj, keys) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return undefined;
  }

  function stripHtml(html) {
    return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  // <img src="..."> is the common case, but lazy-loaded WordPress-style markup often
  // ships the real URL in data-src/data-lazy-src/data-original instead (with "src" left
  // as a placeholder), and some responsive images only carry a srcset with no plain src.
  // Tried in this order, each requiring a boundary before its name so "src" can't
  // accidentally match inside "data-src".
  function firstImgFromHtml(html) {
    const str = String(html || '');
    const attrNames = ['data-src', 'data-lazy-src', 'data-original', 'src'];
    for (const name of attrNames) {
      const re = new RegExp('<img[^>]*[\\s"\']' + name + '=["\']([^"\']+)["\']', 'i');
      const m = str.match(re);
      if (m) return m[1];
    }
    const srcset = str.match(/<img[^>]+srcset=["']([^"',\s]+)/i);
    return srcset ? srcset[1] : '';
  }

  // media:content is NOT guaranteed to be an image - the Media RSS spec also covers
  // audio/video/document via the "type" (MIME) or "medium" attribute. media:thumbnail
  // is always an image by definition, so it's checked first regardless of the parent's
  // type, then we only trust the node's own url if it doesn't look like non-image media.
  function isImageMedia(node) {
    const type = attr(node, 'type');
    if (type) return type.indexOf('image') === 0;
    const medium = attr(node, 'medium');
    if (medium) return medium === 'image';
    return true; // no type/medium given - most simple feeds omit it, assume usable
  }

  function urlFromMediaNode(node, requireImageType) {
    // prefer the node's own url when it passes the type check (usually the full-size image)
    if (!requireImageType || isImageMedia(node)) {
      const url = attr(node, 'url');
      if (url) return url;
    }
    // otherwise (e.g. this node is a video) fall back to a nested media:thumbnail,
    // which is always an image regardless of its parent's type
    const nestedThumb = firstOf(node, ['media:thumbnail', 'thumbnail']);
    if (nestedThumb) {
      const list = Array.isArray(nestedThumb) ? nestedThumb : [nestedThumb];
      for (const n of list) {
        const url = attr(n, 'url');
        if (url) return url;
      }
    }
    const nestedContent = firstOf(node, ['media:content', 'content']);
    if (nestedContent) {
      const list = Array.isArray(nestedContent) ? nestedContent : [nestedContent];
      for (const n of list) {
        const url = urlFromMediaNode(n, requireImageType);
        if (url) return url;
      }
    }
    return '';
  }

  function extractImage(item) {
    const mediaGroup = firstOf(item, ['media:group', 'group']) || {};

    // media:content can be video/audio/etc, so it's filtered by type/medium
    const contentSources = [
      firstOf(item, ['media:content', 'content']),
      firstOf(mediaGroup, ['media:content', 'content'])
    ];
    for (const media of contentSources) {
      if (!media) continue;
      const list = Array.isArray(media) ? media : [media];
      for (const m of list) {
        const url = urlFromMediaNode(m, true);
        if (url) return url;
      }
    }

    // media:thumbnail is always an image, no filtering needed
    const thumbnailSources = [
      firstOf(item, ['media:thumbnail', 'thumbnail']),
      firstOf(mediaGroup, ['media:thumbnail', 'thumbnail'])
    ];
    for (const media of thumbnailSources) {
      if (!media) continue;
      const list = Array.isArray(media) ? media : [media];
      for (const m of list) {
        const url = urlFromMediaNode(m, false);
        if (url) return url;
      }
    }

    // <enclosure url="..." type="image/...">
    if (item.enclosure) {
      const list = Array.isArray(item.enclosure) ? item.enclosure : [item.enclosure];
      for (const e of list) {
        const type = attr(e, 'type');
        const url = attr(e, 'url') || attr(e, 'href');
        if (url && (!type || type.indexOf('image') === 0)) return url;
      }
    }
    // Atom <link rel="enclosure" type="image/..." href="...">
    if (item.link) {
      const list = Array.isArray(item.link) ? item.link : [item.link];
      for (const l of list) {
        const type = attr(l, 'type');
        const href = attr(l, 'href');
        if (href && type.indexOf('image') === 0) return href;
      }
    }
    // <itunes:image href="...">
    const itunesImage = firstOf(item, ['itunes:image', 'image']);
    if (itunesImage) {
      const url = attr(itunesImage, 'href') || attr(itunesImage, 'url');
      if (url) return url;
    }
    // last resort: first <img> found in the article body
    const html = text(firstOf(item, ['content:encoded', 'encoded'])) || text(item.content) || text(item.description) || text(item.summary);
    return firstImgFromHtml(html);
  }

  function normalize(item) {
    return {
      title: stripHtml(text(item.title)),
      description: stripHtml(text(item.description) || text(item.summary) || text(firstOf(item, ['content:encoded', 'encoded'])) || text(item.content)),
      date: text(item.pubDate) || text(item.published) || text(item.updated) || text(firstOf(item, ['dc:date', 'date'])),
      image: extractImage(item),
      source: item.__sourceTitle || ''
    };
  }

  function itemsFromFeedRoot(root) {
    if (root.rss && root.rss.channel) {
      // RSS 2.0
      const channel = root.rss.channel;
      const items = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
      return { items: items, feedTitle: text(channel.title) };
    }
    if (root.feed) {
      // Atom
      const feed = root.feed;
      const items = Array.isArray(feed.entry) ? feed.entry : (feed.entry ? [feed.entry] : []);
      return { items: items, feedTitle: text(feed.title) };
    }
    if (root['rdf:RDF']) {
      // RSS 1.0 / RDF
      const rdf = root['rdf:RDF'];
      const items = Array.isArray(rdf.item) ? rdf.item : (rdf.item ? [rdf.item] : []);
      return { items: items, feedTitle: text(rdf.channel && rdf.channel.title) };
    }
    return { items: [], feedTitle: '' };
  }

  function isFeedRoot(obj) {
    return !!(obj && typeof obj === 'object' && ((obj.rss && obj.rss.channel) || obj.feed || obj['rdf:RDF']));
  }

  function isWeatherRoot(obj) {
    return !!(obj && typeof obj === 'object' && (obj.current || obj.daily) && !isFeedRoot(obj));
  }

  function parsedTime(item) {
    const raw = text(item.pubDate) || text(item.published) || text(item.updated) || text(firstOf(item, ['dc:date', 'date']));
    const t = Date.parse(raw);
    return isNaN(t) ? 0 : t;
  }

  // settings.yml polls one URL per comma-separated rss_url entry, plus the weather
  // API - gather every IDX_N (regardless of order or count) and sort each into
  // "feed" or "weather" by shape, so 1 feed and N feeds work identically here.
  const idxKeys = Object.keys(input || {})
    .filter(function (k) { return /^IDX_\d+$/.test(k); })
    .sort(function (a, b) { return parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10); });

  let weather;
  const feedTitles = [];
  let allRawItems = [];

  for (const key of idxKeys) {
    const root = input[key];
    if (isWeatherRoot(root)) {
      weather = root;
    } else if (isFeedRoot(root)) {
      const parsed = itemsFromFeedRoot(root);
      if (parsed.feedTitle) feedTitles.push(parsed.feedTitle);
      // tag each raw item with which feed it came from, so normalize() can surface
      // it as `source` - only useful (and only shown by the templates) once there's
      // more than one feed to tell apart
      const tagged = parsed.items.map(function (item) {
        item.__sourceTitle = parsed.feedTitle;
        return item;
      });
      allRawItems = allRawItems.concat(tagged);
    }
  }

  // merge multiple feeds into one timeline, newest first - a no-op ordering-wise
  // when there's only a single feed, since feeds already publish newest-first
  allRawItems.sort(function (a, b) { return parsedTime(b) - parsedTime(a); });

  const items = allRawItems.slice(0, 6).map(normalize);
  while (items.length < 6) {
    items.push({ title: '', description: '', date: '', image: '', source: '' });
  }

  return {
    feed_title: feedTitles.join(', '),
    multi_source: feedTitles.length > 1,
    first: items[0],
    second: items[1],
    third: items[2],
    fourth: items[3],
    fifth: items[4],
    sixth: items[5],
    weather: weather
  };
}
