# E-Learning Engine — v0.2.0

A reusable engine that renders a whole course from one JSON config file.
Content stays in the config; all functionality lives in the engine.

**Live demo:** https://payneaustinroberts-ship-it.github.io/e-learning-engine/demo/ — try both courses in your browser, no LMS needed.

## What's here

```
elearning-engine/
├── schemas/course-config.schema.json  # the build contract (v0.1.0)
├── src/
│   ├── engine.js      # renderer, navigation, state, scoring, resume gate
│   ├── scorm.js       # SCORM 1.2 wrapper (+ localStorage fallback for testing)
│   ├── validation.js  # config check — same code runs in player and build
│   └── styles.css     # default theme (branding vars come from the config)
├── courses/
│   ├── demo-course/
│   │   └── config.json  # 5-screen demo: content, MCQ, 2-branch scenario, results
│   └── deescalation-basics/
│       └── config.json  # 6-screen second course: 2 MCQs, 3-branch scenario
│                        # (incl. negative score), 80% pass bar, own theme + logo
├── index.html         # dev player (add ?course=path/to/config.json to switch)
├── build.js           # validates + stages a SCORM 1.2 package into dist/
├── qa/
│   ├── qa-jsdom.js    # 44 functional checks — course 1 (incl. resume gate)
│   └── qa-jsdom2.js   # 31 functional checks — course 2 (theme, logo, 80% bar)
└── dist/              # build output (zipped for SCORM Cloud)
```

## Theming

Every course carries its own theme in `branding`: `primaryColor`,
`accentColor`, `backgroundColor`, `textColor`, `mutedColor`, `borderColor`,
`fontFamily`, and an optional `logo` (src + required alt text). The engine
maps these onto CSS variables — the second demo course ships a completely
different palette and logo with zero engine changes.

## Setup (Payne's checklist)

1. Install **Node.js LTS** from nodejs.org
2. Install **VS Code** from code.visualstudio.com
3. In VS Code, install the **Live Server** extension
4. Install **Git** (needed later for GitHub)
5. Create a **GitHub** account and a **SCORM Cloud** account (free trial)

## Run it locally

1. Open the `elearning-engine` folder in VS Code
2. Right-click `index.html` → **Open with Live Server**
3. Click through all 5 screens, try both scenario branches, close the tab mid-course and reopen — it should resume (localStorage fallback)

## Build the SCORM package

```bash
node build.js --course demo-course
node build.js --course deescalation-basics
```

This validates the config and stages `dist/<courseId>/`.
Zip that folder and upload it to SCORM Cloud, then verify:

- [x] Completion status flips to completed/passed/failed (verified 2026-09-28)
- [x] Score reports correctly — perfect run and failing run (verified 2026-09-28)
- [x] Close the browser mid-course → relaunch → "Welcome back" resume gate

Functional QA: `cd qa && node qa-jsdom.js && node qa-jsdom2.js` — 75 checks,
all passing (2026-09-28).

## Authoring a new course

Copy `courses/demo-course/` to `courses/<new-name>/`, edit `config.json`,
run the validator via `node build.js --course <new-name>`. If the JSON has
errors, the player shows exactly what's wrong and where.

Screen types: `content` (text/list/image/video/callout blocks — images and
video **require** alt text), `multipleChoice` (one attempt, per-option
feedback), `scenario` (each choice needs consequence feedback and a `next`
screen), `results` (score, pass/fail, optional certificate).

## What's next (Phase 3)

- SCORM 2004 adapter alongside the 1.2 wrapper
- Internal event hooks (`engine:*`) are already dispatched for future xAPI/cmi5
- AI-assisted JSON authoring (the differentiator vs. Adapt Learning)

## Changelog

- **v0.2.0** (2026-09-28): second course from the untouched engine (proves
  reusability); resume gate ("Welcome back" prompt on relaunch with incomplete
  progress); config-driven theming extended (`mutedColor`, `borderColor`) and
  `branding.logo` now rendered in the header; hex color validation in the
  build/player validator.
