#!/usr/bin/env node
const { Octokit } = require('@octokit/core');
const semverInc = require('semver/functions/inc');
const btoa = require('btoa');

const octokit = new Octokit({ auth: process.env.GIT_TC_TOKEN });

const prPrefix = '[RELEASE]';

const [semVer] = process.argv.slice(2);
if (!semVer) {
  console.log('Usage: create-release <major|minor|patch>');
  process.exit(1);
}

const repo = {
  owner: 'ThatsOurJake',
  repo: 'test-repo',
};

const getCommitDate = async (sha) => {
  return octokit
    .request('GET /repos/{owner}/{repo}/commits/{ref}', {
      ...repo,
      ref: sha,
    })
    .then((res) => res.data.commit.author.date);
};

const getLastTag = async () => {
  return octokit
    .request('GET /repos/{owner}/{repo}/tags', {
      ...repo,
      per_page: 1,
    })
    .then(async (res) => {
      if (res.data.length > 0) {
        const tag = res.data[0]
        const { sha } = tag.commit;
        const lastTagDate = await getCommitDate(sha);
        return { lastTag: tag.name.slice(1), lastTagDate };
      }
    });
};

const updatePkgJsonVersion = async (versionType, lastTag) => {
  const pkgJson = require('./package.json');

  const validVersionTypes = ['minor', 'major', 'patch'];

  if (!validVersionTypes.includes(versionType.toLowerCase())) {
    throw new Error(`${versionType} is not valid, must be one of the following: minor, major, patch`);
  }

  return {
    ...pkgJson,
    version: semverInc(lastTag, versionType),
  };
};

const getPackageJsonSha = () => {
  return octokit
    .request('GET /repos/{owner}/{repo}/contents/{path}', {
      ...repo,
      path: 'package.json',
      ref: 'main',
    })
    .then((res) => res.data.sha);
};

const updateRepoPkgJson = (newPkgJson, prevSha) => {
  return octokit
    .request('PUT /repos/{owner}/{repo}/contents/{path}', {
      ...repo,
      path: 'package.json',
      message: `Bump version to ${newPkgJson.version}`,
      content: btoa(JSON.stringify(newPkgJson, null, 2)),
      sha: prevSha,
      branch: 'main',
    })
    .then((res) => res.data.commit.sha);
};

const createTag = (commitSha, version) => {
  return octokit
    .request('POST /repos/{owner}/{repo}/git/tags', {
      ...repo,
      tag: `v${version}`,
      message: `v${version}`,
      object: commitSha,
      type: 'commit',
    })
    .then((res) => {
      const { sha, tag } = res.data;
      return octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        ...repo,
        sha,
        ref: `refs/tags/${tag}`,
      });
    }).then((res) => {
      return res.data.ref;
    });
};

const createAndCommitPkgJson = async (lastTag) => {
  const pkgJsonSha = await getPackageJsonSha();
  const newPkgJson = await updatePkgJsonVersion(semVer, lastTag);

  console.log(`Updated version: ${newPkgJson.version}`);

  const newPkgJsonSha = await updateRepoPkgJson(newPkgJson, pkgJsonSha);
  return {
    pkgJsonSha: newPkgJsonSha,
    newVersion: newPkgJson.version,
  };
};

const getMergedPrsSinceDate = (fromDate) => {
  return octokit
    .request('GET /repos/{owner}/{repo}/pulls', {
      ...repo,
      head: 'main',
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
    })
    .then((res) =>
      res.data
        .filter((pr) => pr.merged_at)
        .filter((pr) => new Date(pr.merged_at) > new Date(fromDate))
        .filter((x) => !x.title.startsWith(prPrefix))
        .map((pr) => ({
          url: pr.html_url,
          title: pr.title,
        }))
    );
};

const constructPrMessage = (prs = []) => {
  if (prs.length > 0) {
    return ['# Change log 🚀', ...prs.map((pr) => `- ${pr.title}: ${pr.url}`)].join('\n');
  }

  return `# Change log 🚀\n *No PRs found please update manually!*`;
};

const createPullRequest = (prs, version) => {
  return octokit
    .request('POST /repos/{owner}/{repo}/pulls', {
      ...repo,
      title: `${prPrefix} v${version}`,
      head: 'main',
      base: 'release',
      body: constructPrMessage(prs),
      maintainer_can_modify: true,
    })
    .then((res) => res.data.html_url);
};

const submitPr = async (version, lastTagDate) => {
  console.log(`Last Release: ${lastTagDate}`);
  const prs = await getMergedPrsSinceDate(lastTagDate);
  console.log(`Prs found: ${prs.length}`);
  return createPullRequest(prs, version);
};

(async () => {
  try {
    /*
      Get Last Tag
      Update PackageJSON
      Upload it to the repo
      Get commits since last tag
      Create PR with these merged pr titles
      Create Tag
    */

    const { lastTag, lastTagDate } = await getLastTag()
    const { newVersion, pkgJsonSha } = await createAndCommitPkgJson(lastTag);
    await createTag(pkgJsonSha, newVersion);
    const prUrl = await submitPr(newVersion, lastTagDate);

    console.log(`PR created @ ${prUrl}`);
  } catch (error) {
    console.error(`Error updating repo: ${error}`);
    console.error(error.stack);
  }
})();
