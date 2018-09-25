#!/usr/bin/env node
import Promise from 'bluebird';
import minimist from 'minimist';
import username from 'username';
import Api from 'kubernetes-client';
import { spawn } from 'child_process';

const argv = minimist(process.argv.slice(2), {
  boolean: ['restartable', 'take-traffic', 'retain'],
});

const kconf = Api.config.fromKubeconfig();
kconf.promises = true;

const ns = argv.namespace || 'default';
const core = new Api.Core(kconf);
const ext = new Api.Extensions({
  ...kconf,
  apiVersion: 'v1',
});

function log(...args) {
  if (!argv.quiet) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

async function isUp(name, retryCount) {
  const status = await core.ns(ns).po(name).get();
  const { status: { conditions } } = status;
  if (conditions && conditions.find(c => c.type === 'Ready' && c.status === 'True')) {
    log(`${name} is ready.`);
    return true;
  }
  await Promise.delay(1000);
  if (retryCount > 0) {
    return isUp(name, retryCount - 1);
  }
  return false;
}

async function run() {
  const name = argv._[0];
  const uname = await username();
  const { spec: { template: deployment } } = await ext
    .ns(ns)
    .deployments(argv._[0]).get({ export: true });

  Object.assign(deployment, {
    apiVersion: 'v1',
    kind: 'Pod',
  });
  if (!argv['take-traffic']) {
    delete deployment.metadata.labels.app;
  }
  deployment.metadata.name = `${name}-${uname}`;
  deployment.spec.containers.forEach((c) => {
    delete c.readinessProbe;
    delete c.livenessProbe;
    delete c.resources;
    if (c.name === name) {
      if (argv.restartable) {
        c.command = [
          '/bin/sh',
          '-c',
          'while /entrypoint.sh node-app || true; do echo "restarting..."; done',
        ];
      } else {
        c.command = ['sleep', '99999'];
      }
    }
    if (argv.image) {
      c.image = c.image.replace(/:([A-Za-z0-9_]+)$/, `:${argv.image}`);
      log('Using image', c.image);
    }
  });

  await core.ns(ns).po.post({ body: deployment });
  log(`${deployment.metadata.name} pod is created.`);
  if (!argv.detach) {
    const ok = await isUp(deployment.metadata.name, 20);
    if (ok) {
      spawn('kubectl', ['exec', '-it', deployment.metadata.name, 'sh'], {
        stdio: 'inherit',
      }).once('exit', async () => {
        if (!argv.retain) {
          await core.ns(ns).po(deployment.metadata.name).delete();
          log(`${deployment.metadata.name} pod has been deleted.`);
        }
      });
    }
  }
}

run();
