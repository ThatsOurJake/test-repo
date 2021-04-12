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
      content: btoa(JSON.stringify(newPkgJson)),
      sha: prevSha,
      branch: 'main', // develop
    })
    
};

// console.log(updatePackageJson('patch'));

(async () => {
  try {
    const pkgJsonSha = await getPackageJsonSha();
    const newPkgJson = updatePkgJsonVersion('patch');
    await updateRepoPkgJson(newPkgJson, pkgJsonSha);
  } catch (error) {
    console.error(`Error updating repo: ${error}`);
  }
})();
