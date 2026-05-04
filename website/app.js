import brandMarkUrl from "../assets/icon.svg";

const repoOwner = "d-evil0per";
const repoName = "inkover";
const repoPage = `https://github.com/${repoOwner}/${repoName}`;
const releasesPage = `https://github.com/${repoOwner}/${repoName}/releases`;
const actionsPage = `https://github.com/${repoOwner}/${repoName}/actions`;
const releasesApi = `https://api.github.com/repos/${repoOwner}/${repoName}/releases`;

const brandMark = document.getElementById("brand-mark");
if (brandMark instanceof HTMLElement) {
  const img = document.createElement("img");
  img.src = brandMarkUrl;
  img.alt = "InkOver logo";
  brandMark.appendChild(img);
}

const platformMatchers = {
  windows: (asset) => asset.name.endsWith(".exe") && !asset.name.endsWith(".blockmap"),
  macos: (asset) => asset.name.endsWith(".dmg") || asset.name.endsWith(".zip"),
  linux: (asset) => asset.name.endsWith(".AppImage") || asset.name.endsWith(".deb"),
};

const platformPriority = {
  windows: [".exe"],
  macos: [".dmg", ".zip"],
  linux: [".AppImage", ".deb"],
};

const releaseStatus = document.querySelector('[data-role="release-status"]');

function pickBestAsset(platform, assets) {
  const matches = assets.filter(platformMatchers[platform]);
  if (matches.length === 0) return null;

  const preferredExtensions = platformPriority[platform];
  matches.sort((left, right) => {
    const leftScore = preferredExtensions.findIndex((ext) => left.name.endsWith(ext));
    const rightScore = preferredExtensions.findIndex((ext) => right.name.endsWith(ext));
    return (leftScore === -1 ? 999 : leftScore) - (rightScore === -1 ? 999 : rightScore);
  });

  return matches[0];
}

function updateCard(platform, state) {
  const card = document.querySelector(`[data-platform="${platform}"]`);
  if (!(card instanceof HTMLElement)) return;

  const meta = card.querySelector('[data-role="meta"]');
  const button = card.querySelector('[data-role="button"]');
  if (!(meta instanceof HTMLElement) || !(button instanceof HTMLAnchorElement)) return;

  meta.textContent = state.meta;
  button.textContent = state.label;
  button.href = state.href;
}

function updateReleaseStatus(state) {
  if (!(releaseStatus instanceof HTMLElement)) return;
  const strong = releaseStatus.querySelector("strong");
  const description = releaseStatus.querySelector("p");
  const link = releaseStatus.querySelector("a");
  if (!(strong instanceof HTMLElement) || !(description instanceof HTMLElement) || !(link instanceof HTMLAnchorElement)) {
    return;
  }

  strong.textContent = state.title;
  description.textContent = state.description;
  link.textContent = state.label;
  link.href = state.href;
}

Object.keys(platformMatchers).forEach((platform) => {
  updateCard(platform, {
    meta: "Latest release lookup is in progress…",
    label: "Open Releases",
    href: releasesPage,
  });
});

updateReleaseStatus({
  title: "Checking release status…",
  description: "Looking for public installers and matching each OS to its current asset.",
  label: "Open Releases",
  href: releasesPage,
});

fetch(releasesApi)
  .then(async (response) => {
    if (!response.ok) {
      throw new Error(`Release lookup failed with ${response.status}`);
    }
    return response.json();
  })
  .then((releases) => {
    if (!Array.isArray(releases) || releases.length === 0) {
      updateReleaseStatus({
        title: "No public installers yet",
        description:
          "This repository has not published its first GitHub Release yet. Until then, keep the page live, point visitors to the source repo, or publish your first tagged release to activate the download cards.",
        label: "Build from Source",
        href: repoPage,
      });

      Object.keys(platformMatchers).forEach((platform) => {
        updateCard(platform, {
          meta: "First public release is still being prepared.",
          label: "Build from Source",
          href: repoPage,
        });
      });
      return;
    }

    const release = releases.find((entry) => !entry.draft && !entry.prerelease) ?? releases[0];
    const assets = Array.isArray(release.assets) ? release.assets : [];

    updateReleaseStatus({
      title: `${release.tag_name} is live`,
      description: "The cards below are mapped to the latest published installers for each supported platform.",
      label: "Read Release Notes",
      href: release.html_url || releasesPage,
    });

    Object.keys(platformMatchers).forEach((platform) => {
      const asset = pickBestAsset(platform, assets);
      if (!asset) {
        updateCard(platform, {
          meta: `No ${platform} asset is published in ${release.tag_name} yet.`,
          label: "Open Releases",
          href: releasesPage,
        });
        return;
      }

      updateCard(platform, {
        meta: `${release.tag_name} • ${asset.name}`,
        label: "Download",
        href: asset.browser_download_url,
      });
    });
  })
  .catch(() => {
    updateReleaseStatus({
      title: "Release lookup is temporarily unavailable",
      description:
        "GitHub did not return release data. Visitors can still browse the release history or inspect the source repo while the API recovers.",
      label: "View Release Pipeline",
      href: actionsPage,
    });

    Object.keys(platformMatchers).forEach((platform) => {
      updateCard(platform, {
        meta: "Release data is unavailable right now. Browse the published builds manually.",
        label: "Open Releases",
        href: releasesPage,
      });
    });
  });