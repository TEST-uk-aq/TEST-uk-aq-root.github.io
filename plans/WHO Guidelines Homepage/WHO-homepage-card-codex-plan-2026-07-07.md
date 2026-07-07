# UK AQ homepage WHO guideline summary card implementation plan

Date: 2026-07-07  
Target repo/page: UK AQ website homepage, `index.html`  
Implementation tool: VS Code Codex  
Phase: Website UI only, static data

## Goal

Add a new **WHO guideline summary** card to the UK AQ homepage, positioned above the existing **Highest sensor readings** dashboard.

This phase must not wire the card to Supabase, R2, or any live API. Use the fixed real values from the current DuckDB output so the homepage can preview the finished design while the derived WHO tables are still being built.

## Scope for this phase

Implement only the static homepage card.

Include:

- New WHO guideline summary card above the existing highest sensor readings card.
- Blue/cream styling from the approved mockup.
- Static real values from the DuckDB WHO summary output.
- Responsive desktop and mobile layout.
- Mobile toggle between **Rolling year** and **Last year**.
- Link button to the future WHO guideline page.
- Correct WHO button asset path.
- Accessible labels for the sections, bars and mobile tabs.

Do not include:

- Supabase queries.
- R2 reads.
- Database migrations.
- Derived WHO table creation.
- Dynamic loading state.
- Error handling for live WHO data.
- Display of `sensors_not_enough_data` on the homepage.

`sensors_not_enough_data` will be shown later on the main WHO page, not in this homepage card.

## Confirmed decisions

### Placement

Insert the WHO card inside `<main class="home-main">`, immediately before:

```html
<section class="readings-dashboard" aria-labelledby="highest-readings-heading">
```

The existing **Highest sensor readings** card should remain unchanged and should appear directly below the new WHO summary card.

### Card title

Use:

```text
WHO guideline summary
```

Do not use “WHO 2021” in the visible title.

### WHO button link

Use:

```html
<a class="who-page-button" href="/who-guidelines/" aria-label="Open the WHO guideline page">
  <img src="sidebar-images/UK-AQ-WHO-button-medium.svg" alt="WHO" />
</a>
```

The asset is in `sidebar-images` because it will also be used as a sidebar icon.

### Network/source pill

Use:

```text
GOV.UK AURN only
```

### Wording

Use **sensors**, not **sites**.

Use:

```text
Above guideline
Within guideline
Not enough data
```

Do not use:

```text
breach
breached
illegal
safe limits
```

### Note text

Use this footer note:

```text
Note: Daily averages use GMT days from midnight to midnight. “Above guideline” means above WHO health-based guidelines, not UK legal limits.
```

### WHO guideline values line

Show the guideline values as a non-expandable line under the note:

```text
WHO guideline values: PM2.5 daily 15 µg/m³, yearly 5 µg/m³ · PM10 daily 45 µg/m³, yearly 15 µg/m³ · NO₂ daily 25 µg/m³, yearly 10 µg/m³
```

### Visual style

Use the blue/cream mockup style.

The card should feel related to UK AQ, but visually separate from the live AQ reading colours. The percentage bars should use blue/grey, not the AQ heat palette.

## Static values to use

### Rolling year range

```text
03/07/2025 to 02/07/2026
```

### Rolling year, daily guideline

Meaning: sensors with more than 4 days above the WHO daily guideline in the latest 365 days.

| Pollutant | Percent | Count |
|---|---:|---:|
| PM2.5 | 97.2% | 141 of 145 sensors |
| PM10 | 7.4% | 10 of 135 sensors |
| NO₂ | 81.0% | 124 of 153 sensors |

### Rolling year, yearly guideline

Meaning: sensors where the latest 365-day average is above the WHO yearly guideline.

| Pollutant | Percent | Count |
|---|---:|---:|
| PM2.5 | 91.7% | 133 of 145 sensors |
| PM10 | 16.3% | 22 of 135 sensors |
| NO₂ | 71.2% | 109 of 153 sensors |

### Last full year

Range:

```text
01/01/2025 to 31/12/2025
```

Meaning: sensors where the full calendar-year average was above the WHO yearly guideline.

| Pollutant | Percent | Count |
|---|---:|---:|
| PM2.5 | 96.2% | 128 of 133 sensors |
| PM10 | 32.0% | 40 of 125 sensors |
| NO₂ | 79.6% | 121 of 152 sensors |

## Desktop layout

The desktop layout should have one overall WHO dashboard card containing:

1. Header row
   - Left: `WHO guideline summary`
   - Right: `GOV.UK AURN only` pill and WHO image button

2. Summary grid
   - Left/wide card: **Rolling year**
   - Right/narrow card: **Last full year**

3. Footer note
   - Note line
   - WHO guideline values line

### Rolling year card

The rolling year card should have a top row with:

- Left:
  - label: `Rolling year`
  - value: `Latest 365 days`
- Right:
  - date range pill: `Range 03/07/2025 to 02/07/2026`

Under that, split the card into two equal sections:

- Daily guideline
- Yearly guideline

Use a faint vertical divider between the two sections. The divider should not touch the top or bottom of the section area.

### Last full year card

Use:

- label: `Last full year`
- value: `2025`
- date range pill or compact range line: `Range 01/01/2025 to 31/12/2025`
- subtext: `Sensors where the full calendar-year average was above the WHO yearly guideline.`

The last full year card does not need to show daily guideline status.

## Mobile layout

At mobile widths, show a tab/toggle above the cards:

- `Rolling year`
- `Last year`

Only one card should be visible at a time:

- Rolling year visible by default.
- Last year hidden by default.
- Tapping each tab switches the visible card.

Use progressive enhancement with simple JavaScript. If JavaScript fails, it is acceptable for both cards to be visible, but the preferred behaviour is the toggle.

## Accessibility requirements

- Use a semantic `<section>` for the whole WHO dashboard card.
- Use a real heading, for example:

```html
<h2 class="who-title" id="who-guideline-title">WHO guideline summary</h2>
```

- Use `aria-labelledby="who-guideline-title"` on the WHO section.
- The WHO image button should have `aria-label="Open the WHO guideline page"`.
- The `<img>` alt should be `WHO`.
- The mobile toggle should use `role="tablist"`, with buttons using `role="tab"` and `aria-selected`.
- Each bar should have a useful `aria-label`, for example:

```text
97.2 percent of PM2.5 AURN sensors above WHO daily guideline
```

- Use `NO<sub>2</sub>` in visual HTML where appropriate, but use `NO2` in aria labels.

## Suggested implementation steps for Codex

### Step 1: Add CSS to `index.html`

Add WHO card CSS inside the existing `<style>` block in `index.html`.

Prefer prefixing all new classes with `who-` to avoid clashes.

Reuse the approved mockup class structure where practical:

- `.who-dashboard-card`
- `.who-card-header`
- `.who-title-group`
- `.who-title`
- `.who-header-actions`
- `.who-source-pill`
- `.who-page-button`
- `.who-toggle`
- `.who-summary-grid`
- `.who-rolling-card`
- `.who-summary-card`
- `.who-rolling-card-header`
- `.who-date-pill`
- `.who-date-pill-label`
- `.who-rolling-sections`
- `.who-rolling-section`
- `.who-pollutant-list`
- `.who-pollutant-row`
- `.who-pollutant-topline`
- `.who-pollutant-name`
- `.who-pollutant-count`
- `.who-pollutant-percent`
- `.who-bar`
- `.who-bar-fill`
- `.who-card-footer`
- `.who-guideline-values-line`

Keep colours close to the mockup:

```css
--who-surface: #ffffff;
--who-wrap: #FEFAF4;
--who-accent: #3C78AC;
--who-accent-deep: #285A84;
--who-line: #e4e6ea;
--who-line-soft: #eef0f3;
--who-bar-grey: #d0d4da;
```

You can either define these as local CSS variables on `.who-dashboard-card`, or use direct values.

Important style details:

- Outer card border radius around `18px`.
- Inner card border radius around `10px`.
- Pills should have reduced rounded corners, around `8px`, not fully rounded.
- Percentage bars can be fully rounded.
- The rolling card divider should be faint and should not reach the top or bottom.
- On desktop, use a two-column grid: rolling card wider, last-year card narrower.
- On tablet/mobile, stack cards.
- On mobile, hide inactive card according to `.is-active`.

### Step 2: Insert WHO card HTML above highest readings

Insert the new WHO card as the first child inside `<main class="home-main">`, before the existing highest sensor readings section.

Use this structure as the source of truth, adapted to the existing page style where needed:

```html
<section class="who-dashboard-card" aria-labelledby="who-guideline-title">
  <div class="who-card-header">
    <div class="who-title-group">
      <h2 class="who-title" id="who-guideline-title">WHO guideline summary</h2>
    </div>
    <div class="who-header-actions">
      <span class="who-source-pill">GOV.UK AURN only</span>
      <a class="who-page-button" href="/who-guidelines/" aria-label="Open the WHO guideline page">
        <img src="sidebar-images/UK-AQ-WHO-button-medium.svg" alt="WHO" />
      </a>
    </div>
  </div>

  <div class="who-toggle" role="tablist" aria-label="WHO guideline summary range">
    <button type="button" role="tab" aria-selected="true" aria-controls="who-card-rolling-combined" data-who-tab="rolling-combined">Rolling year</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="who-card-last-year" data-who-tab="last-year">Last year</button>
  </div>

  <div class="who-summary-grid">
    <article class="who-rolling-card is-active" id="who-card-rolling-combined" data-who-card="rolling-combined">
      <div class="who-rolling-card-header">
        <div class="who-rolling-title">
          <div class="who-summary-label">Rolling year</div>
          <div class="who-summary-value">Latest 365 days</div>
        </div>
        <span class="who-date-pill"><span class="who-date-pill-label">Range</span> 03/07/2025 to 02/07/2026</span>
      </div>

      <div class="who-rolling-sections">
        <section class="who-rolling-section" aria-labelledby="who-daily-heading">
          <div class="who-summary-card-header">
            <div class="who-summary-label" id="who-daily-heading">Daily guideline</div>
            <div class="who-summary-subtext">Sensors with more than 4 days above the WHO daily guideline in the latest 365 days.</div>
          </div>
          <div class="who-pollutant-list">
            <div class="who-pollutant-row">
              <div class="who-pollutant-topline">
                <span class="who-pollutant-name">PM2.5</span>
                <span class="who-pollutant-count">141 of 145 sensors</span>
                <span class="who-pollutant-percent">97.2%</span>
              </div>
              <div class="who-bar" aria-label="97.2 percent of PM2.5 AURN sensors above WHO daily guideline"><span class="who-bar-fill" style="--pct: 97.2%"></span></div>
            </div>

            <div class="who-pollutant-row">
              <div class="who-pollutant-topline">
                <span class="who-pollutant-name">PM10</span>
                <span class="who-pollutant-count">10 of 135 sensors</span>
                <span class="who-pollutant-percent">7.4%</span>
              </div>
              <div class="who-bar" aria-label="7.4 percent of PM10 AURN sensors above WHO daily guideline"><span class="who-bar-fill" style="--pct: 7.4%"></span></div>
            </div>

            <div class="who-pollutant-row">
              <div class="who-pollutant-topline">
                <span class="who-pollutant-name">NO<sub>2</sub></span>
                <span class="who-pollutant-count">124 of 153 sensors</span>
                <span class="who-pollutant-percent">81.0%</span>
              </div>
              <div class="who-bar" aria-label="81.0 percent of NO2 AURN sensors above WHO daily guideline"><span class="who-bar-fill" style="--pct: 81.0%"></span></div>
            </div>
          </div>
        </section>

        <section class="who-rolling-section" aria-labelledby="who-yearly-heading">
          <div class="who-summary-card-header">
            <div class="who-summary-label" id="who-yearly-heading">Yearly guideline</div>
            <div class="who-summary-subtext">Sensors where the latest 365-day average is above the WHO yearly guideline.</div>
          </div>
          <div class="who-pollutant-list">
            <div class="who-pollutant-row">
              <div class="who-pollutant-topline">
                <span class="who-pollutant-name">PM2.5</span>
                <span class="who-pollutant-count">133 of 145 sensors</span>
                <span class="who-pollutant-percent">91.7%</span>
              </div>
              <div class="who-bar" aria-label="91.7 percent of PM2.5 AURN sensors above WHO yearly guideline"><span class="who-bar-fill" style="--pct: 91.7%"></span></div>
            </div>

            <div class="who-pollutant-row">
              <div class="who-pollutant-topline">
                <span class="who-pollutant-name">PM10</span>
                <span class="who-pollutant-count">22 of 135 sensors</span>
                <span class="who-pollutant-percent">16.3%</span>
              </div>
              <div class="who-bar" aria-label="16.3 percent of PM10 AURN sensors above WHO yearly guideline"><span class="who-bar-fill" style="--pct: 16.3%"></span></div>
            </div>

            <div class="who-pollutant-row">
              <div class="who-pollutant-topline">
                <span class="who-pollutant-name">NO<sub>2</sub></span>
                <span class="who-pollutant-count">109 of 153 sensors</span>
                <span class="who-pollutant-percent">71.2%</span>
              </div>
              <div class="who-bar" aria-label="71.2 percent of NO2 AURN sensors above WHO yearly guideline"><span class="who-bar-fill" style="--pct: 71.2%"></span></div>
            </div>
          </div>
        </section>
      </div>
    </article>

    <article class="who-summary-card" id="who-card-last-year" data-who-card="last-year">
      <div class="who-summary-card-header">
        <div class="who-summary-label">Last full year</div>
        <div class="who-summary-value">2025</div>
        <span class="who-date-pill"><span class="who-date-pill-label">Range</span> 01/01/2025 to 31/12/2025</span>
        <div class="who-summary-subtext">Sensors where the full calendar-year average was above the WHO yearly guideline.</div>
      </div>
      <div class="who-pollutant-list">
        <div class="who-pollutant-row">
          <div class="who-pollutant-topline">
            <span class="who-pollutant-name">PM2.5</span>
            <span class="who-pollutant-count">128 of 133 sensors</span>
            <span class="who-pollutant-percent">96.2%</span>
          </div>
          <div class="who-bar" aria-label="96.2 percent of PM2.5 AURN sensors above WHO yearly guideline in 2025"><span class="who-bar-fill" style="--pct: 96.2%"></span></div>
        </div>

        <div class="who-pollutant-row">
          <div class="who-pollutant-topline">
            <span class="who-pollutant-name">PM10</span>
            <span class="who-pollutant-count">40 of 125 sensors</span>
            <span class="who-pollutant-percent">32.0%</span>
          </div>
          <div class="who-bar" aria-label="32.0 percent of PM10 AURN sensors above WHO yearly guideline in 2025"><span class="who-bar-fill" style="--pct: 32.0%"></span></div>
        </div>

        <div class="who-pollutant-row">
          <div class="who-pollutant-topline">
            <span class="who-pollutant-name">NO<sub>2</sub></span>
            <span class="who-pollutant-count">121 of 152 sensors</span>
            <span class="who-pollutant-percent">79.6%</span>
          </div>
          <div class="who-bar" aria-label="79.6 percent of NO2 AURN sensors above WHO yearly guideline in 2025"><span class="who-bar-fill" style="--pct: 79.6%"></span></div>
        </div>
      </div>
    </article>
  </div>

  <div class="who-card-footer">
    <div><strong>Note:</strong> Daily averages use GMT days from midnight to midnight. “Above guideline” means above WHO health-based guidelines, not UK legal limits.</div>
    <div class="who-guideline-values-line" aria-label="WHO guideline values">
      <strong>WHO guideline values:</strong>
      <span>PM2.5 daily 15 µg/m³, yearly 5 µg/m³</span>
      <span aria-hidden="true">·</span>
      <span>PM10 daily 45 µg/m³, yearly 15 µg/m³</span>
      <span aria-hidden="true">·</span>
      <span>NO<sub>2</sub> daily 25 µg/m³, yearly 10 µg/m³</span>
    </div>
  </div>
</section>
```

### Step 3: Add mobile toggle JavaScript

There is already inline JavaScript at the bottom of `index.html` for tool-card title switching. Add a separate small IIFE before that existing script block, or inside a new `<script>` block near the bottom before `sidebar.js`.

Use:

```js
(() => {
  const tabs = Array.from(document.querySelectorAll('[data-who-tab]'));
  const cards = Array.from(document.querySelectorAll('[data-who-card]'));
  if (!tabs.length || !cards.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.whoTab;
      tabs.forEach((button) => {
        button.setAttribute('aria-selected', String(button === tab));
      });
      cards.forEach((card) => {
        card.classList.toggle('is-active', card.dataset.whoCard === target);
      });
    });
  });
})();
```

This should not touch the existing dashboard JavaScript or network picker JavaScript.

### Step 4: Add image preload

In the `<head>`, add a preload line for the WHO button image near the other image preloads:

```html
<link rel="preload" as="image" href="/sidebar-images/UK-AQ-WHO-button-medium.svg" />
```

Use the same path style as the other sidebar image preloads.

### Step 5: Verify desktop behaviour

Check at desktop width:

- WHO card appears above Highest sensor readings.
- Rolling year card is wider than the Last full year card.
- Rolling year contains two side-by-side sections.
- The vertical divider is faint and does not reach the top or bottom.
- Range pill is on the same row as `Rolling year` / `Latest 365 days`.
- WHO image button is on the top right with the `GOV.UK AURN only` pill.
- Blue bars match the supplied percentages.
- Text uses “sensors” everywhere.

### Step 6: Verify mobile behaviour

Check at mobile width:

- Header stacks cleanly.
- WHO button does not overflow.
- Toggle appears.
- Rolling year is visible by default.
- Last year is hidden by default.
- Tapping `Last year` shows the last year card.
- Tapping `Rolling year` restores the rolling year card.
- No horizontal scrolling is introduced by the WHO card.

### Step 7: Avoid accidental changes

Do not change:

- Existing highest sensor readings data loading.
- Existing `dashboard.js` behaviour.
- Existing network picker.
- Existing area/network tables.
- Existing UK AQ tool cards.
- Existing Supabase placeholders.

## Acceptance criteria

The implementation is complete when:

- `index.html` contains a static WHO guideline summary card above the existing highest sensor readings card.
- The card uses the exact static values listed in this plan.
- The WHO button uses `src="sidebar-images/UK-AQ-WHO-button-medium.svg"`.
- The WHO button links to `/who-guidelines/`.
- The card uses blue/cream styling and blue/grey bars.
- The word “sites” does not appear in the new WHO card.
- The mobile toggle works.
- The existing homepage dashboard still loads and behaves as before.
- No Supabase/R2 WHO data wiring is added in this phase.

## Future phase, not part of this plan

A separate database/data plan should implement:

- Supabase derived tables:
  - `who_2021_daily_status`
  - `who_2021_rolling_year_status`
  - `who_2021_calendar_year_status`
- R2 parquet archive outputs for those derived tables.
- Daily backfill/update jobs.
- Homepage WHO summary view or API output.
- Dynamic website wiring.
- Main WHO guideline page with detailed tables, including `sensors_not_enough_data`.
