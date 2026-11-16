---
title: Settings Coverage
subtitle: This title slide must NOT be generated
author: Test Author
date: 2026-11-16
lang: en
theme: bold
aspect: "4:3"
slideLevel: auto
split: manual
titleSlide: false
paginate: false
footer: Settings fixture
accent: "#e11d48"
css: ./assets/custom.css
---

# Language and theme

This deck uses `lang: en`, the `bold` theme and a 4:3 canvas (960×720). Every H1 is directly followed by body text and has no child headings, so `slideLevel` resolves to 1.

# Manual split

With `split: manual`, slides are created only by headings and `---`. This slide has too much content for one slide, but it must not be split. It is shrunk instead, down to 60%, and a warning is shown if that is still not enough.

- Headings decide where slides start
- Content that overflows is not split automatically
- Each list item here makes the slide a little taller
- The renderer shrinks the whole slide to fit
- A warning appears when the scale drops below the limit
- Explicit breaks with three dashes still work
- Layout selection is still automatic
- Only splitting is switched off
- Users choose this mode when they want full control
- This item makes the slide overflow
- This item makes the slide overflow even more
- This item makes the slide overflow even more

# Explicit break

Before the break.

---

After the break. The heading "Explicit break" is inherited.

# Accent color {.highlight}

The accent color is overridden with `accent: "#e11d48"`. The `.highlight` class comes from the custom CSS.

# No page numbers

`paginate: false` hides page numbers. The footer "Settings fixture" is still shown on every slide.
