(() => {
  try {
    const embedded = window.parent && window.parent !== window;
    if (embedded) {
      return;
    }
  } catch (error) {
    return;
  }

  // ─── Nav config ──────────────────────────────────────────────────────────────
  const NAV = [
    {
      id: 'uk-aq',
      label: 'UK-AQ',
      children: [
        { label: 'Hex Map',     iconImg: 'uk-aq-hex-map-icon.svg', href: '/uk-aq/hex_map.html' },
        { label: 'Sensors',     iconImg: 'uk-aq-sensors-icon.svg',  href: '/uk-aq/sensors_chart.html' },
        { label: 'Sensors Map', iconImg: 'uk-aq-map-icon.svg',       href: '/uk-aq/sensors_map.html' },
      ],
    },
    {
      id: 'data-explorer',
      label: 'Data Explorer',
      children: [
        { label: 'Bubble Chart',       iconImg: 'Bubble-Chart-Icon.svg', href: '/data-explorer/?page=bubblechart' },
        { label: 'Line Chart',         iconImg: 'Line-Chart-Icon.svg', href: '/data-explorer/?page=linechart' },
        { label: 'Ecodesign Replaces', iconImg: 'Stove Ecodesign 430x683.svg', href: '/data-explorer/?page=eco-replaces-all', className: 'cic-nav-item--eco-replaces' },
        { label: 'Category Info',      iconImg: 'Category Info - Icon.svg', href: '/data-explorer/category-info/' },
        { label: 'User Guide',         iconImg: 'user-guide.svg', href: '/data-explorer/user-guide/' },
      ],
    },
    {
      id: 'quick-links',
      showLabel: false,
      dividerBefore: true,
      children: [
        {
          label: 'YouTube',
          iconImg: 'youtube-logo.svg',
          labelImg: 'youtube-logo-Word.svg',
          href: 'https://youtube.com/@chronicillnesschannel',
          external: true,
        },
        { label: 'Resources', iconImg: 'chain-link-icon-grey.svg', href: '/resources/' },
        { label: 'Contact', iconImg: 'Contacts-Email-icon-cic-web.svg', href: '/contact.html' },
      ],
    },
  ];
  const HOME_ITEM = {
    label: 'Home',
    iconImg: 'CIC-Home-Alpha.svg',
    href: '/',
    className: 'cic-home-nav-item',
  };
  const SIDEBAR_ICON_OFF = '/sidebar-images/CIC-Sidebar-Button-off.svg';
  const SIDEBAR_ICON_ON = '/sidebar-images/CIC-Sidebar-Button-on.svg';

  // ─── Preload default sidebar button image; lazy-warm the alternate icon ─────
  const sidebarIconOffHref = location.origin + SIDEBAR_ICON_OFF;
  if (!document.head.querySelector(`link[rel="preload"][as="image"][href="${sidebarIconOffHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = sidebarIconOffHref;
    document.head.appendChild(link);
  }
  const warmSidebarOnIcon = () => {
    const img = new Image();
    img.src = location.origin + SIDEBAR_ICON_ON;
  };
  if (document.readyState === 'complete') {
    warmSidebarOnIcon();
  } else {
    window.addEventListener('load', warmSidebarOnIcon, { once: true });
  }

  // ─── State ────────────────────────────────────────────────────────────────────
  const EXPANDED  = 'expanded';
  const COLLAPSED = 'collapsed';
  const MINI      = 'mini';
  const DRAWER    = 'drawer';

  let autoCollapseTimer = null;
  let pinnedOpenDesktop = false;

  function getBreakpoint() {
    const w = window.innerWidth;
    if (w < 768)  return 'mobile';
    if (w < 1100) return 'tablet';
    return 'desktop';
  }

  function isHomePage() {
    const p = location.pathname;
    return p === '/' || p === '/index.html' || p === '';
  }

  function getState() {
    return document.body.getAttribute('data-sidebar-state');
  }

  function setState(state) {
    document.body.setAttribute('data-sidebar-state', state);
    const overlay = document.getElementById('cic-sidebar-overlay');
    if (overlay) overlay.classList.toggle('visible', state === DRAWER);
  }

  function scheduleAutoCollapse() {
    clearTimeout(autoCollapseTimer);
    autoCollapseTimer = setTimeout(() => {
      if (getBreakpoint() === 'desktop' && !pinnedOpenDesktop && getState() === EXPANDED) {
        setState(MINI);
      }
    }, 3000);
  }

  function updateHamburgerIcon(btn) {
    const img = btn?.querySelector('img');
    if (!img) return;
    const mobileOpen = getBreakpoint() === 'mobile' && document.body.classList.contains('cic-drawer-open');
    const shouldShowOn = pinnedOpenDesktop || mobileOpen;
    const target = `${location.origin}${shouldShowOn ? SIDEBAR_ICON_ON : SIDEBAR_ICON_OFF}`;
    if (img.src !== target) img.src = target;
  }

  // ─── CSS ──────────────────────────────────────────────────────────────────────
  const CSS = `
    :root {
      --cic-accent:        #3C78AC;
      --cic-accent-deep:   #285A84;
      --cic-ink:           #101822;
      --cic-ink-1:         #1b2a38;
      --cic-ink-2:         #3a4a5a;
      --cic-ink-3:         #6b7a88;
      --cic-ink-4:         #9aa7b3;
      --cic-line:          #e4e6ea;
      --cic-line-soft:     #eef0f3;
      --cic-surface:       #ffffff;
      --cic-surface-2:     #fbfaf6;
      --cic-w:             232px;
      --cic-mini-w:        64px;
      --cic-drawer-w:      280px;
      --cic-ease:          0.3s ease;
      --cic-font:          'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* ── Body shift ── */
    body {
      transition: padding-left var(--cic-ease);
    }
    body[data-sidebar-state="expanded"]  { padding-left: var(--cic-w); }
    body[data-sidebar-state="collapsed"] { padding-left: 0; }
    body[data-sidebar-state="mini"]      { padding-left: var(--cic-mini-w); }
    body[data-sidebar-state="drawer"]    { padding-left: 0; }

    /* ── Sidebar panel ── */
    #cic-sidebar {
      position: fixed;
      top: 0; left: 0;
      height: 100vh;
      width: var(--cic-w);
      background: var(--cic-surface);
      border-right: 1px solid var(--cic-line);
      display: flex;
      flex-direction: column;
      z-index: 10010;
      overflow-y: auto;
      overflow-x: hidden;
      transition: transform var(--cic-ease), width var(--cic-ease);
      font-family: var(--cic-font);
    }

    body[data-sidebar-state="collapsed"] #cic-sidebar {
      transform: translateX(calc(-1 * var(--cic-w)));
    }
    body[data-sidebar-state="mini"] #cic-sidebar {
      width: var(--cic-mini-w);
      transform: none;
    }
    body[data-sidebar-state="drawer"] #cic-sidebar {
      width: var(--cic-drawer-w);
      transform: translateX(calc(-1 * var(--cic-drawer-w)));
    }
    body[data-sidebar-state="drawer"].cic-drawer-open #cic-sidebar {
      transform: translateX(0);
    }

    /* ── Overlay (mobile drawer backdrop) ── */
    #cic-sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(16,24,34,0.35);
      z-index: 10009;
      opacity: 0;
      transition: opacity var(--cic-ease);
    }
    #cic-sidebar-overlay.visible        { display: block; }
    body.cic-drawer-open #cic-sidebar-overlay { opacity: 1; }

    /* ── Hamburger button ── */
    #cic-hamburger {
      position: fixed;
      top: 16px; left: 10px;
      z-index: 10012;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: 25%;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    #cic-hamburger:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 14px rgba(20,34,37,0.12);
    }
    #cic-hamburger img { width: 44px; height: 44px; object-fit: contain; display: block; }

    /* ── Top-right CIC home logo ── */
    #cic-home-logo {
      position: absolute;
      top: 16px; right: 28px;
      z-index: 10011;
      display: block;
      border-radius: 16px;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    #cic-home-logo:hover { transform: translateY(-1px); box-shadow: 0 8px 14px rgba(20,34,37,0.12); }
    #cic-home-logo img {
      width: 104px; height: 104px;
      object-fit: contain; display: block;
    }

    /* ── Nav ── */
    .cic-nav {
      flex: 1;
      padding: 68px 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .cic-home-nav-item {
      padding-left: 0;
      margin-left: -13px;
      margin-bottom: 0;
    }
    .cic-home-nav-item .cic-nav-icon-img {
      width: 44px !important;
      height: 44px !important;
      min-width: 44px !important;
      min-height: 44px !important;
      max-width: 44px !important;
      max-height: 44px !important;
    }
    .cic-home-nav-item + .cic-nav-section .cic-section-label {
      padding-top: 6px;
    }
    body[data-sidebar-state="mini"] .cic-home-nav-item {
      margin-left: 0;
    }

    .cic-section-divider {
      height: 0;
      border-top: 1px solid var(--cic-line);
      margin: 10px 12px 8px;
    }

    .cic-section-label {
      font-family: var(--cic-font);
      font-size: 20px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 700;
      padding: 14px 10px 5px;
      background: linear-gradient(285deg, #FF0000, #FEAE00);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    body[data-sidebar-state="mini"] .cic-section-label { display: none; }

    /* ── Nav items ── */
    .cic-nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 10px 9px 14px;
      border-radius: 7px;
      color: var(--cic-ink-2);
      font-size: 15px;
      font-weight: 500;
      font-family: var(--cic-font);
      text-decoration: none;
      border: 1px solid transparent;
      white-space: nowrap;
      overflow: hidden;
    }
    .cic-nav-item:hover {
      background: var(--cic-surface-2);
      color: var(--cic-ink-1);
      text-decoration: none;
    }
    .cic-nav-item.active {
      background: #FBFAF7;
      color: var(--cic-accent-deep);
      border-color: #d6d0c8;
    }
    .cic-nav-icon {
      width: 20px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-style: normal; font-size: 13px;
    }
    .cic-nav-icon-img {
      width: 40px !important;
      height: 40px !important;
      min-width: 40px !important;
      min-height: 40px !important;
      max-width: 40px !important;
      max-height: 40px !important;
      flex-shrink: 0;
      max-width: none !important;
      object-fit: contain;
      display: block;
    }
    .cic-nav-icon-placeholder {
      width: 34px;
      height: 34px;
      flex-shrink: 0;
      border: 2px dashed var(--cic-ink-4);
      border-radius: 10px;
      display: inline-block;
      opacity: 0.75;
    }
    .cic-nav-label-img {
      display: block;
      height: 16px !important;
      width: auto !important;
      max-width: 136px !important;
      max-height: 16px !important;
      object-fit: contain;
    }
    .cic-nav-label { overflow: hidden; text-overflow: ellipsis; }
    .cic-nav-item--eco-replaces .cic-nav-label {
      display: block;
      width: 92px;
      white-space: normal;
      line-height: 1.15;
      text-align: left;
      overflow: visible;
      text-overflow: clip;
    }

    body[data-sidebar-state="mini"] .cic-nav-label { display: none; }
    body[data-sidebar-state="mini"] .cic-nav-item  { padding: 11px; justify-content: center; }

    /* ── Footer ── */
    #cic-sidebar-footer {
      padding: 10px 14px 14px;
      border-top: 1px solid var(--cic-line-soft);
      font-size: 11px;
      font-family: var(--cic-font);
      color: var(--cic-ink-4);
      white-space: nowrap;
      overflow: hidden;
    }
    body[data-sidebar-state="mini"] #cic-sidebar-footer { display: none; }
  `;

  // ─── HTML builders ────────────────────────────────────────────────────────────
  const UK_AQ_ROOT_HOSTS = new Set([
    'uk-aq-beta.chronicillnesschannel.co.uk',
  ]);

  function resolveHref(href) {
    if (href === '#' || typeof href !== 'string') return href;
    if (!href.startsWith('/uk-aq/')) return href;
    const host = (location.hostname || '').toLowerCase();
    return UK_AQ_ROOT_HOSTS.has(host) ? href.replace(/^\/uk-aq/, '') : href;
  }

  function buildNavItem(item) {
    const path = location.pathname;
    const pathWithSearch = location.pathname + location.search;
    const href = resolveHref(item.href);
    const isActive = href !== '#' && (
      href === '/' || href === '/index.html'
        ? isHomePage()
        : (href.includes('?') ? pathWithSearch.includes(href) : path.includes(href))
    );
    const className = item.className ? ` ${item.className}` : '';
    const iconHtml = item.iconImg
      ? `<img class="cic-nav-icon-img" src="${location.origin}/sidebar-images/${item.iconImg}" alt="">`
      : item.iconPlaceholder
        ? `<span class="cic-nav-icon-placeholder" aria-hidden="true"></span>`
        : `<i class="cic-nav-icon">${item.icon}</i>`;
    const labelHtml = item.labelImg
      ? `<img class="cic-nav-label-img" src="${location.origin}/sidebar-images/${item.labelImg}" alt="${item.label}">`
      : item.label;
    const targetAttrs = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `
      <a class="cic-nav-item${className}${isActive ? ' active' : ''}" href="${href}"${targetAttrs}>
        ${iconHtml}
        <span class="cic-nav-label">${labelHtml}</span>
      </a>`;
  }

  function buildSection(section) {
    const childrenHtml = section.children.map(buildNavItem).join('');
    const sectionLabel = section.showLabel === false
      ? ''
      : `<div class="cic-section-label">${section.label}</div>`;
    const divider = section.dividerBefore ? '<div class="cic-section-divider" aria-hidden="true"></div>' : '';
    return `
      <div class="cic-nav-section">
        ${divider}
        ${sectionLabel}
        ${childrenHtml}
      </div>`;
  }

  function buildSidebar() {
    return `
      <nav class="cic-nav" aria-label="Site navigation">
        ${buildNavItem(HOME_ITEM)}
        ${NAV.map(buildSection).join('')}
      </nav>
      <div id="cic-sidebar-footer">
        cic-test.chronicillnesschannel.co.uk · v2026.04
      </div>`;
  }

  // ─── Mount ────────────────────────────────────────────────────────────────────
  function mount() {
    // Inter font
    if (!document.getElementById('cic-inter-font')) {
      const link = document.createElement('link');
      link.id = 'cic-inter-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    // Injected styles
    const style = document.createElement('style');
    style.id = 'cic-sidebar-styles';
    style.textContent = CSS;
    document.head.appendChild(style);

    // Sidebar panel
    const aside = document.createElement('aside');
    aside.id = 'cic-sidebar';
    aside.setAttribute('aria-label', 'Site navigation');
    aside.innerHTML = buildSidebar();

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'cic-sidebar-overlay';

    // Hamburger button
    const btn = document.createElement('button');
    btn.id = 'cic-hamburger';
    btn.setAttribute('aria-label', 'Toggle navigation');
    btn.innerHTML = `<img src="${location.origin}${SIDEBAR_ICON_OFF}" alt="Menu">`;

    // Top-right home logo (hidden on homepage)
    const homeLogo = isHomePage() ? null : (() => {
      const el = document.createElement('a');
      el.id = 'cic-home-logo';
      el.href = '/';
      el.setAttribute('aria-label', 'Chronic Illness Channel home');
      el.innerHTML = `<img src="${location.origin}/sidebar-images/CIC-Square-Border-Words-Alpha.svg" alt="CIC">`;
      return el;
    })();

    // Mount into placeholder or body
    const mountEl = document.getElementById('cic-sidebar-mount');
    if (mountEl) {
      mountEl.appendChild(aside);
      mountEl.appendChild(overlay);
      mountEl.appendChild(btn);
      if (homeLogo) mountEl.appendChild(homeLogo);
    } else {
      if (homeLogo) document.body.prepend(homeLogo);
      document.body.prepend(btn);
      document.body.prepend(overlay);
      document.body.prepend(aside);
    }

    // Initial state — suppress the body transition so the padding-left jump
    // doesn't cause a mid-flight layout shift before the hex map first renders.
    document.body.style.transition = 'none';
    const bp = getBreakpoint();
    pinnedOpenDesktop = false;
    if (bp === 'mobile') {
      setState(DRAWER);
    } else {
      setState(MINI);
    }
    document.body.offsetHeight; // force reflow, then restore CSS transition
    document.body.style.transition = '';
    updateHamburgerIcon(btn);

    bindEvents(btn, overlay);
  }

  // ─── Events ───────────────────────────────────────────────────────────────────
  function bindEvents(btn, overlay) {
    // Hamburger toggle
    btn.addEventListener('click', () => {
      const bp = getBreakpoint();
      if (bp === 'mobile') {
        document.body.classList.toggle('cic-drawer-open');
      } else {
        clearTimeout(autoCollapseTimer);
        if (pinnedOpenDesktop) {
          pinnedOpenDesktop = false;
          setState(MINI);
        } else {
          pinnedOpenDesktop = true;
          setState(EXPANDED);
        }
      }
      updateHamburgerIcon(btn);
    });

    // Close drawer on overlay click
    overlay.addEventListener('click', () => {
      document.body.classList.remove('cic-drawer-open');
      updateHamburgerIcon(btn);
    });

    // Left-edge hover re-expand (desktop)
    document.addEventListener('mousemove', e => {
      if (getBreakpoint() !== 'desktop') return;
      if (!pinnedOpenDesktop && e.clientX < 20 && (getState() === COLLAPSED || getState() === MINI)) {
        clearTimeout(autoCollapseTimer);
        setState(EXPANDED);
      }
    });

    // Cancel auto-collapse while mouse is inside sidebar
    document.getElementById('cic-sidebar').addEventListener('mouseenter', () => {
      clearTimeout(autoCollapseTimer);
    });

    // Resume auto-collapse on mouse leave (non-home pages)
    document.getElementById('cic-sidebar').addEventListener('mouseleave', () => {
      if (!pinnedOpenDesktop && getBreakpoint() === 'desktop' && getState() === EXPANDED) {
        scheduleAutoCollapse();
      }
    });

    // Responsive resize
    window.addEventListener('resize', () => {
      const bp = getBreakpoint();
      clearTimeout(autoCollapseTimer);
      if (bp === 'tablet') {
        setState(MINI);
        pinnedOpenDesktop = false;
        document.body.classList.remove('cic-drawer-open');
      } else if (bp === 'mobile') {
        setState(DRAWER);
        pinnedOpenDesktop = false;
        document.body.classList.remove('cic-drawer-open');
      } else if (getState() === MINI || getState() === DRAWER || getState() === COLLAPSED) {
        document.body.classList.remove('cic-drawer-open');
        setState(pinnedOpenDesktop ? EXPANDED : MINI);
      } else {
        setState(pinnedOpenDesktop ? EXPANDED : MINI);
      }
      updateHamburgerIcon(btn);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
