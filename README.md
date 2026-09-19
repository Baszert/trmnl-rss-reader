# RSS Reader

Turn any RSS or Atom feed into your own personal newspaper. The latest story takes the headline spot, the rest follow below, with a little weather corner just like the real thing.

<a href="https://trmnl.com/recipes/410831"><img width="150" alt="Works with TRMNL" src="https://trmnl.com/images/brand/badges/light/works-with-trmnl/trmnl-badge-works-with-light.svg" /></a>

## Features
- RSS 2.0, RSS 1.0/RDF and Atom
- Combine multiple feeds into one timeline, sorted by date
- Picks up article images from media tags, enclosures or the article body
- Weather corner with today's temperature and forecast

## Settings
Feed URL(s), location, temperature unit, date and time format, language (12 languages) and heading font.

A serverless `transform.js` normalizes all feed formats. Weather from [Open-Meteo](https://open-meteo.com/).

### Develop locally

Templates and settings live in [`src/`](src/), ready for [trmnlp](https://github.com/usetrmnl/trmnlp):

```sh
gem install trmnl_preview
trmnlp serve
```

Questions or ideas? trmnl@achtnegen.nl or @Bastronautica on Discord.
