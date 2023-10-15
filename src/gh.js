const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');

// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunners(label) {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const runners = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runners', config.githubContext);
    const foundRunners = _.filter(runners, { labels: [{ name: label }] });
    return foundRunners.length > 0 ? foundRunners : null;
  } catch (error) {
    core.error(`Error listing runners: ${error.toString()}`)
    return null;
  }
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', config.githubContext);
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}

async function removeRunners() {
  const runners = await getRunners(config.input.label);
  const octokit = github.getOctokit(config.input.githubToken);

  // skip the runner removal process if the runner is not found
  if (runners === null || runners.length === 0) {
    core.info(`GitHub self-hosted runner with label ${config.input.label} is not found, so the removal is skipped`);
    return;
  }
  core.info(`Found GitHub self-hosted runners: ${JSON.stringify(runners)}`);

  for(const runner of runners) {
    core.info(`Removing GitHub self-hosted runner ${JSON.stringify(runner)}`);
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', _.merge(config.githubContext, { runner_id: runner.id }));
      core.info(`GitHub self-hosted runner ${runner.name} is removed`);
    } catch (error) {
      core.error(`GitHub self-hosted runner ${runner.name} removal error`);
      throw error;
    }
  }
}

async function waitForRunnerRegistered(label) {
  const timeoutMinutes = 5;
  const retryIntervalSeconds = 5;
  const quietPeriodSeconds = 10;

  core.info(`Waiting ${quietPeriodSeconds}s for the AWS EC2 instance to be registered in GitHub as a new self-hosted runner`);
  await new Promise(r => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(`Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runner is registered`);

  return new Promise((resolve, reject) => {
    const startTime = new Date();
    const check = async () => {
      core.info('Checking...');
      const runners = await getRunners(label);

      if (runners && runners.length > 0 && runners[0].status === 'online') {
        core.info(`GitHub self-hosted runner ${runners[0].name} is registered and ready to use`);
        resolve();
      } else {
        const now = new Date();
        const elapsedMs = now - startTime;
        if (elapsedMs > timeoutMinutes * 60 * 1000) {
          core.error('GitHub self-hosted runner registration error');
          reject(`A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instance was not able to register itself in GitHub as a new self-hosted runner.`);
        } else {
          return setTimeout(() => check(), retryIntervalSeconds * 1000);
        }
      }
    };

    return check();
  });
}

module.exports = {
  getRegistrationToken,
  removeRunners,
  waitForRunnerRegistered,
};
