# Focuscut

A free, browser-only screen recorder and editor for builders. It records a web page, auto-zooms into inputs and buttons with smooth camera motion, adds page-info overlays, and exports a polished marketing video. No backend database. Recordings are stored locally. Deploys for $0.

## Quick start

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

## Tech stack

- Vite + React 18 + TypeScript (strict)
- Tailwind CSS with design tokens
- Zustand, Immer
- Canvas 2D rendering
- WebCodecs for export
- IndexedDB for local storage
- Cloudflare Pages

## Privacy

All recordings and projects are stored locally in your browser. Nothing is uploaded. The only optional network call is page analysis.
