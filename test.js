#!/usr/bin/env node
const { Octokit } = require('@octokit/core');
const semverInc = require('semver/functions/inc');
const btoa = require('btoa');

const TOKEN = process.env.TOKEN;

const octokit = new Octokit({ auth: TOKEN });

const repo = {
  owner: 'jki12',
  repo: 'test-repo',
};

const updatePkgJsonVersion = (versionType) => {
  const pkgJson = require('./package.json');
  const currentVersion = pkgJson.version;

  const validVersionTypes = ['minor', 'major', 'patch'];

  if (!validVersionTypes.includes(versionType.toLowerCase())) {
    throw new Error(`${versionType} is not valid, must be one of the following: minor, major, patch`);
  }

  return {
    ...pkgJson,
    version: semverInc(currentVersion, versionType),
  };
};

const getPackageJsonSha = () => {
  return octokit
    .request('GET /repos/{owner}/{repo}/contents/{path}', {
      ...repo,
      path: 'package.json',
      ref: 'main' // develop
    })
    .then(res => res.data.sha);
}

const updateRepoPkgJson = (newPkgJson, prevSha) => {
  return octokit
    .request('PUT /repos/{owner}/{repo}/contents/{path}', {
      ...repo,
      path: 'package.json',
      message: `Bump version to ${newPkgJson.version}`,
      content: btoa(JSON.stringify(newPkgJson, null, 2)),
      sha: prevSha,
      branch: 'main', // develop
    })
    .then(res => res.data.commit.sha);
};

const createTag = (commitSha, version) => {
  return octokit
    .request('POST /repos/{owner}/{repo}/git/tags', {
      ...repo,
      tag: `v${version}`,
      message: `v${version}`,
      object: commitSha,
      type: 'commit',
    }).then(res => {
      const { sha, tag } = res.data;
      return octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        ...repo,
        sha,
        ref: `refs/tags/${tag}`,
      })
    })
};

const getCommitDate = (sha) => {
  return octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    ...repo,
    ref: sha
  }).then(res => res.data.commit.author.date)
}

const getLastTag = () => {
  return octokit
    .request('GET /repos/{owner}/{repo}/tags', {
      ...repo,
      per_page: 1,
    })
    .then(res => {
      if (res.data.length > 0) {
        return res.data[0]
      }
    });
};

const getLastTagDate = async () => {
  const lastTag = await getLastTag();

  if (lastTag) {
    const { sha } = lastTag.commit;
    return await getCommitDate(sha);
  } else {
    return new Date(2000, 01, 01).toISOString();
  }
};

const createAndCommitPkgJson = async () => {
  const pkgJsonSha = await getPackageJsonSha();
  const newPkgJson = updatePkgJsonVersion('patch');

  console.log(`Updated version: ${newPkgJson.version}`);

  const newPkgJsonSha = await updateRepoPkgJson(newPkgJson, pkgJsonSha);
  return {
    pkgJsonSha: newPkgJsonSha,
    newVersion: newPkgJson.version,
  }
}

const getMergedPrsSinceDate = (fromDate) => {
  return octokit
    .request('GET /repos/{owner}/{repo}/pulls', {
      ...repo,
      head: 'main', // develop
      state: 'closed',
      sort: 'updated'
    }).then(res => res.data.filter(pr => {
      const mergedAt = new Date(pr.merged_at);
      return mergedAt > new Date(fromDate);
    }).map(pr => ({
      url: pr.html_url,
      title: pr.title,
    })));
}

const constructPrMessage = (prs = []) => {
  if (prs.length > 0) {
    let baseStr = '# Change log 🚀\n';
    baseStr += prs.map(pr => `- ${pr.title}: ${pr.url}`).join('\n');
    return baseStr;
  }

  return `# Change log 🚀\n *No PRs found please update manually!*`;
};

const createPullRequest = (prs, version) => {
  return octokit
    .request('POST /repos/{owner}/{repo}/pulls', {
      ...repo,
      title: `v${version}`,
      head: 'main', //develop,
      base: 'release', // master
      body: constructPrMessage(prs),
      maintainer_can_modify: true,
    }).then(res => res.data.html_url);
};

const submitPr = async (version) => {
  const lastTagDate = await getLastTagDate();
  console.log(`Last Release: ${lastTagDate}`);
  const prs = await getMergedPrsSinceDate(lastTagDate);
  console.log(`Prs found: ${prs.length}`);
  return await createPullRequest(prs, version);
}

(async () => {
  try {
    /*
      Update PackageJSON
      Upload it to the repo
      Get commits since last tag
      Create repo with these commit titles
      Create Tag
    */

    const { newVersion, pkgJsonSha } = await createAndCommitPkgJson();
    const prUrl = await submitPr(newVersion);
    await createTag(pkgJsonSha, newVersion);

    console.log(`PR created @ ${prUrl}`);
  } catch (error) {
    console.error(`Error updating repo: ${error}`);
  }
})();
