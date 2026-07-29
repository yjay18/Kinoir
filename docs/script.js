(() => {
  'use strict';

  const DEFAULT_REPOSITORY = 'yjay18/Kinoir';

  function repositoryForPage() {
    if (location.hostname === 'yjay18.github.io') {
      const project = location.pathname.split('/').filter(Boolean)[0];
      if (project) return `yjay18/${project}`;
    }
    return DEFAULT_REPOSITORY;
  }

  const repository = repositoryForPage();
  const repositoryUrl = `https://github.com/${repository}`;
  const releasesUrl = `${repositoryUrl}/releases/latest`;

  document.querySelectorAll('[data-github-link]').forEach(link => { link.href = repositoryUrl; });
  document.querySelectorAll('[data-docs-link]').forEach(link => { link.href = `${repositoryUrl}#readme`; });
  document.querySelectorAll('[data-license-link]').forEach(link => { link.href = `${repositoryUrl}/blob/main/LICENSE`; });
  document.querySelectorAll('[data-release-notes]').forEach(link => { link.href = releasesUrl; });
  document.querySelectorAll('[data-download]').forEach(link => { link.href = releasesUrl; });
  document.querySelector('#current-year').textContent = String(new Date().getFullYear());

  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-button');
  const setHeaderState = () => header.classList.toggle('scrolled', scrollY > 20);
  setHeaderState();
  addEventListener('scroll', setHeaderState, { passive: true });

  menuButton.addEventListener('click', () => {
    const open = header.classList.toggle('menu-open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  document.querySelectorAll('.site-nav a').forEach(link => link.addEventListener('click', () => {
    header.classList.remove('menu-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
  }));

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -45px' });
    revealItems.forEach(item => observer.observe(item));
  } else {
    revealItems.forEach(item => item.classList.add('visible'));
  }

  const themeColours = {
    aurora: '#07080d',
    ember: '#0d0908',
    ocean: '#041015',
    graphite: '#090b0e',
    daylight: '#e9edf2'
  };
  const themeDemo = document.querySelector('[data-theme-demo]');
  const themeChoices = [...document.querySelectorAll('[data-theme-choice]')];
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const applyTheme = (theme, persist = true) => {
    if (!Object.hasOwn(themeColours, theme)) return;
    document.documentElement.dataset.siteTheme = theme;
    if (themeDemo) themeDemo.dataset.themeDemo = theme;
    if (themeMeta) themeMeta.content = themeColours[theme];

    themeChoices.forEach(choice => {
      const selected = choice.dataset.themeChoice === theme;
      choice.classList.toggle('active', selected);
      choice.setAttribute('aria-checked', String(selected));
      choice.tabIndex = selected ? 0 : -1;
    });

    if (persist) {
      try { localStorage.setItem('kinoir-site-theme', theme); } catch {}
    }
  };

  applyTheme(document.documentElement.dataset.siteTheme || 'graphite', false);

  themeChoices.forEach(button => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
  });

  themeDemo?.addEventListener('keydown', event => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const current = themeChoices.findIndex(choice => choice.getAttribute('aria-checked') === 'true');
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = themeChoices.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % themeChoices.length;
    else next = (current - 1 + themeChoices.length) % themeChoices.length;

    const choice = themeChoices[next];
    choice.focus();
    applyTheme(choice.dataset.themeChoice);
  });

  const bytes = value => {
    if (!Number.isFinite(value) || value <= 0) return '';
    const mb = value / 1024 / 1024;
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  };

  const assetFor = (assets, architecture) => assets.find(asset => {
    const name = String(asset.name || '').toLowerCase();
    if (!name.endsWith('.dmg')) return false;
    return architecture === 'arm64'
      ? /arm64|aarch64|apple[-_ ]?silicon/.test(name)
      : /x64|x86_64|intel/.test(name);
  });

  async function loadRelease() {
    try {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = await response.json();
      const version = String(release.tag_name || '').replace(/^v/, '');
      const assets = Array.isArray(release.assets) ? release.assets : [];

      document.querySelectorAll('[data-release-version]').forEach(node => {
        node.textContent = version ? `Version ${version}` : 'Latest release';
      });
      document.querySelectorAll('[data-release-notes]').forEach(link => {
        link.href = release.html_url || releasesUrl;
      });

      ['arm64', 'x64'].forEach(architecture => {
        const asset = assetFor(assets, architecture);
        document.querySelectorAll(`[data-download="${architecture}"]`).forEach(link => {
          link.href = asset?.browser_download_url || release.html_url || releasesUrl;
          link.dataset.directAsset = asset ? 'true' : 'false';
        });
        document.querySelectorAll(`[data-asset-meta="${architecture}"]`).forEach(node => {
          const label = architecture === 'arm64' ? 'Apple Silicon' : 'Intel';
          node.textContent = asset
            ? `${version ? `Kinoir ${version}` : 'Latest'} · ${bytes(asset.size)} · DMG`
            : `${label} installer · View GitHub release`;
        });
      });
    } catch {
      document.querySelectorAll('[data-asset-meta]').forEach(node => {
        node.textContent = 'Available from GitHub Releases';
      });
      document.querySelectorAll('[data-release-version]').forEach(node => {
        node.textContent = 'Latest release';
      });
    }
  }

  loadRelease();
})();
